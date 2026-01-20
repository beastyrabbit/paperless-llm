/**
 * Document Processing Pipeline orchestrating all agents.
 *
 * Pipeline Order: OCR → Schema Analysis → Title → Correspondent → Document Type → Tags → Custom Fields → Document Links
 *
 * Uses LangGraph-based agents for all Ollama interactions (Title, Correspondent, DocumentType, Tags,
 * SchemaAnalysis, CustomFields, DocumentLinks). Only OCR uses MistralService directly.
 */
import { Effect, Context, Layer, Stream, pipe } from 'effect';
import { ConfigService, PaperlessService, TinyBaseService, QdrantService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { Document } from '../models/index.js';

// OCR still uses Mistral directly
import { OCRAgentService } from './OCRAgent.js';

// Summary agent (uses Ollama directly, no confirmation loop)
import { SummaryAgentService } from './SummaryAgentGraph.js';

// LangGraph-based agents
import { TitleAgentGraphService } from './TitleAgentGraph.js';
import { CorrespondentAgentGraphService } from './CorrespondentAgentGraph.js';
import { DocumentTypeAgentGraphService } from './DocumentTypeAgentGraph.js';
import { TagsAgentGraphService } from './TagsAgentGraph.js';
import { CustomFieldsAgentGraphService } from './CustomFieldsAgentGraph.js';
import { DocumentLinksAgentGraphService } from './DocumentLinksAgentGraph.js';
import { SchemaAnalysisAgentGraphService } from './SchemaAnalysisAgentGraph.js';
import type { StreamEvent } from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export type ProcessingState =
  | 'pending'
  | 'ocr_done'
  | 'summary_done'
  | 'schema_review'
  | 'schema_analysis_done'
  | 'title_done'
  | 'correspondent_done'
  | 'document_type_done'
  | 'tags_done'
  | 'custom_fields_done'
  | 'document_links_done'
  | 'processed';

export interface PipelineInput {
  docId: number;
  mockOcr?: boolean;
}

export interface PipelineStepResult {
  step: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PipelineResult {
  docId: number;
  success: boolean;
  needsReview: boolean;
  schemaReviewNeeded?: boolean;
  steps: Record<string, PipelineStepResult>;
  error?: string;
}

export interface PipelineStreamEvent {
  type: 'pipeline_start' | 'step_start' | 'step_complete' | 'step_error' | 'needs_review' | 'schema_review_needed' | 'pipeline_paused' | 'pipeline_complete' | 'warning' | 'error' | 'analyzing' | 'thinking' | 'confirming';
  docId: number;
  step?: string;
  data?: unknown;
  message?: string;
  reason?: string;
  timestamp: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface ProcessingPipelineService {
  readonly processDocument: (input: PipelineInput) => Effect.Effect<PipelineResult, AgentError>;
  readonly processDocumentStream: (input: PipelineInput) => Stream.Stream<PipelineStreamEvent, AgentError>;
  readonly processStep: (docId: number, step: string) => Effect.Effect<PipelineStepResult, AgentError>;
  readonly processStepStream: (docId: number, step: string) => Stream.Stream<PipelineStreamEvent, AgentError>;
  readonly getCurrentState: (doc: Document) => ProcessingState;
}

export const ProcessingPipelineService = Context.GenericTag<ProcessingPipelineService>('ProcessingPipelineService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const ProcessingPipelineServiceLive = Layer.effect(
  ProcessingPipelineService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const qdrant = yield* QdrantService;

    // OCR uses Mistral directly
    const ocrAgent = yield* OCRAgentService;

    // Summary uses Ollama directly (no confirmation loop)
    const summaryAgent = yield* SummaryAgentService;

    // LangGraph-based agents
    const titleAgent = yield* TitleAgentGraphService;
    const correspondentAgent = yield* CorrespondentAgentGraphService;
    const documentTypeAgent = yield* DocumentTypeAgentGraphService;
    const tagsAgent = yield* TagsAgentGraphService;
    const customFieldsAgent = yield* CustomFieldsAgentGraphService;
    const documentLinksAgent = yield* DocumentLinksAgentGraphService;
    const schemaAnalysisAgent = yield* SchemaAnalysisAgentGraphService;

    const { tags: tagConfig, pipeline: defaultPipelineConfig } = config.config;

    // Get pipeline settings from TinyBase (UI settings), falling back to config defaults
    const getPipelineConfig = () =>
      Effect.gen(function* () {
        const dbSettings = yield* tinybase.getAllSettings();
        const getBool = (key: string, fallback: boolean): boolean => {
          const val = dbSettings[key];
          if (val === undefined) return fallback;
          return val === 'true' || val === '1';
        };
        return {
          enableOcr: getBool('pipeline.ocr', defaultPipelineConfig.enableOcr),
          enableSummary: getBool('pipeline.summary', defaultPipelineConfig.enableSummary),
          enableTitle: getBool('pipeline.title', defaultPipelineConfig.enableTitle),
          enableCorrespondent: getBool('pipeline.correspondent', defaultPipelineConfig.enableCorrespondent),
          enableDocumentType: getBool('pipeline.document_type', defaultPipelineConfig.enableDocumentType),
          enableTags: getBool('pipeline.tags', defaultPipelineConfig.enableTags),
          enableCustomFields: getBool('pipeline.custom_fields', defaultPipelineConfig.enableCustomFields),
          enableDocumentLinks: getBool('pipeline.document_links', defaultPipelineConfig.enableDocumentLinks ?? true),
        };
      });

    // Build tag ID -> name map for efficient lookups
    // We cache this at service creation time
    const tagMapRef = { current: new Map<number, string>() };

    const refreshTagMap = Effect.gen(function* () {
      const tags = yield* paperless.getTags().pipe(
        Effect.catchAll(() => Effect.succeed([]))
      );
      tagMapRef.current = new Map(tags.map(t => [t.id, t.name]));
    });

    // Initialize tag map
    yield* refreshTagMap;

    // Determine current state from document tags
    // Handles both tag_names (if populated) and tag IDs (via lookup)
    const getCurrentState = (doc: Document): ProcessingState => {
      // Build tag names array from either tag_names or by resolving tag IDs
      let tagNames = doc.tag_names ?? [];
      if (tagNames.length === 0 && doc.tags.length > 0) {
        // Resolve tag IDs to names using cached map
        tagNames = doc.tags
          .map(id => tagMapRef.current.get(id))
          .filter((name): name is string => name !== undefined);
      }

      console.log(`[Pipeline] Document ${doc.id} - tag IDs: ${doc.tags.join(',')}, resolved names: ${tagNames.join(',')}, map size: ${tagMapRef.current.size}`);

      if (tagNames.includes(tagConfig.processed)) return 'processed';
      if (tagNames.includes(tagConfig.tagsDone)) return 'tags_done';
      if (tagNames.includes(tagConfig.documentTypeDone)) return 'document_type_done';
      if (tagNames.includes(tagConfig.correspondentDone)) return 'correspondent_done';
      if (tagNames.includes(tagConfig.titleDone)) return 'title_done';
      // Note: schema_analysis_done and schema_review tags would need to be added to config
      if (tagNames.includes(tagConfig.summaryDone)) return 'summary_done';
      if (tagNames.includes(tagConfig.ocrDone)) return 'ocr_done';
      if (tagNames.includes(tagConfig.pending)) return 'pending';
      return 'pending';
    };

    // Queue schema suggestions for review
    const queueSchemaSuggestions = (
      docId: number,
      docTitle: string,
      suggestions: Array<{ entityType: 'correspondent' | 'document_type' | 'tag'; suggestedName: string; reasoning: string; confidence: number; similarToExisting: string[] }>,
      nextTag?: string
    ): Effect.Effect<void, never> =>
      Effect.gen(function* () {
        for (const suggestion of suggestions) {
          const pendingId = yield* tinybase.addPendingReview({
            docId,
            docTitle,
            type: suggestion.entityType,
            suggestion: suggestion.suggestedName,
            reasoning: suggestion.reasoning,
            alternatives: suggestion.similarToExisting,
            attempts: 1,
            lastFeedback: null,
            nextTag: nextTag ?? null,
            metadata: JSON.stringify({
              entityType: suggestion.entityType,
              confidence: suggestion.confidence,
              isSchema: true,
            }),
          });
          // Skip if suggestion was empty and not persisted
          if (pendingId === null) {
            continue;
          }
        }
      }).pipe(Effect.catchAll(() => Effect.void));

    // Helper to check state without TypeScript narrowing issues
    const isState = (state: ProcessingState, ...targets: ProcessingState[]): boolean =>
      targets.includes(state);

    return {
      getCurrentState,

      processDocument: (input: PipelineInput) =>
        Effect.gen(function* () {
          const { docId, mockOcr = false } = input;
          const results: Record<string, PipelineStepResult> = {};
          let needsReview = false;
          let schemaReviewNeeded = false;

          // Get pipeline config from TinyBase (UI settings)
          const pipelineConfig = yield* getPipelineConfig();

          // Get document
          const doc = yield* paperless.getDocument(docId);
          let currentState: ProcessingState = getCurrentState(doc);
          let content = doc.content ?? '';

          // Step 1: OCR
          if (currentState === 'pending' && pipelineConfig.enableOcr) {
            const result = yield* ocrAgent.process({ docId, mockMode: mockOcr }).pipe(
              Effect.catchAll((e) =>
                Effect.succeed({ success: false, docId, textLength: 0, pages: 0, error: String(e) })
              )
            );

            results['ocr'] = {
              step: 'ocr',
              success: result.success,
              data: result,
            };

            if (!result.success) {
              return {
                docId,
                success: false,
                needsReview: false,
                steps: results,
                error: 'OCR failed',
              };
            }

            // Refresh document
            const updatedDoc = yield* paperless.getDocument(docId);
            content = updatedDoc.content ?? '';
            currentState = 'ocr_done';
          } else if (currentState === 'pending' && !pipelineConfig.enableOcr) {
            // Skip OCR step but advance state
            currentState = 'ocr_done';
          }

          // Step 1.5: Summary (optional, after OCR)
          if (currentState === 'ocr_done' && pipelineConfig.enableSummary) {
            const summaryResult = yield* summaryAgent
              .process({ docId, content })
              .pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    success: false,
                    docId,
                    summary: '',
                    summaryLength: 0,
                    error: String(e),
                  })
                )
              );

            results['summary'] = {
              step: 'summary',
              success: summaryResult.success,
              data: summaryResult,
            };

            if (!summaryResult.success) {
              return {
                docId,
                success: false,
                needsReview: false,
                steps: results,
                error: 'Summary generation failed',
              };
            }

            currentState = 'summary_done';
          } else if (currentState === 'ocr_done' && !pipelineConfig.enableSummary) {
            // Skip summary step but don't transition tags (summary is optional)
            currentState = 'summary_done';
          }

          // Step 2: Schema Analysis (optional)
          if (isState(currentState, 'ocr_done', 'summary_done')) {
            const schemaResult = yield* schemaAnalysisAgent.process({ docId, content }).pipe(
              Effect.catchAll((e) =>
                Effect.succeed({
                  docId,
                  hasSuggestions: false,
                  suggestions: [],
                  matchesPending: [],
                  reasoning: String(e),
                })
              )
            );

            results['schema_analysis'] = {
              step: 'schema_analysis',
              success: true,
              data: schemaResult,
            };

            if (schemaResult.hasSuggestions) {
              yield* queueSchemaSuggestions(
                docId,
                doc.title ?? `Document ${docId}`,
                schemaResult.suggestions,
                tagConfig.ocrDone // Will continue from OCR done after review
              );

              schemaReviewNeeded = true;
              needsReview = true;

              // Pipeline pauses for schema review
              return {
                docId,
                success: false,
                needsReview: true,
                schemaReviewNeeded: true,
                steps: results,
              };
            }

            currentState = 'schema_analysis_done';
          }

          // Step 3: Title
          if (isState(currentState, 'ocr_done', 'summary_done', 'schema_analysis_done') && pipelineConfig.enableTitle) {
            const titleResult = yield* titleAgent
              .process({
                docId,
                content,
                existingTitle: doc.title,
              })
              .pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    success: false,
                    value: null,
                    reasoning: String(e),
                    confidence: 0,
                    alternatives: [],
                    attempts: 0,
                    needsReview: true,
                  })
                )
              );

            results['title'] = {
              step: 'title',
              success: titleResult.success,
              data: titleResult,
            };

            if (titleResult.needsReview) {
              needsReview = true;
              return {
                docId,
                success: false,
                needsReview: true,
                steps: results,
              };
            }

            currentState = 'title_done';
          } else if (isState(currentState, 'ocr_done', 'summary_done', 'schema_analysis_done')) {
            // Skip disabled step but advance state
            currentState = 'title_done';
          }

          // Step 4: Correspondent
          if (currentState === 'title_done' && pipelineConfig.enableCorrespondent) {
            const correspondents = yield* paperless.getCorrespondents();

            const corrResult = yield* correspondentAgent
              .process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                existingCorrespondents: correspondents.map((c) => c.name),
              })
              .pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    success: false,
                    value: null,
                    reasoning: String(e),
                    confidence: 0,
                    alternatives: [],
                    attempts: 0,
                    needsReview: true,
                  })
                )
              );

            results['correspondent'] = {
              step: 'correspondent',
              success: corrResult.success,
              data: corrResult,
            };

            if (corrResult.needsReview) {
              needsReview = true;
              return {
                docId,
                success: false,
                needsReview: true,
                steps: results,
              };
            }

            currentState = 'correspondent_done';
          } else if (currentState === 'title_done') {
            // Skip disabled step but advance state
            currentState = 'correspondent_done';
          }

          // Step 5: Document Type
          if (currentState === 'correspondent_done' && pipelineConfig.enableDocumentType) {
            const docTypes = yield* paperless.getDocumentTypes();

            const dtResult = yield* documentTypeAgent
              .process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                existingDocumentTypes: docTypes.map((dt) => dt.name),
              })
              .pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    success: false,
                    value: null,
                    reasoning: String(e),
                    confidence: 0,
                    alternatives: [],
                    attempts: 0,
                    needsReview: true,
                  })
                )
              );

            results['document_type'] = {
              step: 'document_type',
              success: dtResult.success,
              data: dtResult,
            };

            if (dtResult.needsReview) {
              needsReview = true;
              return {
                docId,
                success: false,
                needsReview: true,
                steps: results,
              };
            }

            currentState = 'document_type_done';
          } else if (currentState === 'correspondent_done') {
            // Skip disabled step but advance state
            currentState = 'document_type_done';
          }

          // Step 6: Tags
          if (currentState === 'document_type_done' && pipelineConfig.enableTags) {
            const existingTags = yield* paperless.getTags();
            const updatedDoc = yield* paperless.getDocument(docId);
            const docType = updatedDoc.document_type;
            let documentTypeName: string | undefined;

            if (docType) {
              const allDocTypes = yield* paperless.getDocumentTypes();
              const foundType = allDocTypes.find((dt) => dt.id === docType);
              documentTypeName = foundType?.name;
            }

            const tagsResult = yield* tagsAgent
              .process({
                docId,
                content,
                docTitle: updatedDoc.title ?? `Document ${docId}`,
                documentType: documentTypeName,
                existingTags: existingTags.map((t) => t.name),
                currentTagIds: [...(updatedDoc.tags ?? [])],
              })
              .pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    success: false,
                    value: null,
                    reasoning: String(e),
                    confidence: 0,
                    alternatives: [],
                    attempts: 0,
                    needsReview: true,
                    tags: [],
                    newTags: [],
                    removedTags: [],
                    newTagsQueued: [],
                  })
                )
              );

            results['tags'] = {
              step: 'tags',
              success: tagsResult.success,
              data: tagsResult,
            };

            if (tagsResult.needsReview && !tagsResult.success) {
              needsReview = true;
              return {
                docId,
                success: false,
                needsReview: true,
                steps: results,
              };
            }

            currentState = 'tags_done';
          } else if (currentState === 'document_type_done') {
            // Skip disabled step but advance state
            currentState = 'tags_done';
          }

          // Step 7: Custom Fields (optional)
          if (currentState === 'tags_done' && pipelineConfig.enableCustomFields) {
            const customFields = yield* paperless.getCustomFields();
            const updatedDoc = yield* paperless.getDocument(docId);
            const docType = updatedDoc.document_type;
            let documentTypeName: string | undefined;

            if (docType) {
              const allDocTypes = yield* paperless.getDocumentTypes();
              const foundType = allDocTypes.find((dt) => dt.id === docType);
              documentTypeName = foundType?.name;
            }

            const cfResult = yield* customFieldsAgent
              .process({
                docId,
                content,
                docTitle: updatedDoc.title ?? `Document ${docId}`,
                documentType: documentTypeName,
                customFields,
              })
              .pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    success: true,
                    value: null,
                    reasoning: String(e),
                    confidence: 0,
                    alternatives: [],
                    attempts: 0,
                    needsReview: false,
                    fields: [],
                    updatedFields: [],
                    skipped: true,
                    skipReason: String(e),
                  })
                )
              );

            results['custom_fields'] = {
              step: 'custom_fields',
              success: cfResult.success,
              data: cfResult,
            };

            currentState = 'custom_fields_done';
          } else if (currentState === 'tags_done') {
            // Skip disabled step but advance state
            currentState = 'custom_fields_done';
          }

          // Step 8: Document Links (optional - finds related documents)
          if (currentState === 'custom_fields_done' && pipelineConfig.enableDocumentLinks) {
            const customFields = yield* paperless.getCustomFields();
            const documentLinkFields = customFields.filter((f) => f.data_type === 'documentlink');

            // Only process if there are documentlink custom fields defined
            if (documentLinkFields.length > 0) {
              const updatedDoc = yield* paperless.getDocument(docId);
              const correspondents = yield* paperless.getCorrespondents();
              const correspondentName = updatedDoc.correspondent
                ? correspondents.find((c) => c.id === updatedDoc.correspondent)?.name
                : undefined;

              const dlResult = yield* documentLinksAgent
                .process({
                  docId,
                  content,
                  docTitle: updatedDoc.title ?? `Document ${docId}`,
                  correspondent: correspondentName,
                  documentLinkFields,
                })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: true,
                      value: null,
                      reasoning: String(e),
                      confidence: 0,
                      alternatives: [],
                      attempts: 0,
                      needsReview: false,
                      links: [],
                      autoApplied: [],
                      pendingReview: [],
                      skipped: true,
                      skipReason: String(e),
                    })
                  )
                );

              results['document_links'] = {
                step: 'document_links',
                success: dlResult.success,
                data: dlResult,
              };

              // Document links may queue items for review but don't block pipeline
              if (dlResult.needsReview) {
                needsReview = true;
              }
            } else {
              results['document_links'] = {
                step: 'document_links',
                success: true,
                data: { skipped: true, skipReason: 'No documentlink custom fields defined' },
              };
            }

            currentState = 'document_links_done';
          } else if (currentState === 'custom_fields_done') {
            // Skip disabled step but advance state
            currentState = 'document_links_done';
          }

          // Complete pipeline
          if (currentState === 'document_links_done') {
            // Transition to processed
            const finalTag = tagConfig.tagsDone;

            yield* paperless.transitionDocumentTag(docId, finalTag, tagConfig.processed);

            // Log state transition
            yield* tinybase.addProcessingLog({
              docId,
              timestamp: new Date().toISOString(),
              step: 'pipeline',
              eventType: 'state_transition',
              data: {
                fromTag: finalTag,
                toTag: tagConfig.processed,
                fromState: 'document_links_done',
                toState: 'processed',
              },
            });

            // Index document in Qdrant for vector search
            const vectorSearchEnabled = (yield* tinybase.getAllSettings())['vector_search.enabled'] === 'true';
            if (vectorSearchEnabled) {
              const finalDoc = yield* paperless.getDocument(docId);
              const allTags = yield* paperless.getTags();
              const correspondents = yield* paperless.getCorrespondents();
              const documentTypes = yield* paperless.getDocumentTypes();

              const tagNames = (finalDoc.tags ?? [])
                .map((id: number) => allTags.find((t) => t.id === id)?.name)
                .filter((n): n is string => !!n && !n.startsWith('llm-'));

              const correspondent = finalDoc.correspondent
                ? correspondents.find((c) => c.id === finalDoc.correspondent)?.name
                : undefined;

              const documentType = finalDoc.document_type
                ? documentTypes.find((dt) => dt.id === finalDoc.document_type)?.name
                : undefined;

              yield* qdrant.upsertDocument({
                docId: finalDoc.id,
                title: finalDoc.title ?? `Document ${finalDoc.id}`,
                content: (finalDoc.content ?? '').slice(0, 10000), // Limit content for embedding
                tags: tagNames,
                correspondent,
                documentType,
              }).pipe(
                Effect.catchAll((e) => {
                  // Log error but don't fail pipeline
                  console.error(`[Pipeline] Qdrant indexing failed for doc ${docId}:`, e);
                  return Effect.succeed(undefined);
                })
              );

              // Log Qdrant indexing
              yield* tinybase.addProcessingLog({
                docId,
                timestamp: new Date().toISOString(),
                step: 'qdrant_index',
                eventType: 'result',
                data: {
                  success: true,
                  indexed: true,
                },
              });
            }

            results['complete'] = {
              step: 'complete',
              success: true,
            };
          }

          return {
            docId,
            success: true,
            needsReview,
            schemaReviewNeeded,
            steps: results,
          };
        }).pipe(
          Effect.mapError((e) =>
            new AgentError({
              message: `Pipeline processing failed: ${e}`,
              agent: 'pipeline',
              cause: e,
            })
          )
        ),

      processDocumentStream: (input: PipelineInput) =>
        Stream.asyncEffect<PipelineStreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            const { docId, mockOcr = false } = input;

            // Get pipeline config from TinyBase (UI settings)
            const pipelineConfig = yield* getPipelineConfig();

            // Helper to create events with timestamps
            const event = (e: Omit<PipelineStreamEvent, 'timestamp'>): PipelineStreamEvent => ({
              ...e,
              timestamp: new Date().toISOString(),
            });

            yield* Effect.sync(() =>
              emit.single(event({ type: 'pipeline_start', docId }))
            );

            // Get document
            const doc = yield* paperless.getDocument(docId);
            let currentState = getCurrentState(doc);
            let content = doc.content ?? '';

            // OCR
            if (currentState === 'pending' && pipelineConfig.enableOcr) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'ocr' }))
              );

              const result = yield* ocrAgent.process({ docId, mockMode: mockOcr }).pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({ success: false, docId, textLength: 0, pages: 0, error: String(e) })
                )
              );

              if (!result.success) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'step_error', docId, step: 'ocr', message: 'OCR failed' }))
                );
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'error', docId, message: 'Pipeline failed at OCR' }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'ocr', data: result }))
              );

              const updatedDoc = yield* paperless.getDocument(docId);
              content = updatedDoc.content ?? '';
              currentState = 'ocr_done';
            } else if (currentState === 'pending' && !pipelineConfig.enableOcr) {
              // Skip OCR step but advance state
              currentState = 'ocr_done';
            }

            // Summary (optional, after OCR)
            if (currentState === 'ocr_done' && pipelineConfig.enableSummary) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'summary' }))
              );

              const summaryResult = yield* summaryAgent
                .process({ docId, content })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: false,
                      docId,
                      summary: '',
                      summaryLength: 0,
                      error: String(e),
                    })
                  )
                );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'summary', data: summaryResult }))
              );

              if (!summaryResult.success) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'step_error', docId, step: 'summary', message: 'Summary generation failed' }))
                );
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'error', docId, message: 'Pipeline failed at summary' }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'summary_done';
            } else if (currentState === 'ocr_done' && !pipelineConfig.enableSummary) {
              // Skip summary step
              currentState = 'summary_done';
            }

            // Schema Analysis
            if (isState(currentState, 'ocr_done', 'summary_done')) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'schema_analysis' }))
              );

              const schemaResult = yield* schemaAnalysisAgent.process({ docId, content }).pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({
                    docId,
                    hasSuggestions: false,
                    suggestions: [],
                    matchesPending: [],
                    reasoning: String(e),
                  })
                )
              );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'schema_analysis', data: schemaResult }))
              );

              if (schemaResult.hasSuggestions) {
                yield* queueSchemaSuggestions(
                  docId,
                  doc.title ?? `Document ${docId}`,
                  schemaResult.suggestions
                );

                yield* Effect.sync(() =>
                  emit.single(event({ type: 'schema_review_needed', docId, step: 'schema_analysis', data: schemaResult }))
                );
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'pipeline_paused', docId, reason: 'schema_review_needed' }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'schema_analysis_done';
            }

            // Title
            if (isState(currentState, 'ocr_done', 'summary_done', 'schema_analysis_done') && pipelineConfig.enableTitle) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'title' }))
              );

              const titleResult = yield* titleAgent
                .process({ docId, content, existingTitle: doc.title })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: false,
                      value: null,
                      reasoning: String(e),
                      confidence: 0,
                      alternatives: [],
                      attempts: 0,
                      needsReview: true,
                    })
                  )
                );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'title', data: titleResult }))
              );

              if (titleResult.needsReview) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'needs_review', docId, step: 'title', data: titleResult }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'title_done';
            } else if (isState(currentState, 'ocr_done', 'summary_done', 'schema_analysis_done')) {
              // Skip disabled step but advance state
              currentState = 'title_done';
            }

            // Correspondent
            if (currentState === 'title_done' && pipelineConfig.enableCorrespondent) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'correspondent' }))
              );

              const correspondents = yield* paperless.getCorrespondents();
              const corrResult = yield* correspondentAgent
                .process({
                  docId,
                  content,
                  docTitle: doc.title ?? `Document ${docId}`,
                  existingCorrespondents: correspondents.map((c) => c.name),
                })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: false,
                      value: null,
                      reasoning: String(e),
                      confidence: 0,
                      alternatives: [],
                      attempts: 0,
                      needsReview: true,
                    })
                  )
                );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'correspondent', data: corrResult }))
              );

              if (corrResult.needsReview) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'needs_review', docId, step: 'correspondent', data: corrResult }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'correspondent_done';
            } else if (currentState === 'title_done') {
              currentState = 'correspondent_done';
            }

            // Document Type
            if (currentState === 'correspondent_done' && pipelineConfig.enableDocumentType) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'document_type' }))
              );

              const docTypes = yield* paperless.getDocumentTypes();
              const dtResult = yield* documentTypeAgent
                .process({
                  docId,
                  content,
                  docTitle: doc.title ?? `Document ${docId}`,
                  existingDocumentTypes: docTypes.map((dt) => dt.name),
                })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: false,
                      value: null,
                      reasoning: String(e),
                      confidence: 0,
                      alternatives: [],
                      attempts: 0,
                      needsReview: true,
                    })
                  )
                );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'document_type', data: dtResult }))
              );

              if (dtResult.needsReview) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'needs_review', docId, step: 'document_type', data: dtResult }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'document_type_done';
            } else if (currentState === 'correspondent_done') {
              currentState = 'document_type_done';
            }

            // Tags
            if (currentState === 'document_type_done' && pipelineConfig.enableTags) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'tags' }))
              );

              const existingTags = yield* paperless.getTags();
              const updatedDoc = yield* paperless.getDocument(docId);
              const docType = updatedDoc.document_type;
              let documentTypeName: string | undefined;

              if (docType) {
                const allDocTypes = yield* paperless.getDocumentTypes();
                const foundType = allDocTypes.find((dt) => dt.id === docType);
                documentTypeName = foundType?.name;
              }

              const tagsResult = yield* tagsAgent
                .process({
                  docId,
                  content,
                  docTitle: updatedDoc.title ?? `Document ${docId}`,
                  documentType: documentTypeName,
                  existingTags: existingTags.map((t) => t.name),
                  currentTagIds: [...(updatedDoc.tags ?? [])],
                })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: false,
                      value: null,
                      reasoning: String(e),
                      confidence: 0,
                      alternatives: [],
                      attempts: 0,
                      needsReview: true,
                      tags: [],
                      newTags: [],
                      removedTags: [],
                      newTagsQueued: [],
                    })
                  )
                );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'tags', data: tagsResult }))
              );

              if (tagsResult.needsReview && !tagsResult.success) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'needs_review', docId, step: 'tags', data: tagsResult }))
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'tags_done';
            } else if (currentState === 'document_type_done') {
              currentState = 'tags_done';
            }

            // Custom Fields (optional)
            if (currentState === 'tags_done' && pipelineConfig.enableCustomFields) {
              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_start', docId, step: 'custom_fields' }))
              );

              const customFields = yield* paperless.getCustomFields();
              const updatedDoc = yield* paperless.getDocument(docId);
              const docType = updatedDoc.document_type;
              let documentTypeName: string | undefined;

              if (docType) {
                const allDocTypes = yield* paperless.getDocumentTypes();
                const foundType = allDocTypes.find((dt) => dt.id === docType);
                documentTypeName = foundType?.name;
              }

              const cfResult = yield* customFieldsAgent
                .process({
                  docId,
                  content,
                  docTitle: updatedDoc.title ?? `Document ${docId}`,
                  documentType: documentTypeName,
                  customFields,
                })
                .pipe(
                  Effect.catchAll((e) =>
                    Effect.succeed({
                      success: true,
                      value: null,
                      reasoning: String(e),
                      confidence: 0,
                      alternatives: [],
                      attempts: 0,
                      needsReview: false,
                      fields: [],
                      updatedFields: [],
                      skipped: true,
                      skipReason: String(e),
                    })
                  )
                );

              yield* Effect.sync(() =>
                emit.single(event({ type: 'step_complete', docId, step: 'custom_fields', data: cfResult }))
              );

              currentState = 'custom_fields_done';
            } else if (currentState === 'tags_done') {
              currentState = 'custom_fields_done';
            }

            // Document Links (optional - finds related documents)
            if (currentState === 'custom_fields_done' && pipelineConfig.enableDocumentLinks) {
              const customFields = yield* paperless.getCustomFields();
              const documentLinkFields = customFields.filter((f) => f.data_type === 'documentlink');

              if (documentLinkFields.length > 0) {
                yield* Effect.sync(() =>
                  emit.single(event({ type: 'step_start', docId, step: 'document_links' }))
                );

                const updatedDoc = yield* paperless.getDocument(docId);
                const correspondents = yield* paperless.getCorrespondents();
                const correspondentName = updatedDoc.correspondent
                  ? correspondents.find((c) => c.id === updatedDoc.correspondent)?.name
                  : undefined;

                const dlResult = yield* documentLinksAgent
                  .process({
                    docId,
                    content,
                    docTitle: updatedDoc.title ?? `Document ${docId}`,
                    correspondent: correspondentName,
                    documentLinkFields,
                  })
                  .pipe(
                    Effect.catchAll((e) =>
                      Effect.succeed({
                        success: true,
                        value: null,
                        reasoning: String(e),
                        confidence: 0,
                        alternatives: [],
                        attempts: 0,
                        needsReview: false,
                        links: [],
                        autoApplied: [],
                        pendingReview: [],
                        skipped: true,
                        skipReason: String(e),
                      })
                    )
                  );

                yield* Effect.sync(() =>
                  emit.single(event({ type: 'step_complete', docId, step: 'document_links', data: dlResult }))
                );

                // Document links may queue items for review but don't block pipeline
                if (dlResult.needsReview) {
                  yield* Effect.sync(() =>
                    emit.single(event({ type: 'needs_review', docId, step: 'document_links', data: dlResult }))
                  );
                }
              }

              currentState = 'document_links_done';
            } else if (currentState === 'custom_fields_done') {
              currentState = 'document_links_done';
            }

            // Complete pipeline
            if (currentState === 'document_links_done') {
              const finalTag = tagConfig.tagsDone;
              yield* paperless.transitionDocumentTag(docId, finalTag, tagConfig.processed);

              // Log state transition
              yield* tinybase.addProcessingLog({
                docId,
                timestamp: new Date().toISOString(),
                step: 'pipeline',
                eventType: 'state_transition',
                data: {
                  fromTag: finalTag,
                  toTag: tagConfig.processed,
                  fromState: 'document_links_done',
                  toState: 'processed',
                },
              });

              // Index document in Qdrant for vector search
              const vectorSearchEnabled = (yield* tinybase.getAllSettings())['vector_search.enabled'] === 'true';
              if (vectorSearchEnabled) {
                const finalDoc = yield* paperless.getDocument(docId);
                const allTags = yield* paperless.getTags();
                const correspondents = yield* paperless.getCorrespondents();
                const documentTypes = yield* paperless.getDocumentTypes();

                const tagNames = (finalDoc.tags ?? [])
                  .map((id: number) => allTags.find((t) => t.id === id)?.name)
                  .filter((n): n is string => !!n && !n.startsWith('llm-'));

                const correspondent = finalDoc.correspondent
                  ? correspondents.find((c) => c.id === finalDoc.correspondent)?.name
                  : undefined;

                const documentType = finalDoc.document_type
                  ? documentTypes.find((dt) => dt.id === finalDoc.document_type)?.name
                  : undefined;

                yield* qdrant.upsertDocument({
                  docId: finalDoc.id,
                  title: finalDoc.title ?? `Document ${finalDoc.id}`,
                  content: (finalDoc.content ?? '').slice(0, 10000), // Limit content for embedding
                  tags: tagNames,
                  correspondent,
                  documentType,
                }).pipe(
                  Effect.catchAll((e) => {
                    // Log error but don't fail pipeline
                    console.error(`[Pipeline] Qdrant indexing failed for doc ${docId}:`, e);
                    return Effect.succeed(undefined);
                  })
                );

                // Log Qdrant indexing
                yield* tinybase.addProcessingLog({
                  docId,
                  timestamp: new Date().toISOString(),
                  step: 'qdrant_index',
                  eventType: 'result',
                  data: {
                    success: true,
                    indexed: true,
                  },
                });
              }
            }

            yield* Effect.sync(() =>
              emit.single(event({ type: 'pipeline_complete', docId }))
            );
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Pipeline stream failed: ${e}`,
                agent: 'pipeline',
                cause: e,
              })
            )
          )
        ),

      processStep: (docId: number, step: string) =>
        Effect.gen(function* () {
          const doc = yield* paperless.getDocument(docId);
          const content = doc.content ?? '';

          switch (step) {
            case 'ocr':
              const ocrResult = yield* ocrAgent.process({ docId });
              return {
                step: 'ocr',
                success: ocrResult.success,
                data: ocrResult,
              };

            case 'summary':
              const summaryResult = yield* summaryAgent.process({ docId, content });
              return {
                step: 'summary',
                success: summaryResult.success,
                data: summaryResult,
              };

            case 'title':
              const titleResult = yield* titleAgent.process({ docId, content });
              return {
                step: 'title',
                success: titleResult.success,
                data: titleResult,
              };

            case 'correspondent':
              const correspondents = yield* paperless.getCorrespondents();
              const corrResult = yield* correspondentAgent.process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                existingCorrespondents: correspondents.map((c) => c.name),
              });
              return {
                step: 'correspondent',
                success: corrResult.success,
                data: corrResult,
              };

            case 'document_type':
              const docTypes = yield* paperless.getDocumentTypes();
              const dtResult = yield* documentTypeAgent.process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                existingDocumentTypes: docTypes.map((dt) => dt.name),
              });
              return {
                step: 'document_type',
                success: dtResult.success,
                data: dtResult,
              };

            case 'tags':
              const existingTags = yield* paperless.getTags();
              const tagsResult = yield* tagsAgent.process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                existingTags: existingTags.map((t) => t.name),
                currentTagIds: [...(doc.tags ?? [])],
              });
              return {
                step: 'tags',
                success: tagsResult.success,
                data: tagsResult,
              };

            case 'schema_analysis':
              const schemaResult = yield* schemaAnalysisAgent.process({ docId, content });
              return {
                step: 'schema_analysis',
                success: true,
                data: schemaResult,
              };

            case 'custom_fields':
              const customFields = yield* paperless.getCustomFields();
              const cfResult = yield* customFieldsAgent.process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                customFields,
              });
              return {
                step: 'custom_fields',
                success: cfResult.success,
                data: cfResult,
              };

            case 'document_links': {
              const allCustomFields = yield* paperless.getCustomFields();
              const documentLinkFields = allCustomFields.filter((f) => f.data_type === 'documentlink');
              if (documentLinkFields.length === 0) {
                return {
                  step: 'document_links',
                  success: true,
                  data: { skipped: true, skipReason: 'No documentlink custom fields defined' },
                };
              }
              const correspondentsForLinks = yield* paperless.getCorrespondents();
              const correspondentName = doc.correspondent
                ? correspondentsForLinks.find((c) => c.id === doc.correspondent)?.name
                : undefined;
              const dlResult = yield* documentLinksAgent.process({
                docId,
                content,
                docTitle: doc.title ?? `Document ${docId}`,
                correspondent: correspondentName,
                documentLinkFields,
              });
              return {
                step: 'document_links',
                success: dlResult.success,
                data: dlResult,
              };
            }

            default:
              return {
                step,
                success: false,
                error: `Unknown step: ${step}`,
              };
          }
        }).pipe(
          Effect.mapError((e) =>
            new AgentError({
              message: `Step processing failed: ${e}`,
              agent: 'pipeline',
              step,
              cause: e,
            })
          )
        ),

      processStepStream: (docId: number, step: string) =>
        Stream.asyncEffect<PipelineStreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            const doc = yield* paperless.getDocument(docId);
            const content = doc.content ?? '';

            // Helper to create events with timestamps
            const event = (e: Omit<PipelineStreamEvent, 'timestamp'>): PipelineStreamEvent => ({
              ...e,
              timestamp: new Date().toISOString(),
            });

            // Helper to convert agent StreamEvent to PipelineStreamEvent
            const mapEvent = (agentEvent: StreamEvent): PipelineStreamEvent => {
              const timestamp = agentEvent.timestamp ?? new Date().toISOString();
              switch (agentEvent.type) {
                case 'start':
                  return { type: 'step_start', docId, step: agentEvent.step, data: agentEvent.data, timestamp };
                case 'thinking':
                  return { type: 'thinking', docId, step: agentEvent.step, data: agentEvent.data, timestamp };
                case 'analyzing':
                  return { type: 'analyzing', docId, step: agentEvent.step, data: agentEvent.data, timestamp };
                case 'confirming':
                  return { type: 'confirming', docId, step: agentEvent.step, data: agentEvent.data, timestamp };
                case 'result':
                  return { type: 'step_complete', docId, step: agentEvent.step, data: agentEvent.data, timestamp };
                case 'error':
                  return { type: 'step_error', docId, step: agentEvent.step, message: String(agentEvent.data), timestamp };
                case 'complete':
                  return { type: 'step_complete', docId, step: agentEvent.step, timestamp };
                default:
                  return { type: 'step_complete', docId, step: agentEvent.step, data: agentEvent.data, timestamp };
              }
            };

            // Helper to run agent stream and forward events
            const runAgentStream = <T>(agentStream: Stream.Stream<StreamEvent, AgentError>) =>
              pipe(
                agentStream,
                Stream.tap((event) => Effect.sync(() => emit.single(mapEvent(event)))),
                Stream.runDrain
              );

            switch (step) {
              case 'summary':
                if (summaryAgent.processStream) {
                  yield* runAgentStream(summaryAgent.processStream({ docId, content }));
                } else {
                  const result = yield* summaryAgent.process({ docId, content });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: result })));
                }
                break;

              case 'title':
                if (titleAgent.processStream) {
                  yield* runAgentStream(titleAgent.processStream({ docId, content }));
                } else {
                  const result = yield* titleAgent.process({ docId, content });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: result })));
                }
                break;

              case 'correspondent':
                const correspondents = yield* paperless.getCorrespondents();
                if (correspondentAgent.processStream) {
                  yield* runAgentStream(correspondentAgent.processStream({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    existingCorrespondents: correspondents.map((c) => c.name),
                  }));
                } else {
                  const result = yield* correspondentAgent.process({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    existingCorrespondents: correspondents.map((c) => c.name),
                  });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: result })));
                }
                break;

              case 'document_type':
                const docTypes = yield* paperless.getDocumentTypes();
                if (documentTypeAgent.processStream) {
                  yield* runAgentStream(documentTypeAgent.processStream({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    existingDocumentTypes: docTypes.map((dt) => dt.name),
                  }));
                } else {
                  const result = yield* documentTypeAgent.process({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    existingDocumentTypes: docTypes.map((dt) => dt.name),
                  });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: result })));
                }
                break;

              case 'tags':
                const existingTags = yield* paperless.getTags();
                if (tagsAgent.processStream) {
                  yield* runAgentStream(tagsAgent.processStream({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    existingTags: existingTags.map((t) => t.name),
                    currentTagIds: [...(doc.tags ?? [])],
                  }));
                } else {
                  const result = yield* tagsAgent.process({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    existingTags: existingTags.map((t) => t.name),
                    currentTagIds: [...(doc.tags ?? [])],
                  });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: result })));
                }
                break;

              case 'custom_fields':
                const customFields = yield* paperless.getCustomFields();
                if (customFieldsAgent.processStream) {
                  yield* runAgentStream(customFieldsAgent.processStream({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    customFields,
                  }));
                } else {
                  const result = yield* customFieldsAgent.process({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    customFields,
                  });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: result })));
                }
                break;

              case 'document_links': {
                const allCustomFieldsStream = yield* paperless.getCustomFields();
                const documentLinkFieldsStream = allCustomFieldsStream.filter((f) => f.data_type === 'documentlink');
                if (documentLinkFieldsStream.length === 0) {
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: { skipped: true, skipReason: 'No documentlink custom fields defined' } })));
                  break;
                }
                const correspondentsForLinksStream = yield* paperless.getCorrespondents();
                const correspondentNameStream = doc.correspondent
                  ? correspondentsForLinksStream.find((c) => c.id === doc.correspondent)?.name
                  : undefined;
                if (documentLinksAgent.processStream) {
                  yield* runAgentStream(documentLinksAgent.processStream({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    correspondent: correspondentNameStream,
                    documentLinkFields: documentLinkFieldsStream,
                  }));
                } else {
                  const dlResult = yield* documentLinksAgent.process({
                    docId,
                    content,
                    docTitle: doc.title ?? `Document ${docId}`,
                    correspondent: correspondentNameStream,
                    documentLinkFields: documentLinkFieldsStream,
                  });
                  yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: dlResult })));
                }
                break;
              }

              case 'ocr':
                // OCR doesn't have a stream mode
                yield* Effect.sync(() => emit.single(event({ type: 'step_start', docId, step })));
                const ocrResult = yield* ocrAgent.process({ docId });
                yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: ocrResult })));
                break;

              case 'schema_analysis':
                // Schema analysis doesn't have a stream mode
                yield* Effect.sync(() => emit.single(event({ type: 'step_start', docId, step })));
                const schemaResult = yield* schemaAnalysisAgent.process({ docId, content });
                yield* Effect.sync(() => emit.single(event({ type: 'step_complete', docId, step, data: schemaResult })));
                break;

              default:
                yield* Effect.sync(() => emit.single(event({ type: 'step_error', docId, step, message: `Unknown step: ${step}` })));
            }

            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Step stream failed: ${e}`,
                agent: 'pipeline',
                step,
                cause: e,
              })
            )
          )
        ),
    };
  })
);
