/**
 * Compatibility custom fields agent. New processing uses PiDocumentAgent.
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

export interface CustomFieldsGraphInput {
  docId: number;
  content: string;
  docTitle: string;
  documentType?: string;
  customFields: CustomField[];
}

export interface FieldValueResult {
  fieldId: number;
  fieldName: string;
  value: string | number | boolean | null;
  reasoning: string;
}

export interface CustomFieldsGraphResult extends AgentProcessResult {
  fields: FieldValueResult[];
  updatedFields: string[];
  skipped?: boolean;
  skipReason?: string;
}

export interface CustomFieldsAgentGraphService
  extends Agent<CustomFieldsGraphInput, CustomFieldsGraphResult> {
  readonly name: "custom_fields";
  readonly process: (
    input: CustomFieldsGraphInput,
  ) => Effect.Effect<CustomFieldsGraphResult, AgentError>;
  readonly processStream: (input: CustomFieldsGraphInput) => Stream.Stream<StreamEvent, AgentError>;
}

export const CustomFieldsAgentGraphService = Context.GenericTag<CustomFieldsAgentGraphService>(
  "CustomFieldsAgentGraphService",
);

export const CustomFieldsAgentGraphServiceLive = Layer.effect(
  CustomFieldsAgentGraphService,
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    const process = (input: CustomFieldsGraphInput) =>
      Effect.gen(function* () {
        yield* tinybase
          .addProcessingLog({
            docId: input.docId,
            timestamp: new Date().toISOString(),
            step: "custom_fields",
            eventType: "result",
            data: { success: true, skipped: true, compatibility: true },
          })
          .pipe(Effect.catchAll(() => Effect.void));
        return {
          success: true,
          value: null,
          reasoning:
            "Compatibility custom fields agent does not infer fields outside PiDocumentAgent.",
          confidence: 0,
          alternatives: [],
          attempts: 1,
          needsReview: false,
          fields: [],
          updatedFields: [],
          skipped: true,
          skipReason: "Use PiDocumentAgent for custom field extraction.",
        };
      }).pipe(
        Effect.mapError(
          (error) =>
            new AgentError({
              message: `Custom fields compatibility agent failed: ${String(error)}`,
              agent: "custom_fields",
              cause: error,
            }),
        ),
      );

    return {
      name: "custom_fields" as const,
      process,
      processStream: (input) =>
        Stream.asyncEffect<StreamEvent, AgentError>((emit) =>
          process(input).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                emit.single(emitStart("custom_fields"));
                emit.single(emitResult("custom_fields", result));
                emit.single(emitComplete("custom_fields"));
                emit.end();
              }),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(emitError("custom_fields", String(error)));
                emit.end();
              }),
            ),
          ),
        ),
    };
  }),
);
