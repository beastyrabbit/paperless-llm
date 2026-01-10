/**
 * Title generation agent.
 */
import { Effect, Context, Layer, Stream, pipe } from 'effect';
import { ChatOllama } from '@langchain/ollama';
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
  emitError,
  emitComplete,
} from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export interface TitleInput {
  docId: number;
  content: string;
  existingTitle?: string;
  similarTitles?: string[];
}

export interface TitleAnalysis {
  suggestedTitle: string;
  reasoning: string;
  confidence: number;
  basedOnSimilar: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface TitleAgentService extends Agent<TitleInput, AgentProcessResult> {
  readonly name: 'title';
  readonly process: (input: TitleInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: TitleInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const TitleAgentService = Context.GenericTag<TitleAgentService>('TitleAgentService');

// ===========================================================================
// Analysis Prompt Parser
// ===========================================================================

const parseAnalysisResponse = (response: string): TitleAnalysis => {
  try {
    // Try to parse JSON from the response
    const jsonMatch = response.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]) as {
        suggested_title?: string;
        suggestedTitle?: string;
        reasoning?: string;
        confidence?: number;
        based_on_similar?: string[];
        basedOnSimilar?: string[];
      };
      return {
        suggestedTitle: parsed.suggested_title ?? parsed.suggestedTitle ?? '',
        reasoning: parsed.reasoning ?? '',
        confidence: parsed.confidence ?? 0.5,
        basedOnSimilar: parsed.based_on_similar ?? parsed.basedOnSimilar ?? [],
      };
    }
  } catch {
    // Fall back to extracting from text
  }

  // Simple text extraction fallback
  const lines = response.split('\n').filter(Boolean);
  return {
    suggestedTitle: lines[0]?.replace(/^(Title:|Suggested:)\s*/i, '') ?? 'Untitled',
    reasoning: lines.slice(1).join(' ').slice(0, 200),
    confidence: 0.5,
    basedOnSimilar: [],
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

export const TitleAgentServiceLive = Layer.effect(
  TitleAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    const { autoProcessing, tags: tagConfig } = config.config;

    return {
      name: 'title' as const,

      process: (input: TitleInput) =>
        runConfirmationLoop<TitleAnalysis, AgentProcessResult>({
          maxRetries: autoProcessing.confirmationMaxRetries,

          analyze: (feedback) =>
            Effect.gen(function* () {
              const prompt = yield* prompts.renderPrompt('title', {
                document_content: input.content.slice(0, 8000),
                similar_titles: JSON.stringify(input.similarTitles ?? []),
                feedback: feedback ?? 'None',
              });

              const response = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              return parseAnalysisResponse(response);
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Title analysis failed: ${e}`,
                  agent: 'title',
                  step: 'analyze',
                  cause: e,
                })
              )
            ),

          confirm: (analysis) =>
            Effect.gen(function* () {
              const prompt = yield* prompts.renderPrompt('title_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_title: analysis.suggestedTitle,
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
                  message: `Title confirmation failed: ${e}`,
                  agent: 'title',
                  step: 'confirm',
                  cause: e,
                })
              )
            ),

          apply: (analysis) =>
            Effect.gen(function* () {
              yield* paperless.updateDocument(input.docId, {
                title: analysis.suggestedTitle,
              });

              // Atomic tag transition to avoid race conditions
              yield* paperless.transitionDocumentTag(input.docId, tagConfig.ocrDone, tagConfig.titleDone);

              return {
                success: true,
                value: analysis.suggestedTitle,
                reasoning: analysis.reasoning,
                confidence: analysis.confidence,
                alternatives: analysis.basedOnSimilar,
                attempts: 1,
                needsReview: false,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Title application failed: ${e}`,
                  agent: 'title',
                  step: 'apply',
                  cause: e,
                })
              )
            ),

          onMaxRetries: (lastAnalysis) =>
            Effect.gen(function* () {
              // Add to pending review queue
              yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.existingTitle ?? 'Untitled',
                type: 'title',
                suggestion: lastAnalysis.suggestedTitle,
                reasoning: lastAnalysis.reasoning,
                alternatives: lastAnalysis.basedOnSimilar,
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.titleDone,
                metadata: null,
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              return {
                success: false,
                value: lastAnalysis.suggestedTitle,
                reasoning: lastAnalysis.reasoning,
                confidence: lastAnalysis.confidence,
                alternatives: lastAnalysis.basedOnSimilar,
                attempts: autoProcessing.confirmationMaxRetries,
                needsReview: true,
              };
            }).pipe(
              Effect.mapError((e) =>
                new AgentError({
                  message: `Title queue failed: ${e}`,
                  agent: 'title',
                  step: 'queue',
                  cause: e,
                })
              )
            ),
        }),

      processStream: (input: TitleInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('title')));

