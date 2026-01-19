/**
 * LangGraph-based Document Type classification agent.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import {
  ConfigService,
  OllamaService,
  PromptService,
  TinyBaseService,
  PaperlessService,
  QdrantService,
} from '../services/index.js';
import { AgentError } from '../errors/index.js';
import type { Agent, AgentProcessResult, StreamEvent } from './base.js';
import {
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitComplete,
} from './base.js';
import {
  DocumentTypeAnalysisSchema,
  type DocumentTypeAnalysis,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createAgentTools,
  type ConfirmationLoopConfig,
  type ConfirmationLoopLogEvent,
} from './graph/index.js';
import type { ProcessingLogEventType } from '../services/TinyBaseService.js';

// ===========================================================================
// Types
// ===========================================================================

export interface DocumentTypeInput {
  docId: number;
  content: string;
  docTitle: string;
  existingDocumentTypes: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface DocumentTypeAgentGraphService extends Agent<DocumentTypeInput, AgentProcessResult> {
  readonly name: 'document_type';
  readonly process: (input: DocumentTypeInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: DocumentTypeInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const DocumentTypeAgentGraphService = Context.GenericTag<DocumentTypeAgentGraphService>('DocumentTypeAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a document classification specialist. Your task is to identify the document type/category.

## Tool Usage Guidelines

You have access to tools to search for similar processed documents. These tools are OPTIONAL and should be used sparingly:
- Only call a tool if you genuinely need more information
- If a tool returns "not found" or empty results, DO NOT call the same tool again - proceed with your analysis
- Make at most 2-3 tool calls total, then provide your final answer
- You can make your decision based on the document content alone if tools don't provide useful information

Document types describe what kind of document this is:
- Invoice, Receipt, Contract, Letter, Report
- Insurance document, Bank statement, Tax form
- Employment contract, Payslip, Certificate

Guidelines:
1. Select from existing document types when possible - they are pre-vetted
2. Be consistent: "Invoice" not sometimes "Bill" and sometimes "Receipt"
3. Only suggest new document types (is_new: true) if none of the existing types fit AND confidence is >0.9
4. Consider the document's purpose, not just its format

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing a document type classification.

Evaluation criteria:
- Is the document type accurate for this document?
- If marked as existing, does it correctly match an existing type?
- If marked as new, is there really no suitable existing type?
- Is it consistent with how similar documents are classified?

Confirm if the document type is correctly identified.
Reject if the wrong type was assigned, or an existing type could be used instead.

You MUST respond with structured JSON: { "confirmed": boolean, "feedback": string, "suggested_changes": string }`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const DocumentTypeAgentGraphServiceLive = Layer.effect(
  DocumentTypeAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const qdrant = yield* QdrantService;

    const { autoProcessing, tags: tagConfig } = config.config;
    const settings = yield* tinybase.getAllSettings();

    const ollamaUrl = settings['ollama.url'] ?? 'http://localhost:11434';
    const largeModel = ollama.getModel('large');
    const smallModel = ollama.getModel('small');

    const tools = createAgentTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    const graphConfig: ConfirmationLoopConfig<DocumentTypeAnalysis> = {
      agentName: 'document_type',
      analysisSchema: DocumentTypeAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools,
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as { existingDocumentTypes: string[] };
        return `## Document Content

${state.content.slice(0, 8000)}

## Existing Document Types

${ctx.existingDocumentTypes.join(', ')}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Classify this document. Use search tools to find similar documents if helpful.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        return `## Suggested Document Type

${analysis.suggested_document_type ?? 'None identified'}

## Is New Type

${analysis.is_new ? 'Yes (needs to be created)' : 'No (existing type)'}

## Reasoning

${analysis.reasoning}

## Confidence

${analysis.confidence}

## Alternatives

${analysis.alternatives.length ? analysis.alternatives.join(', ') : 'None'}

## Document Excerpt

${state.content.slice(0, 4000)}

Review this document type classification and provide your confirmation decision.`;
      },
    };

    return {
      name: 'document_type' as const,

      process: (input: DocumentTypeInput) =>
        Effect.gen(function* () {
          // Create logger to collect all events
          const logEntries: ConfirmationLoopLogEvent[] = [];
          const logger = (event: ConfirmationLoopLogEvent) => {
            logEntries.push(event);
          };

          // Log document context at start
          logger({
            eventType: 'prompt',
            data: {
              type: 'context',
              docId: input.docId,
              docTitle: input.docTitle,
              existingDocumentTypes: input.existingDocumentTypes,
            },
            timestamp: new Date().toISOString(),
          });

          // Create graph with logger
          const graphConfigWithLogger: ConfirmationLoopConfig<DocumentTypeAnalysis> = {
            ...graphConfig,
            logger,
          };
          const graph = createConfirmationLoopGraph(graphConfigWithLogger);

          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(graph, {
                docId: input.docId,
                docTitle: input.docTitle,
                content: input.content,
                context: { existingDocumentTypes: input.existingDocumentTypes },
                maxRetries: autoProcessing.confirmationMaxRetries,
              }, `doctype-${input.docId}-${Date.now()}`),
            catch: (e) => new AgentError({ message: `DocumentType graph failed: ${e}`, agent: 'document_type', cause: e }),
          });

          // Store all log entries (use captured timestamps and IDs)
          for (const entry of logEntries) {
            yield* tinybase.addProcessingLog({
              id: entry.id,
              docId: input.docId,
              timestamp: entry.timestamp,
              step: 'document_type',
              eventType: entry.eventType as ProcessingLogEventType,
              data: entry.data,
              parentId: entry.parentId,
            });
          }

          const analysis = result.analysis as DocumentTypeAnalysis | null;

          if (!result.success || !analysis || !analysis.suggested_document_type) {
            const pendingId = yield* tinybase.addPendingReview({
              docId: input.docId,
              docTitle: input.docTitle,
              type: 'document_type',
              suggestion: analysis?.suggested_document_type || '[Unable to determine - manual review required]',
              reasoning: analysis?.reasoning ?? result.error ?? 'Analysis failed',
              alternatives: analysis?.alternatives ?? [],
              attempts: result.attempts,
              lastFeedback: result.error ?? 'Max retries exceeded',
              nextTag: tagConfig.documentTypeDone,
              metadata: analysis ? JSON.stringify({ isNew: analysis.is_new }) : null,
            });

            yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

            // Log result
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'document_type',
              eventType: 'result',
              data: {
                success: false,
                needsReview: true,
                pendingReviewCreated: pendingId !== null,
                reasoning: result.error ?? 'Confirmation failed',
                attempts: result.attempts,
              },
            });

            return {
              success: false,
              value: analysis?.suggested_document_type ?? null,
              reasoning: result.error ?? 'Confirmation failed',
              confidence: analysis?.confidence ?? 0,
              alternatives: analysis?.alternatives ?? [],
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Check if blocked
          const isBlocked = yield* tinybase.isBlocked(analysis.suggested_document_type, 'document_type');
          if (isBlocked) {
            // Log blocked result
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'document_type',
              eventType: 'result',
              data: {
                success: false,
                blocked: true,
                value: analysis.suggested_document_type,
                reasoning: `Document type "${analysis.suggested_document_type}" is blocked`,
              },
            });

            return {
              success: false,
              value: null,
              reasoning: `Document type "${analysis.suggested_document_type}" is blocked`,
              confidence: 0,
              alternatives: analysis.alternatives,
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Apply the document type
          const docTypeId = yield* paperless.getOrCreateDocumentType(analysis.suggested_document_type);
          yield* paperless.updateDocument(input.docId, { document_type: docTypeId });
          yield* paperless.transitionDocumentTag(input.docId, tagConfig.correspondentDone, tagConfig.documentTypeDone);

          // Clean up any existing pending review for this document and type
          yield* tinybase.removePendingReviewByDocAndType(input.docId, 'document_type');

          // Remove manual review tag if it was previously set
          yield* paperless.removeTagFromDocument(input.docId, tagConfig.manualReview);

          // Log result
          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'document_type',
            eventType: 'result',
            data: {
              success: true,
              value: analysis.suggested_document_type,
              isNew: analysis.is_new,
              reasoning: analysis.reasoning,
              confidence: analysis.confidence,
              attempts: result.attempts,
            },
          });

          return {
            success: true,
            value: analysis.suggested_document_type,
            reasoning: analysis.reasoning,
            confidence: analysis.confidence,
            alternatives: analysis.alternatives,
            attempts: result.attempts,
            needsReview: false,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `DocumentType process failed: ${e}`, agent: 'document_type', cause: e })
          )
        ),

      processStream: (input: DocumentTypeInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('document_type')));

            // Create logger to collect all events
            const logEntries: ConfirmationLoopLogEvent[] = [];
            const logger = (event: ConfirmationLoopLogEvent) => {
              logEntries.push(event);
            };

            // Log document context at start
            logger({
              eventType: 'prompt',
              data: {
                type: 'context',
                docId: input.docId,
                docTitle: input.docTitle,
                existingDocumentTypes: input.existingDocumentTypes,
              },
              timestamp: new Date().toISOString(),
            });

            // Create graph with logger
            const graphConfigWithLogger: ConfirmationLoopConfig<DocumentTypeAnalysis> = {
              ...graphConfig,
              logger,
            };
            const graph = createConfirmationLoopGraph(graphConfigWithLogger);

            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(graph, {
                  docId: input.docId,
                  docTitle: input.docTitle,
                  content: input.content,
                  context: { existingDocumentTypes: input.existingDocumentTypes },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                }, `doctype-stream-${input.docId}-${Date.now()}`);

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Stream failed: ${result}`, agent: 'document_type' })));
              return;
            }

            let lastAnalysis: DocumentTypeAnalysis | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as DocumentTypeAnalysis;
                yield* Effect.sync(() => emit.single(emitAnalyzing('document_type', `Attempt ${(state.attempt as number) ?? 1}`)));
                yield* Effect.sync(() => emit.single(emitThinking('document_type', lastAnalysis!.reasoning)));
              }

              if (node === 'confirm' && lastAnalysis) {
                yield* Effect.sync(() => emit.single(emitConfirming('document_type', lastAnalysis!.suggested_document_type ?? 'None')));
              }

              if (node === 'apply' && lastAnalysis?.suggested_document_type) {
                const docTypeId = yield* paperless.getOrCreateDocumentType(lastAnalysis.suggested_document_type);
                yield* paperless.updateDocument(input.docId, { document_type: docTypeId });
                yield* paperless.transitionDocumentTag(input.docId, tagConfig.correspondentDone, tagConfig.documentTypeDone);

                // Clean up any existing pending review for this document and type
                yield* tinybase.removePendingReviewByDocAndType(input.docId, 'document_type');

                // Remove manual review tag if it was previously set
                yield* paperless.removeTagFromDocument(input.docId, tagConfig.manualReview);

                yield* Effect.sync(() => emit.single(emitResult('document_type', {
                  success: true,
                  value: lastAnalysis!.suggested_document_type,
                  isNew: lastAnalysis!.is_new,
                })));

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'document_type',
                  eventType: 'result',
                  data: {
                    success: true,
                    value: lastAnalysis.suggested_document_type,
                    isNew: lastAnalysis.is_new,
                    reasoning: lastAnalysis.reasoning,
                    confidence: lastAnalysis.confidence,
                  },
                });
              }

              if (node === 'queue_review') {
                const pendingId = yield* tinybase.addPendingReview({
                  docId: input.docId,
                  docTitle: input.docTitle,
                  type: 'document_type',
                  suggestion: lastAnalysis?.suggested_document_type || '[Unable to determine - manual review required]',
                  reasoning: lastAnalysis?.reasoning ?? 'Analysis failed',
                  alternatives: lastAnalysis?.alternatives ?? [],
                  attempts: autoProcessing.confirmationMaxRetries,
                  lastFeedback: 'Max retries exceeded',
                  nextTag: tagConfig.documentTypeDone,
                  metadata: lastAnalysis ? JSON.stringify({ isNew: lastAnalysis.is_new }) : null,
                });
                yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);
                yield* Effect.sync(() => emit.single(emitResult('document_type', { success: false, needsReview: true })));

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'document_type',
                  eventType: 'result',
                  data: {
                    success: false,
                    needsReview: true,
                    pendingReviewCreated: pendingId !== null,
                    reasoning: 'Max retries exceeded',
                  },
                });
              }
            }

            // Store all log entries (use captured timestamps and IDs)
            for (const entry of logEntries) {
              yield* tinybase.addProcessingLog({
                id: entry.id,
                docId: input.docId,
                timestamp: entry.timestamp,
                step: 'document_type',
                eventType: entry.eventType as ProcessingLogEventType,
                data: entry.data,
                parentId: entry.parentId,
              });
            }

            yield* Effect.sync(() => emit.single(emitComplete('document_type')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) => new AgentError({ message: `DocumentType stream failed: ${e}`, agent: 'document_type', cause: e }))
          )
        ),
    };
  })
);
