/**
 * Compatibility summary agent.
 *
 * The Pi document agent now owns metadata and summary orchestration. This service
 * remains for direct legacy imports and tests.
 */
import { Context, Effect, Layer, Stream } from "effect";
import { AgentError } from "../errors/index.js";
import { ConfigService, PaperlessService, TinyBaseService } from "../services/index.js";
import {
  type Agent,
  emitComplete,
  emitError,
  emitResult,
  emitStart,
  type StreamEvent,
} from "./base.js";

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

export interface SummaryAgentService extends Agent<SummaryInput, SummaryResult> {
  readonly name: "summary";
  readonly process: (input: SummaryInput) => Effect.Effect<SummaryResult, AgentError>;
  readonly processStream: (input: SummaryInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const SummaryAgentService = Context.GenericTag<SummaryAgentService>("SummaryAgentService");

const createSummary = (content: string): string => {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) return "No document text was available for summary generation.";
  return normalized.length <= 700 ? normalized : `${normalized.slice(0, 700).trim()}...`;
};

export const SummaryAgentServiceLive = Layer.effect(
  SummaryAgentService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags;

    const process = (input: SummaryInput) =>
      Effect.gen(function* () {
        const summary = createSummary(input.content);
        yield* paperless.addNote(input.docId, summary).pipe(Effect.catchAll(() => Effect.void));
        yield* paperless
          .transitionDocumentTag(input.docId, tagConfig.ocrDone, tagConfig.summaryDone)
          .pipe(Effect.catchAll(() => Effect.void));
        yield* tinybase
          .addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: "summary",
            eventType: "result",
            data: { success: true, summaryLength: summary.length, compatibility: true },
          })
          .pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          docId: input.docId,
          summary,
          summaryLength: summary.length,
        };
      }).pipe(
        Effect.mapError(
          (error) =>
            new AgentError({
              message: `Summary compatibility agent failed: ${String(error)}`,
              agent: "summary",
              cause: error,
            }),
        ),
      );

    return {
      name: "summary" as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                emit.single(emitStart("summary"));
                emit.single(emitResult("summary", result));
                emit.single(emitComplete("summary"));
                emit.end();
              }),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(emitError("summary", String(error)));
                emit.end();
              }),
            ),
          ),
        ),
    };
  }),
);
