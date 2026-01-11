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
  type ConfirmationLoopLogEvent,
} from './graph/index.js';
import type { ProcessingLogEventType } from '../services/TinyBaseService.js';

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
// Prompt Loading Helpers
// ===========================================================================

/**
 * Extracts the system prompt from a prompt file.
 * The system prompt is everything before the '---' separator.
 * Also adds a note about tool usage and JSON response format.
 */
const extractSystemPrompt = (promptContent: string, addToolNote = true): string => {
  // Find the --- separator
  const separatorIndex = promptContent.indexOf('\n---\n');
  const systemPart = separatorIndex !== -1
    ? promptContent.slice(0, separatorIndex).trim()
    : promptContent.trim();

  // Add tool usage note if needed
  const toolNote = addToolNote
    ? '\n\nYou have access to tools to search for similar processed documents. Use them to inform your decisions.\n\nYou MUST respond with structured JSON matching the required schema.'
    : '\n\nYou MUST respond with structured JSON: { "confirmed": boolean, "feedback": string, "suggested_changes": string }';

  return systemPart + toolNote;
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const TitleAgentGraphServiceLive = Layer.effect(
  TitleAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const promptService = yield* PromptService;
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const qdrant = yield* QdrantService;

    const { autoProcessing, tags: tagConfig } = config.config;
    const settings = yield* tinybase.getAllSettings();

    const ollamaUrl = settings['ollama.url'] ?? 'http://localhost:11434';
    const largeModel = ollama.getModel('large');
    const smallModel = ollama.getModel('small');

    // Load prompts from prompt files based on configured language
    const titlePrompt = yield* promptService.getPrompt('title');
    const titleConfirmationPrompt = yield* promptService.getPrompt('title_confirmation');

    const analysisSystemPrompt = extractSystemPrompt(titlePrompt.content, true);
    const confirmationSystemPrompt = extractSystemPrompt(titleConfirmationPrompt.content, false);

    const tools = createAgentTools({
      paperless,
      qdrant,
      processedTagName: tagConfig.processed,
    });

    const graphConfig: ConfirmationLoopConfig<TitleAnalysis> = {
      agentName: 'title',
      analysisSchema: TitleAnalysisSchema,
      analysisSystemPrompt,
      confirmationSystemPrompt,
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

    return {
      name: 'title' as const,

      process: (input: TitleInput) =>
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
              existingTitle: input.existingTitle,
              similarTitles: input.similarTitles,
            },
            timestamp: new Date().toISOString(),
          });

          // Create graph with logger
          const graphConfigWithLogger: ConfirmationLoopConfig<TitleAnalysis> = {
            ...graphConfig,
            logger,
          };
          const graph = createConfirmationLoopGraph(graphConfigWithLogger);

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

          // Store all log entries (use captured timestamps and IDs)
          for (const entry of logEntries) {
            yield* tinybase.addProcessingLog({
              id: entry.id,
              docId: input.docId,
              timestamp: entry.timestamp,
              step: 'title',
              eventType: entry.eventType as ProcessingLogEventType,
              data: entry.data,
              parentId: entry.parentId,
            });
          }

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

            // Log result
            yield* tinybase.addProcessingLog({
              docId: input.docId,
              timestamp: new Date().toISOString(),
              step: 'title',
              eventType: 'result',
              data: {
                success: false,
                needsReview: true,
                reasoning: result.error ?? 'Confirmation failed',
                attempts: result.attempts,
              },
            });

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

          // Log result
          yield* tinybase.addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: 'title',
            eventType: 'result',
            data: {
              success: true,
              value: analysis.suggested_title,
              reasoning: analysis.reasoning,
              confidence: analysis.confidence,
              attempts: result.attempts,
            },
          });

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
                existingTitle: input.existingTitle,
                similarTitles: input.similarTitles,
              },
              timestamp: new Date().toISOString(),
            });

            // Create graph with logger
            const graphConfigWithLogger: ConfirmationLoopConfig<TitleAnalysis> = {
              ...graphConfig,
              logger,
            };
            const graph = createConfirmationLoopGraph(graphConfigWithLogger);

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

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'title',
                  eventType: 'result',
                  data: {
                    success: true,
                    value: lastAnalysis.suggested_title,
                    reasoning: lastAnalysis.reasoning,
                    confidence: lastAnalysis.confidence,
                  },
                });
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

                // Log result
                yield* tinybase.addProcessingLog({
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: 'title',
                  eventType: 'result',
                  data: {
                    success: false,
                    needsReview: true,
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
                step: 'title',
                eventType: entry.eventType as ProcessingLogEventType,
                data: entry.data,
                parentId: entry.parentId,
              });
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
