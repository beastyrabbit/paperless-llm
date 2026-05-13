/**
 * Pi-backed document processing pipeline.
 */
import { Context, Effect, Layer, Stream } from "effect";
import { AgentError } from "../errors/index.js";
import type { Document } from "../models/index.js";
import {
  ConfigService,
  PaperlessService,
  QdrantService,
  TinyBaseService,
} from "../services/index.js";
import { OCRAgentService } from "./OCRAgent.js";
import {
  type DocumentAgentRuntimeEvent,
  type MetadataPolicy,
  PiDocumentAgentService,
} from "./PiDocumentAgent.js";

export type ProcessingState = "todo" | "ocr" | "metadata" | "review" | "index" | "done" | "failed";

export interface PipelineInput {
  docId: number;
  mockOcr?: boolean;
  auto?: boolean;
  resume?: boolean;
  onAgentEvent?: (event: PipelineStreamEvent) => void;
}

export interface PipelineStepResult {
  step: string;
  success: boolean;
  data?: unknown;
  error?: string;
}

export interface PipelineResult {
  docId: number;
  success: boolean;
  needsReview: boolean;
  schemaReviewNeeded?: boolean;
  steps: Record<string, PipelineStepResult>;
  error?: string;
}

export interface PipelineStreamEvent {
  type:
    | "pipeline_start"
    | "step_start"
    | "step_complete"
    | "step_error"
    | "needs_review"
    | "schema_review_needed"
    | "pipeline_paused"
    | "pipeline_complete"
    | "warning"
    | "error"
    | "analyzing"
    | "thinking"
    | "confirming";
  docId: number;
  step?: string;
  data?: unknown;
  message?: string;
  reason?: string;
  timestamp: string;
}

export interface ProcessingPipelineService {
  readonly processDocument: (input: PipelineInput) => Effect.Effect<PipelineResult, AgentError>;
  readonly processDocumentStream: (
    input: PipelineInput,
  ) => Stream.Stream<PipelineStreamEvent, AgentError>;
  readonly processStep: (
    docId: number,
    step: string,
  ) => Effect.Effect<PipelineStepResult, AgentError>;
  readonly processStepStream: (
    docId: number,
    step: string,
  ) => Stream.Stream<PipelineStreamEvent, AgentError>;
  readonly getCurrentState: (doc: Document) => ProcessingState;
}

export const ProcessingPipelineService = Context.GenericTag<ProcessingPipelineService>(
  "ProcessingPipelineService",
);

const event = (e: Omit<PipelineStreamEvent, "timestamp">): PipelineStreamEvent => ({
  ...e,
  timestamp: new Date().toISOString(),
});

const toPipelineAgentEvent = (
  docId: number,
  step: string,
  agentEvent: DocumentAgentRuntimeEvent,
): PipelineStreamEvent => {
  const toolName =
    typeof agentEvent.data["toolName"] === "string" ? agentEvent.data["toolName"] : undefined;
  const type =
    agentEvent.eventType === "response"
      ? "thinking"
      : agentEvent.eventType === "tool_call"
        ? "analyzing"
        : agentEvent.eventType === "tool_result"
          ? "confirming"
          : "error";
  return event({
    type,
    docId,
    step,
    data: agentEvent.data,
    message: toolName ? `${agentEvent.eventType}: ${toolName}` : agentEvent.eventType,
  });
};