            let feedback: string | null = null;
            let lastAnalysis: TitleAnalysis | null = null;

            for (let attempt = 0; attempt < autoProcessing.confirmationMaxRetries; attempt++) {
              yield* Effect.sync(() =>
                emit.single(emitAnalyzing('title', `Attempt ${attempt + 1}`))
              );

              // Analyze
              const prompt = yield* prompts.renderPrompt('title', {
                document_content: input.content.slice(0, 8000),
                similar_titles: JSON.stringify(input.similarTitles ?? []),
                feedback: feedback ?? 'None',
              });

              const analysisResponse = yield* ollama.generate(
                ollama.getModel('large'),
                prompt,
                { temperature: 0.1 }
              );

              const analysis = parseAnalysisResponse(analysisResponse);
              lastAnalysis = analysis;

              yield* Effect.sync(() =>
                emit.single(emitThinking('title', analysis.reasoning))
              );

              // Confirm
              yield* Effect.sync(() =>
                emit.single(emitConfirming('title', analysis.suggestedTitle))
              );

              const confirmPrompt = yield* prompts.renderPrompt('title_confirmation', {
                document_excerpt: input.content.slice(0, 4000),
                suggested_title: analysis.suggestedTitle,
                reasoning: analysis.reasoning,
              });

              const confirmResponse = yield* ollama.generate(
                ollama.getModel('small'),
                confirmPrompt,
                { temperature: 0 }
              );

              const confirmation = parseConfirmationResponse(confirmResponse);

              if (confirmation.confirmed) {
                yield* paperless.updateDocument(input.docId, {
                  title: analysis.suggestedTitle,
                });

                // Atomic tag transition to avoid race conditions
                yield* paperless.transitionDocumentTag(input.docId, tagConfig.ocrDone, tagConfig.titleDone);

                yield* Effect.sync(() =>
                  emit.single(
                    emitResult('title', {
                      success: true,
                      value: analysis.suggestedTitle,
                      attempts: attempt + 1,
                    })
                  )
                );

                yield* Effect.sync(() => emit.single(emitComplete('title')));
                yield* Effect.sync(() => emit.end());
                return;
              }

              feedback = confirmation.feedback ?? 'Not confirmed';
            }

            // Max retries - queue for review
            if (lastAnalysis) {
              yield* tinybase.addPendingReview({
                docId: input.docId,
                docTitle: input.existingTitle ?? 'Untitled',
                type: 'title',
                suggestion: lastAnalysis.suggestedTitle,
                reasoning: lastAnalysis.reasoning,
                alternatives: lastAnalysis.basedOnSimilar,
                attempts: autoProcessing.confirmationMaxRetries,
                lastFeedback: 'Max retries exceeded',
                nextTag: tagConfig.titleDone,
                metadata: null,
              });

              yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

              yield* Effect.sync(() =>
                emit.single(
                  emitResult('title', {
                    success: false,
                    value: lastAnalysis.suggestedTitle,
                    needsReview: true,
                  })
                )
              );
            }

            yield* Effect.sync(() => emit.single(emitComplete('title')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) =>
              new AgentError({
                message: `Title stream failed: ${e}`,
                agent: 'title',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
