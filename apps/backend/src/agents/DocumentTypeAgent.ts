/**
 * Document Type classification agent.
 */
import { Effect, Context, Layer, Stream } from 'effect';
import { ConfigService, OllamaService, PromptService, TinyBaseService, PaperlessService } from '../services/index.js';
import { AgentError } from '../errors/index.js';
import {
  type Agent,
  type AgentProcessResult,
  type StreamEvent,
  runConfirmationLoop,
  emitStart,
  emitThinking,
  emitAnalyzing,
  emitConfirming,
  emitResult,
  emitComplete,
} from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export interface DocumentTypeInput {
  docId: number;
  content: string;
  docTitle: string;
  existingDocumentTypes: string[];
}

export interface DocumentTypeAnalysis {
  suggestedDocumentType: string;
  isNew: boolean;
  reasoning: string;
  confidence: number;
  alternatives: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface DocumentTypeAgentService extends Agent<DocumentTypeInput, AgentProcessResult> {
  readonly name: 'document_type';
  readonly process: (input: DocumentTypeInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: DocumentTypeInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const DocumentTypeAgentService = Context.GenericTag<DocumentTypeAgentService>('DocumentTypeAgentService');

// ===========================================================================
// Response Parsers
// ===========================================================================

const parseAnalysisResponse = (response: string, existingTypes: string[]): DocumentTypeAnalysis => {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        document_type?: string;
        suggested_document_type?: string;
        documentType?: string;
        is_new?: boolean;
        isNew?: boolean;
        reasoning?: string;
        confidence?: number;
        alternatives?: string[];
      };

      const suggested = parsed.document_type ?? parsed.suggested_document_type ?? parsed.documentType ?? '';
      const isNew = !existingTypes.some(
        (t) => t.toLowerCase() === suggested.toLowerCase()
      );

      return {
        suggestedDocumentType: suggested,
        isNew: parsed.is_new ?? parsed.isNew ?? isNew,
        reasoning: parsed.reasoning ?? '',
        confidence: parsed.confidence ?? 0.5,
        alternatives: parsed.alternatives ?? [],
      };
    }
  } catch {
    // Fall back to text extraction
  }

  const lines = response.split('\n').filter(Boolean);
  const suggested = lines[0]?.replace(/^(Document Type:|Type:|Suggested:)\s*/i, '') ?? '';
  const isNew = !existingTypes.some(
    (t) => t.toLowerCase() === suggested.toLowerCase()
  );

  return {
    suggestedDocumentType: suggested,
    isNew,
    reasoning: lines.slice(1).join(' ').slice(0, 200),
    confidence: 0.5,
    alternatives: [],
  };
};