export const ProcessingPipelineServiceLive = Layer.effect(
  ProcessingPipelineService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const qdrant = yield* QdrantService;
    const ocrAgent = yield* OCRAgentService;
    const documentAgent = yield* PiDocumentAgentService;
    const tagConfig = config.config.tags;
    const defaultPipelineConfig = config.config.pipeline;
    const activeDocumentIds = new Set<number>();

    const acquireDocumentLock = (docId: number) =>
      Effect.gen(function* () {
        if (activeDocumentIds.has(docId)) {
          return yield* Effect.fail(
            new AgentError({
              message: `Document ${docId} is already being processed`,
              agent: "pipeline",
            }),
          );
        }
        activeDocumentIds.add(docId);
      });

    const withDocumentLock = <A, E>(
      docId: number,
      effect: Effect.Effect<A, E>,
    ): Effect.Effect<A, E | AgentError> =>
      acquireDocumentLock(docId).pipe(
        Effect.flatMap(() =>
          effect.pipe(
            Effect.ensuring(
              Effect.sync(() => {
                activeDocumentIds.delete(docId);
              }),
            ),
          ),
        ),
      );

    const getPipelineConfig = () =>
      Effect.gen(function* () {
        const dbSettings: Record<string, string> = yield* tinybase
          .getAllSettings()
          .pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, string>)));
        const getBool = (key: string, fallback: boolean): boolean => {
          const value = dbSettings[key];
          if (value === undefined) return fallback;
          return value === "true" || value === "1";
        };
        const metadataPolicy: MetadataPolicy = {
          summary: getBool("pipeline.summary", defaultPipelineConfig.enableSummary),
          title: getBool("pipeline.title", defaultPipelineConfig.enableTitle),
          correspondent: getBool(
            "pipeline.correspondent",
            defaultPipelineConfig.enableCorrespondent,
          ),
          documentType: getBool("pipeline.document_type", defaultPipelineConfig.enableDocumentType),
          tags: getBool("pipeline.tags", defaultPipelineConfig.enableTags),
          customFields: getBool("pipeline.custom_fields", defaultPipelineConfig.enableCustomFields),
          documentLinks: getBool(
            "pipeline.document_links",
            defaultPipelineConfig.enableDocumentLinks,
          ),
        };
        return {
          enableOcr: getBool("pipeline.ocr", defaultPipelineConfig.enableOcr),
          enableMetadata: Object.values(metadataPolicy).some(Boolean),
          metadataPolicy,
        };
      });

    const tagMapRef = { current: new Map<number, string>() };

    const refreshTagMap = Effect.gen(function* () {
      const tags = yield* paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([])));
      tagMapRef.current = new Map(tags.map((tag) => [tag.id, tag.name]));
    });

    yield* refreshTagMap;

    const getTagNames = (doc: Document): string[] => {
      if (doc.tag_names && doc.tag_names.length > 0) return [...doc.tag_names];
      return (doc.tags ?? [])
        .map((id) => tagMapRef.current.get(id))
        .filter((name): name is string => name !== undefined);
    };

    const getCurrentState = (doc: Document): ProcessingState => {
      const names = getTagNames(doc);
      if (names.includes(tagConfig.failed)) return "failed";
      if (names.includes(tagConfig.done) || names.includes(tagConfig.processed)) return "done";
      if (
        names.includes(tagConfig.review) ||
        names.includes(tagConfig.manualReview) ||
        names.includes(tagConfig.schemaReview)
      )
        return "review";
      if (names.includes(tagConfig.index) || names.includes(tagConfig.tagsDone)) return "index";
      if (
        names.includes(tagConfig.metadata) ||
        names.includes(tagConfig.summaryDone) ||
        names.includes(tagConfig.titleDone) ||
        names.includes(tagConfig.correspondentDone) ||
        names.includes(tagConfig.documentTypeDone)
      )
        return "metadata";
      if (names.includes(tagConfig.ocr) || names.includes(tagConfig.ocrDone)) return "ocr";
      return "todo";
    };

    const workflowTagNames = new Set(
      Object.values(tagConfig).filter((name): name is string => typeof name === "string" && !!name),
    );

    const transition = (docId: number, toTag: string) =>
      Effect.gen(function* () {
        const [doc, tags, toTagId] = yield* Effect.all(
          [paperless.getDocument(docId), paperless.getTags(), paperless.getOrCreateTag(toTag)],
          { concurrency: "unbounded" },
        );
        const workflowTagIds = new Set(
          tags.filter((tag) => workflowTagNames.has(tag.name)).map((tag) => tag.id),
        );
        let nextTags = doc.tags.filter((id) => !workflowTagIds.has(id) || id === toTagId);
        if (!nextTags.includes(toTagId)) {
          nextTags = [...nextTags, toTagId];
        }
        if (nextTags.length !== doc.tags.length || nextTags.some((id) => !doc.tags.includes(id))) {
          yield* paperless.updateDocument(docId, { tags: nextTags });
        }
        yield* refreshTagMap;
      });

    const indexDocument = (docId: number) =>
      Effect.gen(function* () {
        const settings: Record<string, string> = yield* tinybase
          .getAllSettings()
          .pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, string>)));
        if (settings["vector_search.enabled"] !== "true") return { indexed: false };

        const [doc, tags, correspondents, documentTypes] = yield* Effect.all(
          [
            paperless.getDocument(docId),
            paperless.getTags(),
            paperless.getCorrespondents(),
            paperless.getDocumentTypes(),
          ],
          { concurrency: "unbounded" },
        );

        const tagNames = (doc.tags ?? [])
          .map((id) => tags.find((tag) => tag.id === id)?.name)
          .filter((name): name is string => !!name && !name.startsWith("llm-"));
        const correspondent = doc.correspondent
          ? correspondents.find((entry) => entry.id === doc.correspondent)?.name
          : undefined;
        const documentType = doc.document_type
          ? documentTypes.find((entry) => entry.id === doc.document_type)?.name
          : undefined;

        const indexResult = yield* Effect.either(
          qdrant.upsertDocument({
            docId: doc.id,
            title: doc.title || `Document ${doc.id}`,
            content: (doc.content ?? "").slice(0, 10_000),
            tags: tagNames,
            correspondent,
            documentType,
          }),
        );

        if (indexResult._tag === "Left") {
          const error = String(indexResult.left);
          yield* tinybase
            .addProcessingLog({
              docId,
              timestamp: new Date().toISOString(),
              step: "qdrant_index",
              eventType: "error",
              data: { indexed: false, error },
            })
            .pipe(Effect.catchAll(() => Effect.void));
          return { indexed: false, error };
        }

        yield* tinybase
          .addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: "qdrant_index",
            eventType: "result",
            data: { indexed: true },
          })
          .pipe(Effect.catchAll(() => Effect.void));

        return { indexed: true };
      });

    const processMetadata = (
      docId: number,
      metadataPolicy: MetadataPolicy,
      auto?: boolean,
      resume?: boolean,
      onAgentEvent?: (event: PipelineStreamEvent) => void,
    ) =>
      Effect.gen(function* () {
        yield* transition(docId, tagConfig.metadata);
        const result = yield* documentAgent.processDocument({
          docId,
          auto,
          resume,
          metadataPolicy,
          onEvent: onAgentEvent
            ? (agentEvent) => onAgentEvent(toPipelineAgentEvent(docId, "metadata", agentEvent))
            : undefined,
        });
        if (result.needsReview) {
          yield* transition(docId, tagConfig.review);
        } else if (!result.success) {
          yield* transition(docId, tagConfig.failed);
        } else {
          yield* transition(docId, tagConfig.index);
        }
        return result;
      });

    const processIndex = (docId: number) =>
      Effect.gen(function* () {
        yield* transition(docId, tagConfig.index);
        const result = yield* indexDocument(docId);
        if (result.error) {
          yield* transition(docId, tagConfig.failed);
          return result;
        }
        yield* transition(docId, tagConfig.done);
        yield* tinybase
          .addProcessingLog({
            docId,
            timestamp: new Date().toISOString(),
            step: "pipeline",
            eventType: "state_transition",
            data: { toState: "done", toTag: tagConfig.done },
          })
          .pipe(Effect.catchAll(() => Effect.void));
        return result;
      });

    const normalizeStep = (step: string): "ocr" | "metadata" | "index" => {
      if (step === "ocr") return "ocr";
      if (step === "index" || step === "finalizing" || step === "complete") return "index";
      return "metadata";
    };

    const service: ProcessingPipelineService = {
      getCurrentState,

      processDocument: (input) =>
        withDocumentLock(
          input.docId,
          Effect.gen(function* () {
            const steps: Record<string, PipelineStepResult> = {};
            const pipelineConfig = yield* getPipelineConfig();
            let doc = yield* paperless.getDocument(input.docId);
            let state = getCurrentState(doc);

            if (state === "done") {
              return { docId: input.docId, success: true, needsReview: false, steps };
            }

            if (state === "failed") {
              yield* transition(input.docId, tagConfig.todo);
              state = "todo";
            }

            if (state === "review" && !input.resume) {
              return { docId: input.docId, success: false, needsReview: true, steps };
            }
            if (state === "review" && input.resume) {
              yield* transition(input.docId, tagConfig.metadata);
              state = "metadata";
            }

            if (state === "todo" && pipelineConfig.enableOcr) {
              yield* transition(input.docId, tagConfig.ocr);
              state = "ocr";
              const result = yield* ocrAgent
                .process({ docId: input.docId, mockMode: input.mockOcr })
                .pipe(
                  Effect.catchAll((error) =>
                    Effect.succeed({
                      success: false,
                      docId: input.docId,
                      textLength: 0,
                      pages: 0,
                      error: String(error),
                    }),
                  ),
                );
              steps["ocr"] = { step: "ocr", success: result.success, data: result };
              if (!result.success) {
                yield* transition(input.docId, tagConfig.failed);
                return {
                  docId: input.docId,
                  success: false,
                  needsReview: false,
                  steps,
                  error: result.error ?? "OCR failed",
                };
              }
              yield* transition(input.docId, tagConfig.metadata);
              doc = yield* paperless.getDocument(input.docId);
              state = getCurrentState(doc);
            } else if (state === "todo") {
              yield* transition(input.docId, tagConfig.metadata);
              state = "metadata";
            } else if (state === "ocr") {
              return {
                docId: input.docId,
                success: false,
                needsReview: false,
                steps,
                error: "OCR is already in progress for this document",
              };
            }

            if (state === "metadata" && pipelineConfig.enableMetadata) {
              const result = yield* processMetadata(
                input.docId,
                pipelineConfig.metadataPolicy,
                input.auto,
                input.resume,
                input.onAgentEvent,
              );
              steps["metadata"] = { step: "metadata", success: result.success, data: result };
              if (result.needsReview) {
                return { docId: input.docId, success: false, needsReview: true, steps };
              }
              if (!result.success) {
                return {
                  docId: input.docId,
                  success: false,
                  needsReview: false,
                  steps,
                  error: result.error ?? "Metadata agent failed",
                };
              }
              state = "index";
            } else if (state === "metadata") {
              yield* transition(input.docId, tagConfig.index);
              state = "index";
            }

            if (state === "index") {
              const result = yield* processIndex(input.docId);
              steps["index"] = {
                step: "index",
                success: !result.error,
                data: result,
                error: result.error,
              };
              if (result.error) {
                return {
                  docId: input.docId,
                  success: false,
                  needsReview: false,
                  steps,
                  error: result.error,
                };
              }
            }

            return { docId: input.docId, success: true, needsReview: false, steps };
          }).pipe(
            Effect.mapError((error) =>
              error instanceof AgentError
                ? error
                : new AgentError({
                    message: `Pipeline processing failed: ${String(error)}`,
                    agent: "pipeline",
                    cause: error,
                  }),
            ),
          ),
        ),

      processStep: (docId, step) =>
        withDocumentLock(
          docId,
          Effect.gen(function* () {
            const normalized = normalizeStep(step);
            const pipelineConfig = yield* getPipelineConfig();
            if (normalized === "ocr") {
              const doc = yield* paperless.getDocument(docId);
              if (getCurrentState(doc) === "ocr") {
                return {
                  step: "ocr",
                  success: false,
                  data: {
                    success: false,
                    docId,
                    textLength: 0,
                    pages: 0,
                    skipped: true,
                    skipReason: "ocr_already_running",
                    error: "OCR is already in progress for this document",
                  },
                  error: "OCR is already in progress for this document",
                };
              }
              yield* transition(docId, tagConfig.ocr);
              const result = yield* ocrAgent.process({ docId });
              if (result.success) {
                yield* transition(docId, tagConfig.metadata);
              }
              return { step: "ocr", success: result.success, data: result };
            }
            if (normalized === "metadata") {
              const result = yield* processMetadata(docId, pipelineConfig.metadataPolicy);
              return { step, success: result.success, data: result };
            }
            const result = yield* processIndex(docId);
            return { step: "index", success: !result.error, data: result, error: result.error };
          }).pipe(
            Effect.mapError((error) =>
              error instanceof AgentError
                ? error
                : new AgentError({
                    message: `Pipeline step '${step}' failed: ${String(error)}`,
                    agent: "pipeline",
                    cause: error,
                  }),
            ),
          ),
        ),

      processDocumentStream: (input) =>
        Stream.asyncEffect<PipelineStreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() =>
              emit.single(event({ type: "pipeline_start", docId: input.docId })),
            );
            return yield* service.processDocument({
              ...input,
              onAgentEvent: (agentEvent) => emit.single(agentEvent),
            });
          }).pipe(
            Effect.tap((result) =>
              Effect.sync(() => {
                for (const [step, stepResult] of Object.entries(result.steps)) {
                  emit.single(
                    event({
                      type: "step_complete",
                      docId: input.docId,
                      step,
                      data: stepResult.data,
                    }),
                  );
                }
                if (result.needsReview) {
                  emit.single(
                    event({
                      type: "pipeline_paused",
                      docId: input.docId,
                      reason: "human_decision",
                    }),
                  );
                } else if (result.success) {
                  emit.single(event({ type: "pipeline_complete", docId: input.docId }));
                } else {
                  emit.single(event({ type: "error", docId: input.docId, message: result.error }));
                }
                emit.end();
              }),
            ),
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(event({ type: "error", docId: input.docId, message: String(error) }));
                emit.end();
              }),
            ),
          ),
        ),

      processStepStream: (docId, step) =>
        Stream.asyncEffect<PipelineStreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(event({ type: "step_start", docId, step })));
            const normalized = normalizeStep(step);
            const result =
              normalized === "metadata"
                ? yield* withDocumentLock(
                    docId,
                    Effect.gen(function* () {
                      const pipelineConfig = yield* getPipelineConfig();
                      const metadataResult = yield* processMetadata(
                        docId,
                        pipelineConfig.metadataPolicy,
                        undefined,
                        undefined,
                        (agentEvent) => emit.single(agentEvent),
                      );
                      return {
                        step,
                        success: metadataResult.success,
                        data: metadataResult,
                        error: metadataResult.error,
                      };
                    }),
                  )
                : yield* service.processStep(docId, step);
            yield* Effect.sync(() => {
              const data = result.data as { needsReview?: boolean; paused?: boolean } | undefined;
              if (data?.needsReview || data?.paused) {
                emit.single(event({ type: "needs_review", docId, step, data }));
                emit.end();
                return;
              }
              emit.single(
                event({
                  type: result.success ? "step_complete" : "step_error",
                  docId,
                  step,
                  data: result.data,
                  message: result.error,
                }),
              );
              emit.end();
            });
          }).pipe(
            Effect.catchAll((error) =>
              Effect.sync(() => {
                emit.single(event({ type: "step_error", docId, step, message: String(error) }));
                emit.end();
              }),
            ),
          ),
        ),
    };

    return service;
  }),
);
