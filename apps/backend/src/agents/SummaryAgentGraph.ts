/**
 * Summary generation agent using Ollama large model.
 *
 * This agent:
 * 1. Gets document content
 * 2. Generates a summary using the large Ollama model
 * 3. Adds the summary as a note to the document
 * 4. Updates document tags
 */
import { Effect, Context, Layer, Stream, pipe } from 'effect';
import {
  ConfigService,
  OllamaService,
  PaperlessService,
  PromptService,
  TinyBaseService,
} from '../services/index.js';
import { AgentError } from '../errors/index.js';
import {
  type Agent,
  type StreamEvent,
  emitStart,
  emitAnalyzing,
  emitResult,
  emitError,
  emitComplete,
} from './base.js';

// ===========================================================================
// Types
// ===========================================================================

export interface SummaryInput {
  docId: number;
  content: string;
}

export interface SummaryResult {
  success: boolean;
  docId: number;
  summary: string;
  summaryLength: number;
  error?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface SummaryAgentService extends Agent<SummaryInput, SummaryResult> {
  readonly name: 'summary';
  readonly process: (input: SummaryInput) => Effect.Effect<SummaryResult, AgentError>;
  readonly processStream: (input: SummaryInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const SummaryAgentService = Context.GenericTag<SummaryAgentService>('SummaryAgentService');

// ===========================================================================
// Live Implementation
// ===========================================================================

export const SummaryAgentServiceLive = Layer.effect(
  SummaryAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const ollama = yield* OllamaService;
    const paperless = yield* PaperlessService;
    const promptService = yield* PromptService;
    const tinybase = yield* TinyBaseService;

    const { tags: tagConfig } = config.config;

    // Load summary prompt
    const summaryPromptResult = yield* pipe(
      promptService.getPrompt('summary'),
      Effect.catchAll(() =>
        Effect.succeed({
          name: 'summary',
          filename: 'summary.md',
          content: `You are a document summarization specialist. Analyze the following document and provide a concise summary (2-5 sentences) that captures:
- The document type and purpose
- Key parties involved
- Main subject matter
- Important dates or amounts (if applicable)

Write a cohesive paragraph (not bullet points).

## Document Content

{document_content}

Provide ONLY the summary text. No JSON structure, no headers, just the summary paragraph.`,
          variables: ['document_content'],
          description: 'Document summarization prompt',
        })
      )
    );

    // Generate summary using large model
    const generateSummary = (content: string): Effect.Effect<string, AgentError> =>
      Effect.gen(function* () {
        const largeModel = ollama.getModel('large');

        // Build prompt with document content
        const prompt = summaryPromptResult.content.replace(
          '{document_content}',
          content.slice(0, 8000) // Limit content to avoid context overflow
        );

        const response = yield* pipe(
          ollama.chat(
            largeModel,
            [{ role: 'user', content: prompt }]
          ),
          Effect.mapError(
            (e) =>
              new AgentError({
                message: `Summary generation failed: ${e}`,
                agent: 'summary',
                cause: e,
              })
          )
        );

        return response.message.content.trim();
      });

    return {
      name: 'summary' as const,

      process: (input: SummaryInput) =>
        Effect.gen(function* () {
          const { docId, content } = input;

          // Generate summary
          const summary = yield* generateSummary(content);

          // Add summary as note to document
          yield* pipe(
            paperless.addNote(docId, summary),
            Effect.mapError(
              (e) =>
                new AgentError({
                  message: `Failed to add note: ${e}`,
                  agent: 'summary',
                  cause: e,
                })
            )
          );

          // Update tags: transition from ocr-done to summary-done
          yield* pipe(
            paperless.transitionDocumentTag(docId, tagConfig.ocrDone, tagConfig.summaryDone),
            Effect.mapError(
              (e) =>
                new AgentError({
                  message: `Failed to transition tag: ${e}`,
                  agent: 'summary',
                  cause: e,
                })
            )
          );

          // Log processing result
          yield* tinybase.addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: 'summary',
            eventType: 'result',
            data: {
              success: true,
              summaryLength: summary.length,
            },
          });

          return {
            success: true,
            docId,
            summary,
            summaryLength: summary.length,
          };
        }).pipe(
          Effect.mapError((e) =>
            e instanceof AgentError
              ? e
              : new AgentError({
                  message: `Summary processing failed: ${e}`,
                  agent: 'summary',
                  cause: e,
                })
          )
        ),

      processStream: (input: SummaryInput) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            const { docId, content } = input;

            yield* Effect.sync(() => emit.single(emitStart('summary')));

            yield* Effect.sync(() =>
              emit.single(emitAnalyzing('summary', 'Generating document summary'))
            );

            const summary = yield* generateSummary(content);

            yield* Effect.sync(() =>
              emit.single(emitAnalyzing('summary', 'Adding summary as note'))
            );

            yield* pipe(
              paperless.addNote(docId, summary),
              Effect.mapError(
                (e) =>
                  new AgentError({
                    message: `Failed to add note: ${e}`,
                    agent: 'summary',
                    cause: e,
                  })
              )
            );

            yield* pipe(
              paperless.transitionDocumentTag(docId, tagConfig.ocrDone, tagConfig.summaryDone),
              Effect.mapError(
                (e) =>
                  new AgentError({
                    message: `Failed to transition tag: ${e}`,
                    agent: 'summary',
                    cause: e,
                  })
              )
            );

            // Log processing result
            yield* tinybase.addProcessingLog({
              docId,
              timestamp: new Date().toISOString(),
              step: 'summary',
              eventType: 'result',
              data: {
                success: true,
                summaryLength: summary.length,
              },
            });

            yield* Effect.sync(() =>
              emit.single(
                emitResult('summary', {
                  success: true,
                  docId,
                  summary,
                  summaryLength: summary.length,
                })
              )
            );

            yield* Effect.sync(() => emit.single(emitComplete('summary')));
            yield* Effect.sync(() => emit.end());
          }).pipe(
            Effect.catchAll((error) =>
              Effect.gen(function* () {
                yield* Effect.sync(() => emit.single(emitError('summary', String(error))));
                yield* Effect.sync(() => emit.end());
              })
            ),
            Effect.mapError((e) =>
              new AgentError({
                message: `Summary stream failed: ${e}`,
                agent: 'summary',
                cause: e,
              })
            )
          )
        ),
    };
  })
);
