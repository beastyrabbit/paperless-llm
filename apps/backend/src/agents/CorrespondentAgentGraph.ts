/**
 * Compatibility correspondent agent. New processing uses PiDocumentAgent.
 */
import { Context, Effect, Layer, Stream } from "effect";
import { AgentError } from "../errors/index.js";
import { ConfigService, PaperlessService, TinyBaseService } from "../services/index.js";
import {
  type Agent,
  type AgentProcessResult,
  emitComplete,
  emitError,
  emitResult,
  emitStart,
  type StreamEvent,
} from "./base.js";

export interface CorrespondentInput {
  docId: number;
  content: string;
  docTitle: string;
  existingCorrespondents: string[];
}

export interface CorrespondentAgentGraphService
  extends Agent<CorrespondentInput, AgentProcessResult> {
  readonly name: "correspondent";
  readonly process: (input: CorrespondentInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: CorrespondentInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CorrespondentAgentGraphService = Context.GenericTag<CorrespondentAgentGraphService>(
  "CorrespondentAgentGraphService",
);

const pickExisting = (names: string[]): string | null =>
  names.find((name) => name.trim().length > 0) ?? null;

export const CorrespondentAgentGraphServiceLive = Layer.effect(
  CorrespondentAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags;

    const process = (input: CorrespondentInput) =>
      Effect.gen(function* () {
        const value = pickExisting(input.existingCorrespondents);
        if (value) {
          const id = yield* paperless.getOrCreateCorrespondent(value);
          yield* paperless.updateDocument(input.docId, { correspondent: id });
        }
        yield* paperless
          .transitionDocumentTag(input.docId, tagConfig.titleDone, tagConfig.correspondentDone)
          .pipe(Effect.catchAll(() => Effect.void));
        yield* tinybase
          .addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: "correspondent",
            eventType: "result",
            data: { success: true, value, compatibility: true },
          })
          .pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          value,
          reasoning: "Compatibility correspondent agent only maps to an existing correspondent.",
          confidence: value ? 0.4 : 0,
          alternatives: input.existingCorrespondents.slice(0, 5),
          attempts: 1,
          needsReview: false,
        };
      }).pipe(
        Effect.mapError(
          (error) =>
            new AgentError({
              message: `Correspondent compatibility agent failed: ${String(error)}`,
              agent: "correspondent",
              cause: error,
            }),
        ),
      );

    return {
      name: "correspondent" as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                emit.single(emitStart("correspondent"));
                emit.single(emitResult("correspondent", result));
                emit.single(emitComplete("correspondent"));
                emit.end();
              }),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(emitError("correspondent", String(error)));
                emit.end();
              }),
            ),
          ),
        ),
    };
  }),
);
