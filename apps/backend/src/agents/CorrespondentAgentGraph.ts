/**
 * LangGraph-based Correspondent extraction agent.
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
  CorrespondentAnalysisSchema,
  type CorrespondentAnalysis,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createAgentTools,
  type ConfirmationLoopConfig,
} from './graph/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface CorrespondentInput {
  docId: number;
  content: string;
  docTitle: string;
  existingCorrespondents: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface CorrespondentAgentGraphService extends Agent<CorrespondentInput, AgentProcessResult> {
  readonly name: 'correspondent';
  readonly process: (input: CorrespondentInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: CorrespondentInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CorrespondentAgentGraphService = Context.GenericTag<CorrespondentAgentGraphService>('CorrespondentAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a document analysis specialist focused on identifying correspondents (senders/originators).

You have access to tools to search for similar processed documents. Use these to see how correspondents are typically identified and named.

A correspondent is the sender, creator, or originating organization of a document. Look for:
- Letterhead with company/organization name
- Sender address (usually top-left or top-right)
- Signature block with name and company
- Logo indicating the sender
- Email/website domain names

Guidelines:
1. Select from existing correspondents when possible - the list is pre-vetted
2. Normalize for matching: ignore legal suffixes (GmbH, AG, Inc.) when matching variants
3. Be specific when matching: "Finanzamt München" matches "Finanzamt München", not "Finanzamt Berlin"
4. Only suggest new correspondents (is_new: true) if no existing one is remotely close AND confidence is >0.9

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing a correspondent identification.

Evaluation criteria:
- Is the identified correspondent actually the sender/originator of the document?
- If marked as existing, does it correctly match an existing correspondent?
- If marked as new, is there really no suitable existing correspondent?
- Is the reasoning sound?

Confirm if the correspondent is correctly identified.
Reject if the wrong entity was identified, or an existing correspondent could be used instead of creating new.

You MUST respond with structured JSON: { "confirmed": boolean, "feedback": string, "suggested_changes": string }`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const CorrespondentAgentGraphServiceLive = Layer.effect(
  CorrespondentAgentGraphService,
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

    const graphConfig: ConfirmationLoopConfig<CorrespondentAnalysis> = {
      agentName: 'correspondent',
      analysisSchema: CorrespondentAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools,
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as { existingCorrespondents: string[] };
        return `## Document Content

${state.content.slice(0, 8000)}

## Existing Correspondents

${ctx.existingCorrespondents.join(', ')}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Identify the correspondent (sender/creator) of this document. Use search tools to find similar documents if helpful.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        return `## Suggested Correspondent

${analysis.suggested_correspondent ?? 'None identified'}

## Is New Correspondent

${analysis.is_new ? 'Yes (needs to be created)' : 'No (existing correspondent)'}

## Reasoning

${analysis.reasoning}

## Confidence

${analysis.confidence}

## Alternatives

${analysis.alternatives.length ? analysis.alternatives.join(', ') : 'None'}

## Document Excerpt

${state.content.slice(0, 4000)}

Review this correspondent identification and provide your confirmation decision.`;
      },
    };

    const graph = createConfirmationLoopGraph(graphConfig);

    return {
      name: 'correspondent' as const,

      process: (input: CorrespondentInput) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(graph, {
                docId: input.docId,
                docTitle: input.docTitle,
                content: input.content,
                context: { existingCorrespondents: input.existingCorrespondents },
                maxRetries: autoProcessing.confirmationMaxRetries,
              }, `correspondent-${input.docId}-${Date.now()}`),
            catch: (e) => new AgentError({ message: `Correspondent graph failed: ${e}`, agent: 'correspondent', cause: e }),
          });

          const analysis = result.analysis as CorrespondentAnalysis | null;

          if (!result.success || !analysis || !analysis.suggested_correspondent) {
            yield* tinybase.addPendingReview({
              docId: input.docId,
              docTitle: input.docTitle,
              type: 'correspondent',
              suggestion: analysis?.suggested_correspondent ?? '',
              reasoning: analysis?.reasoning ?? result.error ?? 'Analysis failed',
              alternatives: analysis?.alternatives ?? [],
              attempts: result.attempts,
              lastFeedback: result.error ?? 'Max retries exceeded',
              nextTag: tagConfig.correspondentDone,
              metadata: analysis ? JSON.stringify({ isNew: analysis.is_new }) : null,
            });

            yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

            return {
              success: false,
              value: analysis?.suggested_correspondent ?? null,
              reasoning: result.error ?? 'Confirmation failed',
              confidence: analysis?.confidence ?? 0,
              alternatives: analysis?.alternatives ?? [],
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Check if blocked
          const isBlocked = yield* tinybase.isBlocked(analysis.suggested_correspondent, 'correspondent');
          if (isBlocked) {
            return {
              success: false,
              value: null,
              reasoning: `Correspondent "${analysis.suggested_correspondent}" is blocked`,
              confidence: 0,
              alternatives: analysis.alternatives,
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Apply the correspondent
          const correspondentId = yield* paperless.getOrCreateCorrespondent(analysis.suggested_correspondent);
          yield* paperless.updateDocument(input.docId, { correspondent: correspondentId });
          yield* paperless.transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone);

          return {
            success: true,
            value: analysis.suggested_correspondent,
            reasoning: analysis.reasoning,
            confidence: analysis.confidence,
            alternatives: analysis.alternatives,
            attempts: result.attempts,
            needsReview: false,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `Correspondent process failed: ${e}`, agent: 'correspondent', cause: e })
          )
        ),

      processStream: (input: CorrespondentInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('correspondent')));

            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(graph, {
                  docId: input.docId,
                  docTitle: input.docTitle,
                  content: input.content,
                  context: { existingCorrespondents: input.existingCorrespondents },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                }, `correspondent-stream-${input.docId}-${Date.now()}`);

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Stream failed: ${result}`, agent: 'correspondent' })));
              return;
            }

            let lastAnalysis: CorrespondentAnalysis | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as CorrespondentAnalysis;
                yield* Effect.sync(() => emit.single(emitAnalyzing('correspondent', `Attempt ${(state.attempt as number) ?? 1}`)));
                yield* Effect.sync(() => emit.single(emitThinking('correspondent', lastAnalysis!.reasoning)));
              }

              if (node === 'confirm' && lastAnalysis) {
                yield* Effect.sync(() => emit.single(emitConfirming('correspondent', lastAnalysis!.suggested_correspondent ?? 'None')));
              }

              if (node === 'apply' && lastAnalysis?.suggested_correspondent) {
                const correspondentId = yield* paperless.getOrCreateCorrespondent(lastAnalysis.suggested_correspondent);
                yield* paperless.updateDocument(input.docId, { correspondent: correspondentId });
                yield* paperless.transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone);
                yield* Effect.sync(() => emit.single(emitResult('correspondent', {
                  success: true,
                  value: lastAnalysis!.suggested_correspondent,
                  isNew: lastAnalysis!.is_new,
                })));
              }

              if (node === 'queue_review') {
                yield* tinybase.addPendingReview({
                  docId: input.docId,
                  docTitle: input.docTitle,
                  type: 'correspondent',
                  suggestion: lastAnalysis?.suggested_correspondent ?? '',
                  reasoning: lastAnalysis?.reasoning ?? 'Analysis failed',
                  alternatives: lastAnalysis?.alternatives ?? [],
                  attempts: autoProcessing.confirmationMaxRetries,
                  lastFeedback: 'Max retries exceeded',
                  nextTag: tagConfig.correspondentDone,
                  metadata: lastAnalysis ? JSON.stringify({ isNew: lastAnalysis.is_new }) : null,
                });
                yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);
                yield* Effect.sync(() => emit.single(emitResult('correspondent', { success: false, needsReview: true })));
              }
            }

            yield* Effect.sync(() => emit.single(emitComplete('correspondent')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) => new AgentError({ message: `Correspondent stream failed: ${e}`, agent: 'correspondent', cause: e }))
          )
        ),
    };
  })
);