const parseConfirmationResponse = (response: string): { confirmed: boolean; feedback?: string } => {
  const lower = response.toLowerCase();
  const confirmed = lower.includes('yes') || lower.includes('confirmed') || lower.includes('accept');
  const feedback = confirmed ? undefined : response.replace(/^(no|rejected|feedback:)\s*/i, '');
  return { confirmed, feedback };
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const DocumentTypeAgentServiceLive = Layer.effect(
  DocumentTypeAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    const { autoProcessing, tags: tagConfig } = config.config;

    return {
      name: 'document_type' as const,

      process: (input: DocumentTypeInput) =>
        runConfirmationLoop<DocumentTypeAnalysis, AgentProcessResult>({
          maxRetries: autoProcessing.confirmationMaxRetries,

          analyze: (feedback) =>
            Effect.gen(function* () {
              const isBlocked = (name: string) =>
                tinybase.isBlocked(name, 'document_type');

              const prompt = yield* prompts.renderPrompt('document_type', {
                document_content: input.content.slice(0, 8000),
                existing_types: JSON.stringify(input.existingDocumentTypes),
                feedback: feedback ?? 'None',
              });

              const response = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(response, input.existingDocumentTypes);

              // Check if blocked
              const blocked = yield* isBlocked(analysis.suggestedDocumentType);
              if (blocked) {
                return {
                  ...analysis,
                  suggestedDocumentType: '',
                  reasoning: `Blocked: ${analysis.suggestedDocumentType}`,
                  confidence: 0,
                };
              }

              return analysis;
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Document type analysis failed: ${e}`,
                  agent: 'document_type',
                  step: 'analyze',
                  cause: e,
                })
              )
            ),

          confirm: (analysis) =>
            Effect.gen(function* () {
              if (!analysis.suggestedDocumentType) {
                return { confirmed: false, feedback: 'No document type suggested' };
              }

              const prompt = yield* prompts.renderPrompt('document_type_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_document_type: analysis.suggestedDocumentType,
                is_new: analysis.isNew ? 'Yes (new document type)' : 'No (existing)',
                reasoning: analysis.reasoning,
                existing_types: JSON.stringify(input.existingDocumentTypes),
              });

              const response = yield* ollama.generate(
                ollama.getModel('small'),
                prompt,
                { temperature: 0 }
              );

              return parseConfirmationResponse(response);
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Document type confirmation failed: ${e}`,
                  agent: 'document_type',
                  step: 'confirm',
                  cause: e,
                })
              )
            ),

          apply: (analysis) =>
            Effect.gen(function* () {
              const docTypeId = yield* paperless.getOrCreateDocumentType(
                analysis.suggestedDocumentType
              );

              yield* paperless.updateDocument(input.docId, {
                document_type: docTypeId,
              });

              // DocumentTypeAgent runs after CorrespondentAgent
              yield* paperless.transitionDocumentTag(
                input.docId,
                tagConfig.correspondentDone,
                tagConfig.documentTypeDone
              );

              return {
                success: true,
                value: analysis.suggestedDocumentType,
                reasoning: analysis.reasoning,
                confidence: analysis.confidence,
                alternatives: analysis.alternatives,
                attempts: 1,
                needsReview: false,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Document type application failed: ${e}`,
                  agent: 'document_type',
                  step: 'apply',
                  cause: e,
                })
              )
            ),

          onMaxRetries: (lastAnalysis) =>
            Effect.gen(function* () {
              yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.docTitle,
                type: 'document_type',
                suggestion: lastAnalysis.suggestedDocumentType,
                reasoning: lastAnalysis.reasoning,
                alternatives: lastAnalysis.alternatives,
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.documentTypeDone,
                metadata: JSON.stringify({ isNew: lastAnalysis.isNew }),
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              return {
                success: false,
                value: lastAnalysis.suggestedDocumentType,
                reasoning: lastAnalysis.reasoning,
                confidence: lastAnalysis.confidence,
                alternatives: lastAnalysis.alternatives,
                attempts: autoProcessing.confirmationMaxRetries,
                needsReview: true,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Document type queue failed: ${e}`,
                  agent: 'document_type',
                  step: 'queue',
                  cause: e,
                })
              )
            ),
        }),

      processStream: (input: DocumentTypeInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('document_type')));

            let feedback: string | null = null;
            let lastAnalysis: DocumentTypeAnalysis | null = null;

            for (let attempt = 0; attempt < autoProcessing.confirmationMaxRetries; attempt++) {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('document_type', `Attempt ${attempt + 1}`))
              );

              const prompt = yield* prompts.renderPrompt('document_type', {
                document_content: input.content.slice(0, 8000),
                existing_types: JSON.stringify(input.existingDocumentTypes),
                feedback: feedback ?? 'None',
              });

              const analysisResponse = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(analysisResponse, input.existingDocumentTypes);

              // Check if blocked
              const blocked = yield* tinybase.isBlocked(analysis.suggestedDocumentType, 'document_type');
              if (blocked) {
                feedback = `${analysis.suggestedDocumentType} is blocked`;
                continue;
              }

              lastAnalysis = analysis;

              yield* Effect.sync(() =>
                emit.single(emitThinking('document_type', analysis.reasoning))
              );

              yield* Effect.sync(() =>
                emit.single(emitConfirming('document_type', analysis.suggestedDocumentType))
              );

              const confirmPrompt = yield* prompts.renderPrompt('document_type_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_document_type: analysis.suggestedDocumentType,
                is_new: analysis.isNew ? 'Yes' : 'No',
                reasoning: analysis.reasoning,
                existing_types: JSON.stringify(input.existingDocumentTypes),
              });

              const confirmResponse = yield* ollama.generate(
                ollama.getModel('small'),
                confirmPrompt,
                { temperature: 0 }
              );

              const confirmation = parseConfirmationResponse(confirmResponse);

              if (confirmation.confirmed) {
                const docTypeId = yield* paperless.getOrCreateDocumentType(
                  analysis.suggestedDocumentType
                );

                yield* paperless.updateDocument(input.docId, {
                  document_type: docTypeId,
                });

                yield* paperless.transitionDocumentTag(
                  input.docId,
                  tagConfig.correspondentDone,
                  tagConfig.documentTypeDone
                );

                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('document_type', {
                      success: true,
                      value: analysis.suggestedDocumentType,
                      isNew: analysis.isNew,
                      attempts: attempt + 1,
                    })
                  )
                );

                yield* Effect.sync(() => emit.single(emitComplete('document_type')));
                yield* Effect.sync(() => emit.end());
                return;
              }

              feedback = confirmation.feedback ?? 'Not confirmed';
            }

            // Max retries - queue for review
            if (lastAnalysis) {
              yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.docTitle,
                type: 'document_type',
                suggestion: lastAnalysis.suggestedDocumentType,
                reasoning: lastAnalysis.reasoning,
                alternatives: lastAnalysis.alternatives,
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.documentTypeDone,
                metadata: JSON.stringify({ isNew: lastAnalysis.isNew }),
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              yield* Effect.sync(() =>
                emit.single(
                  emitResult('document_type', {
                    success: false,
                    value: lastAnalysis.suggestedDocumentType,
                    needsReview: true,
                  })
                )
              );
            }

            yield* Effect.sync(() => emit.single(emitComplete('document_type')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Document type stream failed: ${e}`,
                agent: 'document_type',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
