/**
 * Document Processing Pipeline orchestrating all agents.
 *
 * Pipeline Order: OCR → Schema Analysis → Title → Correspondent → Document Type → Tags → Custom Fields
 */
import { Effect, Context, Layer, Stream, pipe } from 'effect';
import { ConfigService, PaperlessService, TinyBaseService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { Document } from '../models/index.js';

import { OCRAgentService } from './OCRAgent.js';
import { TitleAgentService } from './TitleAgent.js';
import { CorrespondentAgentService } from './CorrespondentAgent.js';
import { DocumentTypeAgentService } from './DocumentTypeAgent.js';
import { TagsAgentService } from './TagsAgent.js';
import { CustomFieldsAgentService } from './CustomFieldsAgent.js';
import { SchemaAnalysisAgentService } from './SchemaAnalysisAgent.js';
import type { StreamEvent } from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export type ProcessingState =
  | 'pending'
  | 'ocr_done'
  | 'schema_review'
  | 'schema_analysis_done'
  | 'title_done'
  | 'correspondent_done'
  | 'document_type_done'
  | 'tags_done'
  | 'custom_fields_done'
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

    const ocrAgent = yield* OCRAgentService;
    const titleAgent = yield* TitleAgentService;
    const correspondentAgent = yield* CorrespondentAgentService;
    const documentTypeAgent = yield* DocumentTypeAgentService;
    const tagsAgent = yield* TagsAgentService;
    const customFieldsAgent = yield* CustomFieldsAgentService;
    const schemaAnalysisAgent = yield* SchemaAnalysisAgentService;

    const { tags: tagConfig, pipeline: pipelineConfig } = config.config;

    // Determine current state from document tags
    const getCurrentState = (doc: Document): ProcessingState => {
      const tagNames = doc.tag_names ?? [];

      if (tagNames.includes(tagConfig.processed)) return 'processed';
      if (tagNames.includes(tagConfig.tagsDone)) return 'tags_done';
      if (tagNames.includes(tagConfig.documentTypeDone)) return 'document_type_done';
      if (tagNames.includes(tagConfig.correspondentDone)) return 'correspondent_done';
      if (tagNames.includes(tagConfig.titleDone)) return 'title_done';
      // Note: schema_analysis_done and schema_review tags would need to be added to config
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
          yield* tinybase.addPendingReview({
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
          }

          // Step 2: Schema Analysis (optional)
          if (currentState === 'ocr_done') {
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
          if (isState(currentState, 'ocr_done', 'schema_analysis_done') && pipelineConfig.enableTitle) {
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
          } else if (isState(currentState, 'ocr_done', 'schema_analysis_done')) {
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

          // Complete pipeline
          if (currentState === 'custom_fields_done') {
            // Transition to processed
            const finalTag = pipelineConfig.enableCustomFields
              ? tagConfig.tagsDone // Custom fields doesn't have its own tag in config
              : tagConfig.tagsDone;

            yield* paperless.transitionDocumentTag(docId, finalTag, tagConfig.processed);

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

            yield* Effect.sync(() =>
              emit.single({ type: 'pipeline_start', docId })
            );

            // Get document
            const doc = yield* paperless.getDocument(docId);
            let currentState = getCurrentState(doc);
            let content = doc.content ?? '';

            // OCR
            if (currentState === 'pending' && pipelineConfig.enableOcr) {
              yield* Effect.sync(() =>
                emit.single({ type: 'step_start', docId, step: 'ocr' })
              );

              const result = yield* ocrAgent.process({ docId, mockMode: mockOcr }).pipe(
                Effect.catchAll((e) =>
                  Effect.succeed({ success: false, docId, textLength: 0, pages: 0, error: String(e) })
                )
              );

              if (!result.success) {
                yield* Effect.sync(() =>
                  emit.single({ type: 'step_error', docId, step: 'ocr', message: 'OCR failed' })
                );
                yield* Effect.sync(() =>
                  emit.single({ type: 'error', docId, message: 'Pipeline failed at OCR' })
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              yield* Effect.sync(() =>
                emit.single({ type: 'step_complete', docId, step: 'ocr', data: result })
              );

              const updatedDoc = yield* paperless.getDocument(docId);
              content = updatedDoc.content ?? '';
              currentState = 'ocr_done';
            }

            // Schema Analysis
            if (currentState === 'ocr_done') {
              yield* Effect.sync(() =>
                emit.single({ type: 'step_start', docId, step: 'schema_analysis' })
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
                emit.single({ type: 'step_complete', docId, step: 'schema_analysis', data: schemaResult })
              );

              if (schemaResult.hasSuggestions) {
                yield* queueSchemaSuggestions(
                  docId,
                  doc.title ?? `Document ${docId}`,
                  schemaResult.suggestions
                );

                yield* Effect.sync(() =>
                  emit.single({ type: 'schema_review_needed', docId, step: 'schema_analysis', data: schemaResult })
                );
                yield* Effect.sync(() =>
                  emit.single({ type: 'pipeline_paused', docId, reason: 'schema_review_needed' })
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'schema_analysis_done';
            }

            // Title
            if (isState(currentState, 'ocr_done', 'schema_analysis_done') && pipelineConfig.enableTitle) {
              yield* Effect.sync(() =>
                emit.single({ type: 'step_start', docId, step: 'title' })
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
                emit.single({ type: 'step_complete', docId, step: 'title', data: titleResult })
              );

              if (titleResult.needsReview) {
                yield* Effect.sync(() =>
                  emit.single({ type: 'needs_review', docId, step: 'title', data: titleResult })
                );
                yield* Effect.sync(() => emit.end());
                return;
              }

              currentState = 'title_done';
            } else if (isState(currentState, 'ocr_done', 'schema_analysis_done')) {
              // Skip disabled step but advance state
              currentState = 'title_done';
            }

            // Correspondent
            if (currentState === 'title_done' && pipelineConfig.enableCorrespondent) {
              yield* Effect.sync(() =>
                emit.single({ type: 'step_start', docId, step: 'correspondent' })
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
                emit.single({ type: 'step_complete', docId, step: 'correspondent', data: corrResult })
              );

              if (corrResult.needsReview) {
                yield* Effect.sync(() =>
                  emit.single({ type: 'needs_review', docId, step: 'correspondent', data: corrResult })
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
                emit.single({ type: 'step_start', docId, step: 'document_type' })
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
                emit.single({ type: 'step_complete', docId, step: 'document_type', data: dtResult })
              );

              if (dtResult.needsReview) {
                yield* Effect.sync(() =>
                  emit.single({ type: 'needs_review', docId, step: 'document_type', data: dtResult })
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
                emit.single({ type: 'step_start', docId, step: 'tags' })
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
                emit.single({ type: 'step_complete', docId, step: 'tags', data: tagsResult })
              );

              if (tagsResult.needsReview && !tagsResult.success) {
                yield* Effect.sync(() =>
                  emit.single({ type: 'needs_review', docId, step: 'tags', data: tagsResult })
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
                emit.single({ type: 'step_start', docId, step: 'custom_fields' })
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
                emit.single({ type: 'step_complete', docId, step: 'custom_fields', data: cfResult })
              );

              currentState = 'custom_fields_done';
            } else if (currentState === 'tags_done') {
              currentState = 'custom_fields_done';
            }

            // Complete pipeline
            if (currentState === 'custom_fields_done') {
              const finalTag = tagConfig.tagsDone;
              yield* paperless.transitionDocumentTag(docId, finalTag, tagConfig.processed);
            }

            yield* Effect.sync(() =>
              emit.single({ type: 'pipeline_complete', docId })
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
                customFields,
              });
              return {
                step: 'custom_fields',
                success: cfResult.success,
                data: cfResult,
              };

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

            // Helper to convert agent StreamEvent to PipelineStreamEvent
            const mapEvent = (event: StreamEvent): PipelineStreamEvent => {
              switch (event.type) {
                case 'start':
                  return { type: 'step_start', docId, step: event.step, data: event.data };
                case 'thinking':
                  return { type: 'thinking', docId, step: event.step, data: event.data };
                case 'analyzing':
                  return { type: 'analyzing', docId, step: event.step, data: event.data };
                case 'confirming':
                  return { type: 'confirming', docId, step: event.step, data: event.data };
                case 'result':
                  return { type: 'step_complete', docId, step: event.step, data: event.data };
                case 'error':
                  return { type: 'step_error', docId, step: event.step, message: String(event.data) };
                case 'complete':
                  return { type: 'step_complete', docId, step: event.step };
                default:
                  return { type: 'step_complete', docId, step: event.step, data: event.data };
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
              case 'title':
                if (titleAgent.processStream) {
                  yield* runAgentStream(titleAgent.processStream({ docId, content }));
                } else {
                  const result = yield* titleAgent.process({ docId, content });
                  yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: result }));
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
                  yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: result }));
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
                  yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: result }));
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
                  yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: result }));
                }
                break;

              case 'custom_fields':
                const customFields = yield* paperless.getCustomFields();
                if (customFieldsAgent.processStream) {
                  yield* runAgentStream(customFieldsAgent.processStream({
                    docId,
                    content,
                    customFields,
                  }));
                } else {
                  const result = yield* customFieldsAgent.process({
                    docId,
                    content,
                    customFields,
                  });
                  yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: result }));
                }
                break;

              case 'ocr':
                // OCR doesn't have a stream mode
                yield* Effect.sync(() => emit.single({ type: 'step_start', docId, step }));
                const ocrResult = yield* ocrAgent.process({ docId });
                yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: ocrResult }));
                break;

              case 'schema_analysis':
                // Schema analysis doesn't have a stream mode
                yield* Effect.sync(() => emit.single({ type: 'step_start', docId, step }));
                const schemaResult = yield* schemaAnalysisAgent.process({ docId, content });
                yield* Effect.sync(() => emit.single({ type: 'step_complete', docId, step, data: schemaResult }));
                break;

              default:
                yield* Effect.sync(() => emit.single({ type: 'step_error', docId, step, message: `Unknown step: ${step}` }));
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
