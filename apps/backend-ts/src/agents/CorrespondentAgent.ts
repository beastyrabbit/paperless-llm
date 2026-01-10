/**
 * Correspondent extraction agent.
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

export interface CorrespondentInput {
  docId: number;
  content: string;
  docTitle: string;
  existingCorrespondents: string[];
}

export interface CorrespondentAnalysis {
  suggestedCorrespondent: string;
  isNew: boolean;
  reasoning: string;
  confidence: number;
  alternatives: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface CorrespondentAgentService extends Agent<CorrespondentInput, AgentProcessResult> {
  readonly name: 'correspondent';
  readonly process: (input: CorrespondentInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: CorrespondentInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CorrespondentAgentService = Context.GenericTag<CorrespondentAgentService>('CorrespondentAgentService');

// ===========================================================================
// Response Parsers
// ===========================================================================

const parseAnalysisResponse = (response: string, existingCorrespondents: string[]): CorrespondentAnalysis => {
  try {
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        correspondent?: string;
        suggested_correspondent?: string;
        is_new?: boolean;
        isNew?: boolean;
        reasoning?: string;
        confidence?: number;
        alternatives?: string[];
      };

      const suggested = parsed.correspondent ?? parsed.suggested_correspondent ?? '';
      const isNew = !existingCorrespondents.some(
        (c) => c.toLowerCase() === suggested.toLowerCase()
      );

      return {
        suggestedCorrespondent: suggested,
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
  const suggested = lines[0]?.replace(/^(Correspondent:|Suggested:)\s*/i, '') ?? '';
  const isNew = !existingCorrespondents.some(
    (c) => c.toLowerCase() === suggested.toLowerCase()
  );

  return {
    suggestedCorrespondent: suggested,
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

export const CorrespondentAgentServiceLive = Layer.effect(
  CorrespondentAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    const { autoProcessing, tags: tagConfig } = config.config;

    return {
      name: 'correspondent' as const,

      process: (input: CorrespondentInput) =>
        runConfirmationLoop<CorrespondentAnalysis, AgentProcessResult>({
          maxRetries: autoProcessing.confirmationMaxRetries,

          analyze: (feedback) =>
            Effect.gen(function* () {
              const isBlocked = (name: string) =>
                tinybase.isBlocked(name, 'correspondent');

              const prompt = yield* prompts.renderPrompt('correspondent', {
                document_content: input.content.slice(0, 8000),
                existing_correspondents: JSON.stringify(input.existingCorrespondents),
                feedback: feedback ?? 'None',
              });

              const response = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(response, input.existingCorrespondents);

              // Check if blocked
              const blocked = yield* isBlocked(analysis.suggestedCorrespondent);
              if (blocked) {
                return {
                  ...analysis,
                  suggestedCorrespondent: '',
                  reasoning: `Blocked: ${analysis.suggestedCorrespondent}`,
                  confidence: 0,
                };
              }

              return analysis;
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Correspondent analysis failed: ${e}`,
                  agent: 'correspondent',
                  step: 'analyze',
                  cause: e,
                })
              )
            ),

          confirm: (analysis) =>
            Effect.gen(function* () {
              if (!analysis.suggestedCorrespondent) {
                return { confirmed: false, feedback: 'No correspondent suggested' };
              }

              const prompt = yield* prompts.renderPrompt('correspondent_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_correspondent: analysis.suggestedCorrespondent,
                is_new: analysis.isNew ? 'Yes (new correspondent)' : 'No (existing)',
                reasoning: analysis.reasoning,
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
                  message: `Correspondent confirmation failed: ${e}`,
                  agent: 'correspondent',
                  step: 'confirm',
                  cause: e,
                })
              )
            ),

          apply: (analysis) =>
            Effect.gen(function* () {
              const correspondentId = yield* paperless.getOrCreateCorrespondent(
                analysis.suggestedCorrespondent
              );

              yield* paperless.updateDocument(input.docId, {
                correspondent: correspondentId,
              });

              // Atomic tag transition to avoid race conditions
              // CorrespondentAgent runs after TitleAgent, so remove titleDone
              yield* paperless.transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone);

              return {
                success: true,
                value: analysis.suggestedCorrespondent,
                reasoning: analysis.reasoning,
                confidence: analysis.confidence,
                alternatives: analysis.alternatives,
                attempts: 1,
                needsReview: false,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Correspondent application failed: ${e}`,
                  agent: 'correspondent',
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
                type: 'correspondent',
                suggestion: lastAnalysis.suggestedCorrespondent,
                reasoning: lastAnalysis.reasoning,
                alternatives: lastAnalysis.alternatives,
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.correspondentDone,
                metadata: JSON.stringify({ isNew: lastAnalysis.isNew }),
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              return {
                success: false,
                value: lastAnalysis.suggestedCorrespondent,
                reasoning: lastAnalysis.reasoning,
                confidence: lastAnalysis.confidence,
                alternatives: lastAnalysis.alternatives,
                attempts: autoProcessing.confirmationMaxRetries,
                needsReview: true,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Correspondent queue failed: ${e}`,
                  agent: 'correspondent',
                  step: 'queue',
                  cause: e,
                })
              )
            ),
        }),

      processStream: (input: CorrespondentInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('correspondent')));

            let feedback: string | null = null;
            let lastAnalysis: CorrespondentAnalysis | null = null;

            for (let attempt = 0; attempt < autoProcessing.confirmationMaxRetries; attempt++) {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('correspondent', `Attempt ${attempt + 1}`))
              );

              const prompt = yield* prompts.renderPrompt('correspondent', {
                document_content: input.content.slice(0, 8000),
                existing_correspondents: JSON.stringify(input.existingCorrespondents),
                feedback: feedback ?? 'None',
              });

              const analysisResponse = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(analysisResponse, input.existingCorrespondents);

              // Check if blocked
              const blocked = yield* tinybase.isBlocked(analysis.suggestedCorrespondent, 'correspondent');
              if (blocked) {
                feedback = `${analysis.suggestedCorrespondent} is blocked`;
                continue;
              }

              lastAnalysis = analysis;

              yield* Effect.sync(() =>
                emit.single(emitThinking('correspondent', analysis.reasoning))
              );

              yield* Effect.sync(() =>
                emit.single(emitConfirming('correspondent', analysis.suggestedCorrespondent))
              );

              const confirmPrompt = yield* prompts.renderPrompt('correspondent_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_correspondent: analysis.suggestedCorrespondent,
                is_new: analysis.isNew ? 'Yes' : 'No',
                reasoning: analysis.reasoning,
              });

              const confirmResponse = yield* ollama.generate(
                ollama.getModel('small'),
                confirmPrompt,
                { temperature: 0 }
              );

              const confirmation = parseConfirmationResponse(confirmResponse);

              if (confirmation.confirmed) {
                const correspondentId = yield* paperless.getOrCreateCorrespondent(
                  analysis.suggestedCorrespondent
                );

                yield* paperless.updateDocument(input.docId, {
                  correspondent: correspondentId,
                });

                // Atomic tag transition to avoid race conditions
                yield* paperless.transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone);

                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('correspondent', {
                      success: true,
                      value: analysis.suggestedCorrespondent,
                      isNew: analysis.isNew,
                      attempts: attempt + 1,
                    })
                  )
                );

                yield* Effect.sync(() => emit.single(emitComplete('correspondent')));
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
                type: 'correspondent',
                suggestion: lastAnalysis.suggestedCorrespondent,
                reasoning: lastAnalysis.reasoning,
                alternatives: lastAnalysis.alternatives,
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.correspondentDone,
                metadata: JSON.stringify({ isNew: lastAnalysis.isNew }),
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              yield* Effect.sync(() =>
                emit.single(
                  emitResult('correspondent', {
                    success: false,
                    value: lastAnalysis.suggestedCorrespondent,
                    needsReview: true,
                  })
                )
              );
            }

            yield* Effect.sync(() => emit.single(emitComplete('correspondent')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Correspondent stream failed: ${e}`,
                agent: 'correspondent',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
