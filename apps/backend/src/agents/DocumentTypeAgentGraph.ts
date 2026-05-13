/**
 * Compatibility document type agent. New processing uses PiDocumentAgent.
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

export interface DocumentTypeInput {
  docId: number;
  content: string;
  docTitle: string;
  existingDocumentTypes: string[];
}

export interface DocumentTypeAgentGraphService
  extends Agent<DocumentTypeInput, AgentProcessResult> {
  readonly name: "document_type";
  readonly process: (input: DocumentTypeInput) => Effect.Effect<AgentProcessResult, AgentError>;
  readonly processStream: (input: DocumentTypeInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const DocumentTypeAgentGraphService = Context.GenericTag<DocumentTypeAgentGraphService>(
  "DocumentTypeAgentGraphService",
);

export const DocumentTypeAgentGraphServiceLive = Layer.effect(
  DocumentTypeAgentGraphService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const tagConfig = config.config.tags;

    const process = (input: DocumentTypeInput) =>
      Effect.gen(function* () {
        const value = input.existingDocumentTypes.find((name) => name.trim().length > 0) ?? null;
        if (value) {
          const id = yield* paperless.getOrCreateDocumentType(value);
          yield* paperless.updateDocument(input.docId, { document_type: id });
        }
        yield* paperless
          .transitionDocumentTag(
            input.docId,
            tagConfig.correspondentDone,
            tagConfig.documentTypeDone,
          )
          .pipe(Effect.catchAll(() => Effect.void));
        yield* tinybase
          .addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: "document_type",
            eventType: "result",
            data: { success: true, value, compatibility: true },
          })
          .pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          value,
          reasoning: "Compatibility document type agent only maps to an existing type.",
          confidence: value ? 0.4 : 0,
          alternatives: input.existingDocumentTypes.slice(0, 5),
          attempts: 1,
          needsReview: false,
        };
      }).pipe(
        Effect.mapError(
          (error) =>
            new AgentError({
              message: `Document type compatibility agent failed: ${String(error)}`,
              agent: "document_type",
              cause: error,
            }),
        ),
      );

    return {
      name: "document_type" as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                emit.single(emitStart("document_type"));
                emit.single(emitResult("document_type", result));
                emit.single(emitComplete("document_type"));
                emit.end();
              }),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(emitError("document_type", String(error)));
                emit.end();
              }),
            ),
          ),
        ),
    };
  }),
);
