/**
 * Compatibility document links agent. New processing uses PiDocumentAgent.
 */
import { Context, Effect, Layer, Stream } from "effect";
import { AgentError } from "../errors/index.js";
import type { CustomField } from "../models/index.js";
import { TinyBaseService } from "../services/index.js";
import {
  type Agent,
  type AgentProcessResult,
  emitComplete,
  emitError,
  emitResult,
  emitStart,
  type StreamEvent,
} from "./base.js";

export interface DocumentLinksGraphInput {
  docId: number;
  content: string;
  docTitle: string;
  correspondent?: string;
  documentType?: string;
  documentLinkFields: CustomField[];
}

export interface DocumentLinkSuggestionOutput {
  targetDocId: number;
  title?: string;
  reason?: string;
  confidence?: number;
}

export interface DocumentLinkResult {
  fieldId: number;
  fieldName: string;
  targetDocIds: number[];
  suggestedLinks: DocumentLinkSuggestionOutput[];
}

export interface DocumentLinksGraphResult extends AgentProcessResult {
  links: DocumentLinkResult[];
  appliedLinks: number[];
  skipped?: boolean;
  skipReason?: string;
}

export interface DocumentLinksAgentGraphService
  extends Agent<DocumentLinksGraphInput, DocumentLinksGraphResult> {
  readonly name: "document_links";
  readonly process: (
    input: DocumentLinksGraphInput,
  ) => Effect.Effect<DocumentLinksGraphResult, AgentError>;
  readonly processStream: (
    input: DocumentLinksGraphInput,
  ) => Stream.Stream<StreamEvent, AgentError>;
}

export const DocumentLinksAgentGraphService = Context.GenericTag<DocumentLinksAgentGraphService>(
  "DocumentLinksAgentGraphService",
);

export const DocumentLinksAgentGraphServiceLive = Layer.effect(
  DocumentLinksAgentGraphService,
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    const process = (input: DocumentLinksGraphInput) =>
      Effect.gen(function* () {
        yield* tinybase
          .addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: "document_links",
            eventType: "result",
            data: { success: true, skipped: true, compatibility: true },
          })
          .pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          value: null,
          reasoning:
            "Compatibility document links agent does not infer links outside PiDocumentAgent.",
          confidence: 0,
          alternatives: [],
          attempts: 1,
          needsReview: false,
          links: [],
          appliedLinks: [],
          skipped: true,
          skipReason: "Use PiDocumentAgent for document link extraction.",
        };
      }).pipe(
        Effect.mapError(
          (error) =>
            new AgentError({
              message: `Document links compatibility agent failed: ${String(error)}`,
              agent: "document_links",
              cause: error,
            }),
        ),
      );

    return {
      name: "document_links" as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                emit.single(emitStart("document_links"));
                emit.single(emitResult("document_links", result));
                emit.single(emitComplete("document_links"));
                emit.end();
              }),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(emitError("document_links", String(error)));
                emit.end();
              }),
            ),
          ),
        ),
    };
  }),
);
