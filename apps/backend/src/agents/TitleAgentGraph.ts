/**
 * LangGraph-based Title generation agent.
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
  TitleAnalysisSchema,
  type TitleAnalysis,
  createConfirmationLoopGraph,
  runConfirmationLoop,
  streamConfirmationLoop,
  createAgentTools,
  type ConfirmationLoopConfig,
} from './graph/index.js';

// ===========================================================================
// Types
// ===========================================================================

export interface TitleInput {
  docId: number;
  content: string;
  existingTitle?: string;
  similarTitles?: string[];
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface TitleAgentGraphService extends Agent<TitleInput, AgentProcessResult> {
  readonly name: 'title';
  readonly process: (input: TitleInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: TitleInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const TitleAgentGraphService = Context.GenericTag<TitleAgentGraphService>('TitleAgentGraphService');

// ===========================================================================
// System Prompts
// ===========================================================================

const ANALYSIS_SYSTEM_PROMPT = `You are a document title specialist. Your task is to analyze documents and suggest clear, descriptive, professional titles.

You have access to tools to search for similar processed documents. Use these to find examples of how similar documents were titled.

Guidelines:
1. Titles should be concise but informative (3-10 words)
2. Include key identifying information: document type, organization, subject, date (if relevant)
3. Follow patterns from similar documents in the system
4. Use the same language as the document content
5. Avoid overly generic titles like "Document" or overly detailed ones with long reference numbers

You MUST respond with structured JSON matching the required schema.`;

const CONFIRMATION_SYSTEM_PROMPT = `You are a quality assurance assistant reviewing a title suggestion.

Evaluation criteria:
- Does the title accurately describe the document?
- Is it the right length (not too short or too long)?
- Does it follow the format of similar documents?
- Is the language appropriate (matches document language)?

Confirm if the title captures the document's essence and follows established patterns.
Reject if the title is too generic, too specific, misses key information, or uses wrong language.

You MUST respond with structured JSON: { "confirmed": boolean, "feedback": string, "suggested_changes": string }`;

// ===========================================================================
// Live Implementation
// ===========================================================================

export const TitleAgentGraphServiceLive = Layer.effect(
  TitleAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const prompts = yield* PromptService;
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

    const graphConfig: ConfirmationLoopConfig<TitleAnalysis> = {
      agentName: 'title',
      analysisSchema: TitleAnalysisSchema,
      analysisSystemPrompt: ANALYSIS_SYSTEM_PROMPT,
      confirmationSystemPrompt: CONFIRMATION_SYSTEM_PROMPT,
      tools,
      largeModelUrl: ollamaUrl,
      largeModelName: largeModel,
      smallModelUrl: ollamaUrl,
      smallModelName: smallModel,

      buildAnalysisPrompt: (state) => {
        const ctx = state.context as { similarTitles?: string[] };
        return `## Document Content

${state.content.slice(0, 8000)}

## Similar Document Titles (for reference)

${ctx.similarTitles?.length ? ctx.similarTitles.join('\n') : 'None available'}

${state.feedback ? `## Previous Feedback\n\n${state.feedback}` : ''}

Analyze this document and suggest an appropriate title. Use the search tools to find similar documents if needed.`;
      },

      buildConfirmationPrompt: (state, analysis) => {
        return `## Suggested Title

"${analysis.suggested_title}"

## Reasoning

${analysis.reasoning}

## Confidence

${analysis.confidence}

## Based on Similar Documents

${analysis.based_on_similar.length ? analysis.based_on_similar.join(', ') : 'None'}

## Document Excerpt

${state.content.slice(0, 4000)}

Review this title suggestion and provide your confirmation decision.`;
      },
    };

    const graph = createConfirmationLoopGraph(graphConfig);

    return {
      name: 'title' as const,

      process: (input: TitleInput) =>
        Effect.gen(function* () {
          const result = yield* Effect.tryPromise({
            try: () =>
              runConfirmationLoop(graph, {
                docId: input.docId,
                docTitle: input.existingTitle ?? 'Untitled',
                content: input.content,
                context: { similarTitles: input.similarTitles },
                maxRetries: autoProcessing.confirmationMaxRetries,
              }, `title-${input.docId}-${Date.now()}`),
            catch: (e) => new AgentError({ message: `Title graph failed: ${e}`, agent: 'title', cause: e }),
          });

          const analysis = result.analysis as TitleAnalysis | null;

          if (!result.success || !analysis) {
            yield* tinybase.addPendingReview({
              docId: input.docId,
              docTitle: input.existingTitle ?? 'Untitled',
              type: 'title',
              suggestion: analysis?.suggested_title ?? '',
              reasoning: analysis?.reasoning ?? result.error ?? 'Analysis failed',
              alternatives: analysis?.based_on_similar ?? [],
              attempts: result.attempts,
              lastFeedback: result.error ?? 'Max retries exceeded',
              nextTag: tagConfig.titleDone,
              metadata: null,
            });

            yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);

            return {
              success: false,
              value: analysis?.suggested_title ?? null,
              reasoning: result.error ?? 'Confirmation failed',
              confidence: analysis?.confidence ?? 0,
              alternatives: analysis?.based_on_similar ?? [],
              attempts: result.attempts,
              needsReview: true,
            };
          }

          // Apply the title
          yield* paperless.updateDocument(input.docId, { title: analysis.suggested_title });
          yield* paperless.transitionDocumentTag(input.docId, tagConfig.ocrDone, tagConfig.titleDone);

          return {
            success: true,
            value: analysis.suggested_title,
            reasoning: analysis.reasoning,
            confidence: analysis.confidence,
            alternatives: analysis.based_on_similar,
            attempts: result.attempts,
            needsReview: false,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError ? e : new AgentError({ message: `Title process failed: ${e}`, agent: 'title', cause: e })
          )
        ),

      processStream: (input: TitleInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(emitStart('title')));

            const result = yield* Effect.tryPromise({
              try: async () => {
                const events: Array<{ node: string; state: Record<string, unknown> }> = [];
                const streamGen = streamConfirmationLoop(graph, {
                  docId: input.docId,
                  docTitle: input.existingTitle ?? 'Untitled',
                  content: input.content,
                  context: { similarTitles: input.similarTitles },
                  maxRetries: autoProcessing.confirmationMaxRetries,
                }, `title-stream-${input.docId}-${Date.now()}`);

                for await (const event of streamGen) {
                  events.push(event);
                }
                return events;
              },
              catch: (e) => e,
            });

            if (result instanceof Error) {
              yield* Effect.sync(() => emit.fail(new AgentError({ message: `Stream failed: ${result}`, agent: 'title' })));
              return;
            }

            let lastAnalysis: TitleAnalysis | null = null;

            for (const { node, state } of result) {
              if (node === 'analyze' && state.analysis) {
                lastAnalysis = state.analysis as TitleAnalysis;
                yield* Effect.sync(() => emit.single(emitAnalyzing('title', `Attempt ${(state.attempt as number) ?? 1}`)));
                yield* Effect.sync(() => emit.single(emitThinking('title', lastAnalysis!.reasoning)));
              }

              if (node === 'confirm' && lastAnalysis) {
                yield* Effect.sync(() => emit.single(emitConfirming('title', lastAnalysis!.suggested_title)));
              }

              if (node === 'apply' && lastAnalysis) {
                yield* paperless.updateDocument(input.docId, { title: lastAnalysis.suggested_title });
                yield* paperless.transitionDocumentTag(input.docId, tagConfig.ocrDone, tagConfig.titleDone);
                yield* Effect.sync(() => emit.single(emitResult('title', { success: true, value: lastAnalysis!.suggested_title })));
              }

              if (node === 'queue_review' && lastAnalysis) {
                yield* tinybase.addPendingReview({
                  docId: input.docId,
                  docTitle: input.existingTitle ?? 'Untitled',
                  type: 'title',
                  suggestion: lastAnalysis.suggested_title,
                  reasoning: lastAnalysis.reasoning,
                  alternatives: lastAnalysis.based_on_similar,
                  attempts: autoProcessing.confirmationMaxRetries,
                  lastFeedback: 'Max retries exceeded',
                  nextTag: tagConfig.titleDone,
                  metadata: null,
                });
                yield* paperless.addTagToDocument(input.docId, tagConfig.manualReview);
                yield* Effect.sync(() => emit.single(emitResult('title', { success: false, needsReview: true })));
              }
            }

            yield* Effect.sync(() => emit.single(emitComplete('title')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.mapError((e) => new AgentError({ message: `Title stream failed: ${e}`, agent: 'title', cause: e }))
          )
        ),
    };
  })
);
