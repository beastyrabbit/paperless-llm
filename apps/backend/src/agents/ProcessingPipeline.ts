/**
 * Pi-backed document processing pipeline.
 */
import { Context, Duration, Effect, Fiber, Layer, Ref, Stream } from "effect";
import { AgentError } from "../errors/index.js";
import { event, toPipelineAgentEvent } from "./processingPipeline/events.js";
import { parseStep } from "./processingPipeline/parse.js";
import type {
  ActiveDocumentRunInfo,
  PipelineStepResult,
  PipelineStreamEvent,
  ProcessingPipelineService as ProcessingPipelineServiceContract,
} from "./processingPipeline/types.js";
import { annotateSpan, withInternalSpan } from "../observability/tracing.js";
import type { CustomFieldValue, Document } from "../models/index.js";
import type {
  CaseAutomationStatus,
  DocumentCase,
  CasePhase,
  UpdateCaseInput,
} from "../services/DocumentCaseService.js";
import {
  type CaseFailureDetail,
  ConfigService,
  DocumentCaseService,
  LockService,
  metrics,
  observeDuration,
  PaperlessService,
  QdrantService,
  TinyBaseService,
} from "../services/index.js";
import { logger } from "../utils/logger.js";
import {
  getProcessingStateFromDocumentTags,
  getWorkflowTagForState,
  getWorkflowTagNames,
  isConfiguredWorkflowTagName,
  type ProcessingState,
} from "../utils/tagState.js";
import { OCRAgentService } from "./OCRAgent.js";
import {
  type DocumentAgentResult,
  type MetadataPolicy,
  PiDocumentAgentService,
} from "./PiDocumentAgent.js";

export type {
  ActiveDocumentRunInfo,
  CancelRunResult,
  PipelineInput,
  PipelineResult,
  PipelineStepResult,
  PipelineStreamEvent,
  ProcessingState,
} from "./processingPipeline/types.js";
const pipelineLogger = logger.child({ component: "processing_pipeline" });

interface ActiveDocumentRun {
  info: ActiveDocumentRunInfo;
  fiber: Fiber.RuntimeFiber<unknown, unknown>;
  cancelRequested: Ref.Ref<boolean>;
  cancelReason: Ref.Ref<string | null>;
}

export interface ProcessingPipelineService extends ProcessingPipelineServiceContract {}

export const ProcessingPipelineService = Context.GenericTag<ProcessingPipelineService>(
  "ProcessingPipelineService",
);

export const ProcessingPipelineServiceLive = Layer.effect(
  ProcessingPipelineService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const locks = yield* LockService;
    const cases = yield* DocumentCaseService;
    const qdrant = yield* QdrantService;
    const ocrAgent = yield* OCRAgentService;
    const documentAgent = yield* PiDocumentAgentService;
    const tagConfig = config.config.tags;
    const defaultPipelineConfig = config.config.pipeline;
    const heartbeatInterval = Duration.minutes(5);
    const maxHeartbeatMisses = 3;
    const activeRuns = yield* Ref.make(new Map<number, ActiveDocumentRun>());

    const bestEffort = <A, E, R>(operation: string, effect: Effect.Effect<A, E, R>) =>
      effect.pipe(
        Effect.asVoid,
        Effect.catchAll((error) =>
          Effect.sync(() => {
            pipelineLogger.warn("best_effort_operation_failed", { operation, error });
          }),
        ),
      );

    const addProcessingLog = (
      operation: string,
      log: Parameters<typeof tinybase.addProcessingLog>[0],
    ) => bestEffort(operation, tinybase.addProcessingLog(log));

    const instrumentPhase = <A, E, R>(
      phase: "pipeline" | "ocr" | "metadata" | "index",
      mode: "document" | "step" | "stream" | "dry_run",
      effect: Effect.Effect<A, E, R>,
      outcome: (value: A) => "success" | "failure" | "needs_review" | "skipped",
    ): Effect.Effect<A, E, R> =>
      Effect.gen(function* () {
        const startedAt = Date.now();
        yield* Effect.sync(() => metrics.pipelinePhaseStarted.inc({ phase, mode }));
        return yield* effect.pipe(
          Effect.tap((value) =>
            Effect.gen(function* () {
              const resultOutcome = outcome(value);
              yield* annotateSpan({
                "pipeline.phase.outcome": resultOutcome,
                "pipeline.phase.duration_ms": observeDuration(startedAt) * 1000,
              });
              yield* Effect.sync(() => {
                metrics.pipelinePhaseCompleted.inc({ phase, outcome: resultOutcome, mode });
                metrics.pipelinePhaseDuration.observe(
                  { phase, outcome: resultOutcome, mode },
                  observeDuration(startedAt),
                );
              });
            }),
          ),
          Effect.tapError((error) =>
            Effect.gen(function* () {
              yield* annotateSpan({
                "pipeline.phase.outcome": "failure",
                "pipeline.phase.duration_ms": observeDuration(startedAt) * 1000,
                "error.type": error instanceof Error ? error.name : "unknown",
              });
              yield* Effect.sync(() => {
                metrics.pipelinePhaseCompleted.inc({ phase, outcome: "failure", mode });
                metrics.pipelinePhaseDuration.observe(
                  { phase, outcome: "failure", mode },
                  observeDuration(startedAt),
                );
              });
            }),
          ),
          withInternalSpan(`pipeline.phase.${phase}`, {
            "pipeline.phase": phase,
            "pipeline.mode": mode,
          }),
        );
      });

    const errorMessage = (error: unknown): string =>
      error instanceof Error && error.message ? error.message : String(error);

    const classifyFailure = (message: string): Pick<CaseFailureDetail, "kind" | "retryable"> => {
      if (/\b(timeout|timed out|HttpTimeoutError|AbortError)\b/i.test(message)) {
        return { kind: "timeout", retryable: true };
      }
      if (
        /(ECONNRESET|ECONNREFUSED|ENOTFOUND|fetch failed|network|temporar|429|5\d\d|Mistral|Ollama|Paperless|Qdrant)/i.test(
          message,
        )
      ) {
        return { kind: "transient", retryable: true };
      }
      if (
        /(invalid|malformed|schema|validation|not found|unknown processing step)/i.test(message)
      ) {
        return { kind: "permanent", retryable: false };
      }
      return { kind: "unknown", retryable: false };
    };

    const metricPhase = (step: string): "pipeline" | "ocr" | "metadata" | "index" => {
      if (step === "ocr" || step === "metadata" || step === "index") return step;
      return "pipeline";
    };

    const metricMode = (
      dryRun?: boolean,
      stream?: boolean,
    ): "document" | "step" | "stream" | "dry_run" =>
      dryRun ? "dry_run" : stream ? "stream" : "document";

    const buildFailureDetail = (
      step: string,
      error: unknown,
      runId: string | null = null,
    ): CaseFailureDetail => {
      const message = errorMessage(error);
      const classification = classifyFailure(message);
      return {
        message,
        step,
        runId,
        failedAt: new Date().toISOString(),
        ...classification,
      };
    };

    const recordStageFailure = (
      docId: number,
      step: string,
      error: unknown,
      options: { dryRun?: boolean; runId?: string | null } = {},
    ) =>
      Effect.gen(function* () {
        const failure = buildFailureDetail(step, error, options.runId ?? null);
        yield* Effect.sync(() =>
          metrics.pipelineErrors.inc({
            phase: metricPhase(step),
            kind: failure.kind,
            retryable: String(failure.retryable),
          }),
        );
        if (!options.dryRun) {
          yield* bestEffort(
            "mark case failed after stage failure",
            patchCase(docId, {
              phase: "failed",
              automationStatus: "failed",
              activeRunId: null,
              lastRunId: options.runId ?? null,
              lastFailure: failure,
              memory: { lastFailure: failure },
            }),
          );
        }
        yield* addProcessingLog("record stage failure", {
          docId,
          timestamp: failure.failedAt,
          step,
          eventType: "stage_failed",
          data: { ...failure },
        });
        return failure;
      });

    const getBoolSetting = (
      settings: Record<string, string>,
      keys: string[],
      fallback: boolean,
    ): boolean => {
      for (const key of keys) {
        const value = settings[key];
        if (value === undefined) continue;
        return value === "true" || value === "1";
      }
      return fallback;
    };
    const getAnyBoolSetting = (
      settings: Record<string, string>,
      keys: string[],
      fallback: boolean,
    ): boolean => {
      const values = keys
        .map((key) => settings[key])
        .filter((value): value is string => value !== undefined);
      if (values.length === 0) return fallback;
      return values.some((value) => value === "true" || value === "1");
    };

    type StoreRowSnapshot = Record<string, string | number | boolean>;

    interface CaseSnapshot {
      caseId: string;
      caseRow: StoreRowSnapshot | null;
      questionRows: Record<string, StoreRowSnapshot>;
      answerRows: Record<string, StoreRowSnapshot>;
    }

    const cloneStoreRow = (row: Record<string, unknown> | undefined): StoreRowSnapshot | null => {
      if (!row || Object.keys(row).length === 0) return null;
      return { ...(row as StoreRowSnapshot) };
    };

    const snapshotCaseRows = (docId: number): CaseSnapshot | null => {
      const store = tinybase.store;
      if (!store) return null;
      const caseId = `doc-${docId}`;
      const childRowsForCase = (table: "caseQuestions" | "caseAnswers") =>
        Object.fromEntries(
          Object.entries(store.getTable(table) ?? {})
            .filter(([, row]) => row?.["caseId"] === caseId)
            .map(([rowId, row]) => [rowId, { ...(row as StoreRowSnapshot) }]),
        );

      return {
        caseId,
        caseRow: cloneStoreRow(store.getRow("documentCases", caseId)),
        questionRows: childRowsForCase("caseQuestions"),
        answerRows: childRowsForCase("caseAnswers"),
      };
    };

    const restoreCaseRows = (snapshot: CaseSnapshot | null) =>
      Effect.sync(() => {
        if (!snapshot) return;
        const store = tinybase.store;
        if (!store) return;

        for (const [rowId, row] of Object.entries(store.getTable("caseQuestions") ?? {})) {
          if (row?.["caseId"] === snapshot.caseId) store.delRow("caseQuestions", rowId);
        }
        for (const [rowId, row] of Object.entries(store.getTable("caseAnswers") ?? {})) {
          if (row?.["caseId"] === snapshot.caseId) store.delRow("caseAnswers", rowId);
        }

        if (snapshot.caseRow) {
          store.setRow("documentCases", snapshot.caseId, snapshot.caseRow);
        } else if (store.hasRow("documentCases", snapshot.caseId)) {
          store.delRow("documentCases", snapshot.caseId);
        }

        for (const [rowId, row] of Object.entries(snapshot.questionRows)) {
          store.setRow("caseQuestions", rowId, row);
        }
        for (const [rowId, row] of Object.entries(snapshot.answerRows)) {
          store.setRow("caseAnswers", rowId, row);
        }
      });

    const withCaseSnapshot = <A, E>(
      docId: number,
      effect: Effect.Effect<A, E>,
    ): Effect.Effect<A, E> =>
      Effect.sync(() => snapshotCaseRows(docId)).pipe(
        Effect.flatMap((snapshot) => effect.pipe(Effect.ensuring(restoreCaseRows(snapshot)))),
      );

    const patchCase = (docId: number, updates: UpdateCaseInput) =>
      cases.getOrCreateCaseForDocument(docId).pipe(
        Effect.flatMap((caseRecord) => cases.updateCase(caseRecord.id, updates)),
        Effect.asVoid,
      );

    const acquireDocumentLock = (
      docId: number,
      options: { dryRun?: boolean; resume?: boolean; rerun?: boolean } = {},
    ) =>
      Effect.gen(function* () {
        const lock = yield* locks.acquire({
          scope: "document",
          resourceId: docId,
          owner: "pipeline",
          metadata: { source: "processing_pipeline" },
        });
        if (!lock.acquired) {
          yield* addProcessingLog("record lock contention", {
            docId,
            timestamp: new Date().toISOString(),
            step: "lock",
            eventType: "lock_acquired",
            data: {
              acquired: false,
              activeRunId: lock.lock.runId,
              owner: lock.lock.owner,
              expiresAt: lock.lock.expiresAt,
            },
          });
          return yield* Effect.fail(
            new AgentError({
              message: `Document ${docId} is already being processed by ${lock.lock.owner}`,
              agent: "pipeline",
            }),
          );
        }
        if (!options.dryRun) {
          yield* patchCase(docId, { activeRunId: lock.lock.runId, lastFailure: null });
        }
        yield* addProcessingLog("record lock acquisition", {
          docId,
          timestamp: new Date().toISOString(),
          step: "lock",
          eventType: lock.staleRecovered ? "lock_stale" : "lock_acquired",
          data: {
            acquired: true,
            runId: lock.lock.runId,
            dryRun: options.dryRun === true,
            staleRecovered: lock.staleRecovered,
            expiresAt: lock.lock.expiresAt,
          },
        });
        yield* addProcessingLog("record run start", {
          docId,
          timestamp: new Date().toISOString(),
          step: "pipeline",
          eventType: "run_started",
          data: {
            runId: lock.lock.runId,
            dryRun: options.dryRun === true,
            resume: options.resume === true,
            rerun: options.rerun === true,
          },
        });
        return lock.lock;
      });

    const heartbeatWatchdog = (docId: number, runId: string): Effect.Effect<never, AgentError> =>
      Effect.gen(function* () {
        let consecutiveMisses = 0;
        while (true) {
          const result = yield* Effect.either(locks.heartbeat("document", docId, runId));
          if (result._tag === "Left") {
            consecutiveMisses++;
            yield* addProcessingLog("record heartbeat failure", {
              docId,
              timestamp: new Date().toISOString(),
              step: "lock",
              eventType: "error",
              data: {
                runId,
                operation: "heartbeat",
                consecutiveMisses,
                maxHeartbeatMisses,
                error: String(result.left),
              },
            });
            if (consecutiveMisses >= maxHeartbeatMisses) {
              return yield* Effect.fail(
                new AgentError({
                  message: `Lost processing lock heartbeat for document ${docId}`,
                  agent: "pipeline",
                  cause: result.left,
                }),
              );
            }
          } else {
            consecutiveMisses = 0;
          }
          yield* Effect.sleep(heartbeatInterval);
        }
      });

    const withDocumentLock = <A, E>(
      docId: number,
      effect: Effect.Effect<A, E>,
      options: {
        dryRun?: boolean;
        resume?: boolean;
        rerun?: boolean;
        source?: ActiveDocumentRunInfo["source"];
        step?: string;
      } = {},
    ): Effect.Effect<A, E | AgentError> =>
      acquireDocumentLock(docId, options).pipe(
        Effect.mapError((error) =>
          error instanceof AgentError
            ? error
            : new AgentError({
                message: `Failed to acquire processing lock for document ${docId}: ${String(error)}`,
                agent: "pipeline",
                cause: error,
              }),
        ),
        Effect.flatMap((lock) =>
          Effect.gen(function* () {
            const cancelRequested = yield* Ref.make(false);
            const cancelReason = yield* Ref.make<string | null>(null);
            const monitoredEffect = effect.pipe(
              Effect.tap(() =>
                addProcessingLog("record run completion", {
                  docId,
                  timestamp: new Date().toISOString(),
                  step: "pipeline",
                  eventType: "run_completed",
                  data: { runId: lock.runId, dryRun: options.dryRun === true },
                }),
              ),
              Effect.tapError((error) =>
                Effect.gen(function* () {
                  const failure = yield* recordStageFailure(docId, "pipeline", error, {
                    dryRun: options.dryRun,
                    runId: lock.runId,
                  });
                  yield* addProcessingLog("record run failure", {
                    docId,
                    timestamp: new Date().toISOString(),
                    step: "pipeline",
                    eventType: "run_failed",
                    data: {
                      runId: lock.runId,
                      dryRun: options.dryRun === true,
                      error: failure.message,
                      failure,
                    },
                  });
                }),
              ),
              Effect.ensuring(
                Effect.gen(function* () {
                  const cancelled = yield* Ref.get(cancelRequested);
                  if (cancelled) {
                    const reason = yield* Ref.get(cancelReason);
                    yield* addProcessingLog("record run cancellation", {
                      docId,
                      timestamp: new Date().toISOString(),
                      step: "pipeline",
                      eventType: "run_cancelled",
                      data: { runId: lock.runId, dryRun: options.dryRun === true, reason },
                    });
                  }
                  yield* Ref.update(activeRuns, (runs) => {
                    const next = new Map(runs);
                    if (next.get(docId)?.info.runId === lock.runId) next.delete(docId);
                    return next;
                  });
                  yield* bestEffort(
                    "release processing lock",
                    locks.release("document", docId, lock.runId),
                  );
                  if (!options.dryRun) {
                    yield* bestEffort(
                      "clear active case run",
                      cases.getOrCreateCaseForDocument(docId).pipe(
                        Effect.flatMap((caseRecord) =>
                          caseRecord.activeRunId === lock.runId
                            ? cases.updateCase(caseRecord.id, {
                                activeRunId: null,
                                lastRunId: lock.runId,
                                ...(caseRecord.automationStatus === "running"
                                  ? { automationStatus: "ready" as const }
                                  : {}),
                              })
                            : Effect.succeed(caseRecord),
                        ),
                      ),
                    );
                  }
                  yield* addProcessingLog("record lock release", {
                    docId,
                    timestamp: new Date().toISOString(),
                    step: "lock",
                    eventType: "lock_released",
                    data: { runId: lock.runId, dryRun: options.dryRun === true },
                  });
                }),
              ),
            );
            const fiber = yield* Effect.fork(
              Effect.raceFirst(monitoredEffect, heartbeatWatchdog(docId, lock.runId)),
            );
            yield* Ref.update(activeRuns, (runs) => {
              const next = new Map(runs);
              next.set(docId, {
                info: {
                  docId,
                  runId: lock.runId,
                  startedAt: lock.acquiredAt,
                  source: options.source,
                  step: options.step,
                  dryRun: options.dryRun,
                },
                fiber,
                cancelRequested,
                cancelReason,
              });
              return next;
            });
            return yield* Fiber.join(fiber);
          }),
        ),
      );

    const getPipelineConfig = () =>
      Effect.gen(function* () {
        const dbSettings: Record<string, string> = yield* tinybase
          .getAllSettings()
          .pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, string>)));
        const getBool = (key: string, fallback: boolean): boolean => {
          return getBoolSetting(dbSettings, [key], fallback);
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

    const getCasePhaseState = (docId: number): ProcessingState | null => {
      const store = tinybase.store as
        | { getRow?: (tableId: string, rowId: string) => Record<string, unknown> }
        | undefined;
      const row = store?.getRow?.("documentCases", `doc-${docId}`);
      const phase = row?.["phase"];
      const automationStatus = row?.["automationStatus"];
      if (automationStatus === "needs_input") return "review";
      if (automationStatus === "failed" || phase === "failed") return "failed";
      if (automationStatus === "done" || phase === "done") return "done";
      if (phase === "ocr" || phase === "metadata" || phase === "index") return phase;
      return null;
    };

    const getCurrentState = (doc: Document): ProcessingState => {
      const caseState = getCasePhaseState(doc.id);
      if (caseState) return caseState;
      return getProcessingStateFromDocumentTags(doc, tagConfig, tagMapRef.current);
    };

    const workflowTagNames = getWorkflowTagNames(tagConfig);

    const transition = (docId: number, toTag: string) =>
      Effect.gen(function* () {
        const [doc, tags, toTagId] = yield* Effect.all(
          [paperless.getDocument(docId), paperless.getTags(), paperless.getOrCreateTag(toTag)],
          { concurrency: "unbounded" },
        );
        const workflowTagIds = new Set(
          tags
            .filter((tag) => isConfiguredWorkflowTagName(tag.name, workflowTagNames))
            .map((tag) => tag.id),
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

    const workflowTagForState = (state: ProcessingState): string | null =>
      getWorkflowTagForState(state, tagConfig);

    const defaultCaseStateFor = (
      state: ProcessingState,
    ): Pick<UpdateCaseInput, "phase" | "automationStatus"> => {
      const phaseByState: Record<ProcessingState, CasePhase> = {
        todo: "new",
        ocr: "ocr",
        metadata: "metadata",
        review: "metadata",
        index: "index",
        done: "done",
        failed: "failed",
      };
      const statusByState: Record<ProcessingState, CaseAutomationStatus> = {
        todo: "queued",
        ocr: "running",
        metadata: "running",
        review: "needs_input",
        index: "running",
        done: "done",
        failed: "failed",
      };
      return { phase: phaseByState[state], automationStatus: statusByState[state] };
    };

    const projectWorkflowState = (
      docId: number,
      state: ProcessingState,
      updates: UpdateCaseInput = {},
      options: { dryRun?: boolean; updateCase?: boolean } = {},
    ) =>
      Effect.gen(function* () {
        const toTag = workflowTagForState(state);
        if (!options.dryRun && options.updateCase !== false) {
          yield* patchCase(docId, {
            ...defaultCaseStateFor(state),
            ...updates,
          });
        }
        if (!options.dryRun && toTag) {
          yield* transition(docId, toTag);
        }
        yield* addProcessingLog("record projected workflow state", {
          docId,
          timestamp: new Date().toISOString(),
          step: "pipeline",
          eventType: "state_transition",
          data: { authoritativeState: state, projectedTag: toTag, dryRun: options.dryRun === true },
        });
      });

    const indexDocument = (docId: number, options: { dryRun?: boolean } = {}) =>
      Effect.gen(function* () {
        const settings: Record<string, string> = yield* tinybase
          .getAllSettings()
          .pipe(Effect.catchAll(() => Effect.succeed({} as Record<string, string>)));
        const vectorSearchEnabled = getAnyBoolSetting(
          settings,
          ["vector_search.enabled", "vector_search_enabled"],
          false,
        );
        if (!vectorSearchEnabled) {
          return { indexed: false, skipped: true, skipReason: "vector_search_disabled" };
        }

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

        if (options.dryRun) {
          return {
            indexed: false,
            dryRun: true,
            wouldIndex: true,
            contentLength: (doc.content ?? "").length,
            tags: tagNames,
            correspondent,
            documentType,
          };
        }

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
          yield* addProcessingLog("record qdrant index failure", {
            docId,
            timestamp: new Date().toISOString(),
            step: "qdrant_index",
            eventType: "error",
            data: { indexed: false, error },
          });
          return { indexed: false, error };
        }

        yield* addProcessingLog("record qdrant index success", {
          docId,
          timestamp: new Date().toISOString(),
          step: "qdrant_index",
          eventType: "result",
          data: { indexed: true },
        });

        return { indexed: true };
      });

    const isTimeoutFailureValue = (value: unknown): boolean =>
      !!value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      (value as Record<string, unknown>)["kind"] === "timeout";

    const hasPreviousMetadataTimeout = (caseRecord: DocumentCase): boolean =>
      caseRecord.lastFailure?.kind === "timeout" ||
      isTimeoutFailureValue(caseRecord.memory["lastFailure"]);

    const buildAppliedMetadataFromAnsweredQuestions = (
      caseRecord: DocumentCase,
    ): Record<string, unknown> => {
      const applied: Record<string, unknown> = {};
      const questionsById = new Map(
        caseRecord.questions.map((question) => [question.id, question]),
      );
      const tagIds = new Set<number>();

      for (const answer of caseRecord.answers) {
        const question = questionsById.get(answer.questionId);
        const selected = answer.selectedCandidate;
        if (question && selected?.id !== null && selected?.id !== undefined) {
          if (question.entityKind === "correspondent") {
            applied["correspondent"] = selected.id;
          } else if (question.entityKind === "document_type") {
            applied["document_type"] = selected.id;
          } else if (question.entityKind === "tag") {
            tagIds.add(selected.id);
          }
        }

        if (answer.metadataPatch) {
          if (answer.metadataPatch.title) applied["title"] = answer.metadataPatch.title;
          if (answer.metadataPatch.correspondentId !== undefined) {
            applied["correspondent"] = answer.metadataPatch.correspondentId;
          }
          if (answer.metadataPatch.documentTypeId !== undefined) {
            applied["document_type"] = answer.metadataPatch.documentTypeId;
          }
          for (const tagId of answer.metadataPatch.tagIds ?? []) {
            tagIds.add(tagId);
          }
        }
      }

      if (tagIds.size > 0) {
        applied["added_tag_ids"] = [...tagIds];
      }
      return applied;
    };

    const normalizeFieldKey = (value: string): string =>
      value
        .trim()
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/ä/g, "ae")
        .replace(/ö/g, "oe")
        .replace(/ü/g, "ue")
        .replace(/ß/g, "ss")
        .replace(/[^a-z0-9]+/g, " ")
        .trim();

    const isRealCorrespondentFieldName = (name: string): boolean => {
      const key = normalizeFieldKey(name);
      return (
        key === "echter korrespondent" ||
        key === "real correspondent" ||
        key === "actual correspondent" ||
        key === "seller" ||
        key === "merchant" ||
        key === "haendler" ||
        key === "handler" ||
        key === "verkaeufer" ||
        key === "verkaufer"
      );
    };

    const cleanMerchantCandidate = (value: string): string | null => {
      const candidate = value
        .replace(/\*\*/g, "")
        .replace(/^\|+|\|+$/g, "")
        .replace(/\s*\|.*$/g, "")
        .replace(/\s+/g, " ")
        .trim();
      if (candidate.length < 2 || candidate.length > 120) return null;
      if (!/[a-zA-Z]/.test(candidate)) return null;
      if (candidate.split(/\s+/).length > 8) return null;
      if (
        /^(we|if|for|this|the|der|die|das|order|status|pending|seller|merchant)\b/i.test(candidate)
      ) {
        return null;
      }
      if (/[!?]/.test(candidate)) return null;
      return candidate;
    };

    const extractMerchantFromContent = (content: string): string | null => {
      const normalizedContent = content.replace(/\r/g, "\n");
      const patterns = [
        /\b(?:Seller|Merchant|Händler|Haendler|Verkäufer|Verkaeufer)\b\s*[:|]?\s*\n+\s*([^\n|]+)/i,
        /\|\s*(?:Seller|Merchant|Händler|Haendler|Verkäufer|Verkaeufer)\s*\|[^\n]*\n\|\s*([^|\n]+)/i,
        /\b(?:Seller|Merchant|Händler|Haendler|Verkäufer|Verkaeufer)\b\s*[:|-]\s*([^\n|]+)/i,
      ];

      for (const pattern of patterns) {
        const match = normalizedContent.match(pattern);
        const candidate = match?.[1] ? cleanMerchantCandidate(match[1]) : null;
        if (candidate) return candidate;
      }
      return null;
    };

    const upsertCustomFieldValue = (
      values: CustomFieldValue[],
      fieldId: number,
      value: unknown,
    ): { values: CustomFieldValue[]; changed: boolean } => {
      const existingIndex = values.findIndex((entry) => entry.field === fieldId);
      if (existingIndex >= 0) {
        if (values[existingIndex]?.value === value) return { values, changed: false };
        const next = [...values];
        next[existingIndex] = { field: fieldId, value };
        return { values: next, changed: true };
      }
      return { values: [...values, { field: fieldId, value }], changed: true };
    };

    const applyDeterministicCustomFieldFallbacks = (
      docId: number,
      applied: Record<string, unknown>,
    ) =>
      Effect.gen(function* () {
        const [doc, customFields] = yield* Effect.all(
          [
            paperless.getDocument(docId),
            paperless.getCustomFields().pipe(Effect.catchAll(() => Effect.succeed([]))),
          ],
          { concurrency: "unbounded" },
        );
        const realCorrespondentField = customFields.find((field) =>
          isRealCorrespondentFieldName(field.name),
        );
        const realCorrespondent = extractMerchantFromContent(doc.content ?? "");
        if (!realCorrespondentField || !realCorrespondent) return applied;

        const customFieldsApplied =
          applied["custom_fields"] && typeof applied["custom_fields"] === "object"
            ? { ...(applied["custom_fields"] as Record<string, unknown>) }
            : {};
        customFieldsApplied[String(realCorrespondentField.id)] = realCorrespondent;

        const currentFields = [...((doc.custom_fields ?? []) as CustomFieldValue[])];
        const { values, changed } = upsertCustomFieldValue(
          currentFields,
          realCorrespondentField.id,
          realCorrespondent,
        );
        if (!changed) return { ...applied, custom_fields: customFieldsApplied };

        yield* paperless.updateDocument(docId, { custom_fields: values });
        yield* addProcessingLog("record deterministic custom field fallback", {
          docId,
          timestamp: new Date().toISOString(),
          step: "custom_fields",
          eventType: "result",
          data: {
            source: "deterministic_seller_extraction",
            fieldId: realCorrespondentField.id,
            fieldName: realCorrespondentField.name,
            value: realCorrespondent,
          },
        });

        return { ...applied, custom_fields: customFieldsApplied };
      });

    const finishAnsweredReviewAfterTimeout = (docId: number, resume?: boolean, dryRun?: boolean) =>
      Effect.gen(function* () {
        if (!resume || dryRun) return null;

        const caseRecord = yield* cases
          .getCase(`doc-${docId}`)
          .pipe(Effect.catchAll(() => Effect.succeed(null)));
        if (!caseRecord) return null;
        const openQuestions = caseRecord.questions.filter((question) => question.status === "open");
        const humanDecisions = Array.isArray(caseRecord.memory["humanDecisions"])
          ? caseRecord.memory["humanDecisions"]
          : [];
        if (
          openQuestions.length > 0 ||
          caseRecord.answers.length === 0 ||
          humanDecisions.length === 0 ||
          !hasPreviousMetadataTimeout(caseRecord)
        ) {
          return null;
        }

        const applied = yield* applyDeterministicCustomFieldFallbacks(
          docId,
          buildAppliedMetadataFromAnsweredQuestions(caseRecord),
        );
        const sessionId =
          typeof caseRecord.memory["sessionId"] === "string" &&
          caseRecord.memory["sessionId"].trim()
            ? caseRecord.memory["sessionId"]
            : `doc-${docId}`;
        const runSummary = {
          id: `document-${Date.now()}`,
          agent: "document_agent",
          status: "completed",
          summary: "Completed from answered human decisions after the previous metadata timeout.",
          createdAt: new Date().toISOString(),
        };

        yield* cases
          .updateCase(caseRecord.id, {
            finalDecisions: applied,
            memory: { finalDecisions: applied },
          })
          .pipe(Effect.catchAll(() => Effect.succeed(caseRecord)));
        yield* cases
          .appendRunSummary(caseRecord.id, runSummary)
          .pipe(Effect.catchAll(() => Effect.void));
        yield* addProcessingLog("record answered review timeout shortcut", {
          docId,
          timestamp: new Date().toISOString(),
          step: "document_agent",
          eventType: "result",
          data: {
            resumedFromAnsweredHumanDecisions: true,
            previousFailureKind: "timeout",
            answeredQuestions: caseRecord.answers.length,
            appliedKeys: Object.keys(applied),
          },
        });

        const result: DocumentAgentResult = {
          success: true,
          docId,
          sessionId,
          needsReview: false,
          paused: false,
          applied,
          dryRun: false,
          toolCalls: [],
          agentMessageCount: 0,
          assistantPreview: "Skipped model prompt after answered human decisions.",
        };
        return result;
      });

    const processMetadata = (
      docId: number,
      metadataPolicy: MetadataPolicy,
      auto?: boolean,
      resume?: boolean,
      dryRun?: boolean,
      onAgentEvent?: (event: PipelineStreamEvent) => void,
      freshRun?: boolean,
    ) =>
      Effect.gen(function* () {
        yield* projectWorkflowState(docId, "metadata", {}, { dryRun });
        const answeredReviewResult = yield* finishAnsweredReviewAfterTimeout(docId, resume, dryRun);
        if (answeredReviewResult) {
          yield* projectWorkflowState(
            docId,
            "index",
            { finalDecisions: answeredReviewResult.applied },
            { dryRun },
          );
          return answeredReviewResult;
        }
        const result = yield* documentAgent.processDocument({
          docId,
          auto,
          resume,
          freshRun,
          dryRun,
          metadataPolicy,
          onEvent: onAgentEvent
            ? (agentEvent) => onAgentEvent(toPipelineAgentEvent(docId, "metadata", agentEvent))
            : undefined,
        });
        if (result.needsReview) {
          yield* projectWorkflowState(docId, "review", {}, { dryRun });
        } else if (!result.success) {
          const failure = yield* recordStageFailure(
            docId,
            "metadata",
            result.error ?? "Metadata agent failed",
            { dryRun },
          );
          yield* projectWorkflowState(docId, "failed", {}, { dryRun, updateCase: false });
          result.error = failure.message;
        } else {
          yield* projectWorkflowState(
            docId,
            "index",
            { finalDecisions: result.applied },
            { dryRun },
          );
        }
        return result;
      });

    const processIndex = (docId: number, dryRun?: boolean) =>
      Effect.gen(function* () {
        if (dryRun) return yield* indexDocument(docId, { dryRun: true });
        yield* projectWorkflowState(docId, "index", {}, { dryRun });
        const result = yield* indexDocument(docId);
        if (result.error) {
          yield* recordStageFailure(docId, "index", result.error, { dryRun });
          yield* projectWorkflowState(docId, "failed", {}, { dryRun, updateCase: false });
          return result;
        }
        yield* projectWorkflowState(docId, "done", {}, { dryRun });
        return result;
      });

    const dryRunOcrPreview = (doc: Document) => {
      const existingContentLength = (doc.content ?? "").trim().length;
      if (existingContentLength >= 50) {
        return {
          success: true,
          docId: doc.id,
          textLength: existingContentLength,
          pages: 1,
          skipped: true,
          dryRun: true,
          skipReason: "existing_content",
        };
      }
      return {
        success: true,
        docId: doc.id,
        textLength: existingContentLength,
        pages: 0,
        skipped: false,
        dryRun: true,
        wouldRunMistral: true,
      };
    };

    const service: ProcessingPipelineService = {
      getCurrentState,

      getActiveDocumentRun: (docId) =>
        Ref.get(activeRuns).pipe(Effect.map((runs) => runs.get(docId)?.info ?? null)),

      cancelDocumentRun: (input) =>
        Effect.gen(function* () {
          const requestedRunId = input.runId?.trim();
          const activeRun = (yield* Ref.get(activeRuns)).get(input.docId);
          if (!activeRun) {
            const lock = yield* locks.get("document", input.docId).pipe(
              Effect.mapError(
                (error) =>
                  new AgentError({
                    message: `Failed to inspect processing lock for document ${input.docId}: ${String(error)}`,
                    agent: "pipeline",
                    cause: error,
                  }),
              ),
            );
            const caseRecord = yield* cases
              .getOrCreateCaseForDocument(input.docId)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            const orphanedRunId = lock?.runId ?? caseRecord?.activeRunId ?? null;
            const requestedMatches =
              !requestedRunId || (orphanedRunId !== null && requestedRunId === orphanedRunId);
            if (orphanedRunId && requestedMatches) {
              const lockReleased = lock
                ? yield* locks.release("document", input.docId, lock.runId).pipe(
                    Effect.mapError(
                      (error) =>
                        new AgentError({
                          message: `Failed to release orphaned processing lock for document ${input.docId}: ${String(error)}`,
                          agent: "pipeline",
                          cause: error,
                        }),
                    ),
                  )
                : false;
              if (caseRecord && caseRecord.activeRunId === orphanedRunId) {
                yield* bestEffort(
                  "clear orphaned active case run",
                  cases.updateCase(caseRecord.id, {
                    activeRunId: null,
                    lastRunId: orphanedRunId,
                    ...(caseRecord.automationStatus === "running"
                      ? { automationStatus: "ready" as const }
                      : {}),
                  }),
                );
              }
              yield* addProcessingLog("record orphaned run cancellation", {
                docId: input.docId,
                timestamp: new Date().toISOString(),
                step: "pipeline",
                eventType: "run_cancelled",
                data: {
                  runId: orphanedRunId,
                  reason: input.reason?.trim() || null,
                  orphaned: true,
                  lockReleased,
                },
              });
              if (lockReleased) {
                yield* addProcessingLog("record orphaned lock release", {
                  docId: input.docId,
                  timestamp: new Date().toISOString(),
                  step: "lock",
                  eventType: "lock_released",
                  data: { runId: orphanedRunId, orphaned: true },
                });
              }
              return {
                status: "cancelled_orphaned_run" as const,
                docId: input.docId,
                runId: orphanedRunId,
                lockReleased,
              };
            }
            return {
              status: "no_active_run" as const,
              docId: input.docId,
              lockRunId: lock?.runId ?? null,
            };
          }
          if (requestedRunId && requestedRunId !== activeRun.info.runId) {
            return {
              status: "run_mismatch" as const,
              docId: input.docId,
              activeRunId: activeRun.info.runId,
              requestedRunId,
            };
          }

          yield* Ref.set(activeRun.cancelRequested, true);
          yield* Ref.set(activeRun.cancelReason, input.reason?.trim() || null);
          yield* Effect.fork(Fiber.interrupt(activeRun.fiber));
          return { status: "cancelling" as const, docId: input.docId, runId: activeRun.info.runId };
        }),

      processDocument: (input) => {
        const run = withDocumentLock(
          input.docId,
          Effect.gen(function* () {
            const steps: Record<string, PipelineStepResult> = {};
            const pipelineConfig = yield* getPipelineConfig();
            const doc = yield* paperless.getDocument(input.docId);
            let state = getCurrentState(doc);
            const freshRun = input.rerun === true || input.resume === false;

            if (input.dryRun) {
              if (state === "todo" && pipelineConfig.enableOcr) {
                const result = dryRunOcrPreview(doc);
                steps["ocr"] = { step: "ocr", success: result.success, data: result };
                state = "metadata";
              }
              if (!pipelineConfig.enableMetadata) {
                return { docId: input.docId, success: true, needsReview: false, steps };
              }
              const result = yield* processMetadata(
                input.docId,
                pipelineConfig.metadataPolicy,
                input.auto,
                input.resume,
                true,
                input.onAgentEvent,
                freshRun,
              );
              steps["metadata"] = { step: "metadata", success: result.success, data: result };
              if (result.success && !result.needsReview) {
                const indexResult = yield* processIndex(input.docId, true);
                steps["index"] = {
                  step: "index",
                  success: !indexResult.error,
                  data: indexResult,
                  error: indexResult.error,
                };
              }
              return {
                docId: input.docId,
                success: result.success,
                needsReview: result.needsReview,
                steps,
                error: result.error,
              };
            }

            if (state === "done" && freshRun) {
              yield* projectWorkflowState(
                input.docId,
                "todo",
                { lastFailure: null, activeRunId: null },
                { dryRun: input.dryRun },
              );
              state = "todo";
            }

            if (state === "done") {
              return { docId: input.docId, success: true, needsReview: false, steps };
            }

            if (state === "failed") {
              yield* projectWorkflowState(
                input.docId,
                "todo",
                { lastFailure: null, activeRunId: null },
                { dryRun: input.dryRun },
              );
              state = "todo";
            }

            if (state === "review" && !input.resume) {
              return { docId: input.docId, success: false, needsReview: true, steps };
            }
            if (state === "review" && input.resume) {
              yield* projectWorkflowState(input.docId, "metadata", {}, { dryRun: input.dryRun });
              state = "metadata";
            }

            if (state === "todo" && pipelineConfig.enableOcr) {
              yield* projectWorkflowState(input.docId, "ocr", {}, { dryRun: input.dryRun });
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
                const failure = yield* recordStageFailure(
                  input.docId,
                  "ocr",
                  result.error ?? "OCR failed",
                  { dryRun: input.dryRun },
                );
                yield* projectWorkflowState(
                  input.docId,
                  "failed",
                  {},
                  { dryRun: input.dryRun, updateCase: false },
                );
                return {
                  docId: input.docId,
                  success: false,
                  needsReview: false,
                  steps,
                  error: failure.message,
                };
              }
              yield* projectWorkflowState(input.docId, "metadata", {}, { dryRun: input.dryRun });
              state = "metadata";
            } else if (state === "todo") {
              yield* projectWorkflowState(input.docId, "metadata", {}, { dryRun: input.dryRun });
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
                input.dryRun,
                input.onAgentEvent,
                freshRun,
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
              yield* projectWorkflowState(input.docId, "index", {}, { dryRun: input.dryRun });
              state = "index";
            }

            if (state === "index") {
              const result = yield* processIndex(input.docId, input.dryRun);
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
          {
            dryRun: input.dryRun,
            resume: input.resume === true,
            rerun: input.rerun === true || input.resume === false,
            source: input.auto ? "auto" : "manual",
          },
        );
        const instrumented = instrumentPhase(
          "pipeline",
          metricMode(input.dryRun),
          input.dryRun ? withCaseSnapshot(input.docId, run) : run,
          (result) =>
            result.needsReview ? "needs_review" : result.success ? "success" : "failure",
        );
        return instrumented.pipe(
          withInternalSpan("pipeline.process_document", {
            "paperless.document.id": input.docId,
            "pipeline.dry_run": input.dryRun === true,
            "pipeline.auto": input.auto === true,
            "pipeline.resume": input.resume === true,
            "pipeline.rerun": input.rerun === true || input.resume === false,
          }),
        );
      },

      processStep: (docId, step, dryRun) => {
        const run = withDocumentLock(
          docId,
          Effect.gen(function* () {
            const normalized = yield* parseStep(step);
            const pipelineConfig = yield* getPipelineConfig();
            if (normalized === "ocr") {
              if (dryRun) {
                const doc = yield* paperless.getDocument(docId);
                const result = dryRunOcrPreview(doc);
                return {
                  step: "ocr",
                  success: result.success,
                  data: result,
                };
              }
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
              yield* projectWorkflowState(docId, "ocr");
              const result = yield* ocrAgent.process({ docId }).pipe(
                Effect.catchAll((error) =>
                  Effect.succeed({
                    success: false,
                    docId,
                    textLength: 0,
                    pages: 0,
                    error: String(error),
                  }),
                ),
              );
              if (result.success) {
                yield* projectWorkflowState(docId, "metadata");
              } else {
                yield* recordStageFailure(docId, "ocr", result.error ?? "OCR failed", { dryRun });
                yield* projectWorkflowState(docId, "failed", {}, { dryRun, updateCase: false });
              }
              return { step: "ocr", success: result.success, data: result };
            }
            if (normalized === "metadata") {
              const result = yield* processMetadata(
                docId,
                pipelineConfig.metadataPolicy,
                undefined,
                undefined,
                dryRun,
              );
              return { step, success: result.success, data: result };
            }
            const result = yield* processIndex(docId, dryRun);
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
          { dryRun, source: "step", step },
        );
        return instrumentPhase(
          metricPhase(step),
          dryRun ? "dry_run" : "step",
          dryRun ? withCaseSnapshot(docId, run) : run,
          (result) => {
            const data = result.data as
              | { needsReview?: boolean; paused?: boolean; skipped?: boolean }
              | undefined;
            if (data?.skipped) return "skipped";
            if (data?.needsReview || data?.paused) return "needs_review";
            return result.success ? "success" : "failure";
          },
        ).pipe(
          withInternalSpan("pipeline.process_step", {
            "paperless.document.id": docId,
            "pipeline.step": step,
            "pipeline.dry_run": dryRun === true,
          }),
        );
      },

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

      processStepStream: (docId, step, dryRun) =>
        Stream.asyncEffect<PipelineStreamEvent, AgentError>((emit) =>
          Effect.gen(function* () {
            yield* Effect.sync(() => emit.single(event({ type: "step_start", docId, step })));
            const normalized = yield* parseStep(step);
            const result =
              normalized === "metadata"
                ? yield* (() => {
                    const run = withDocumentLock(
                      docId,
                      Effect.gen(function* () {
                        const pipelineConfig = yield* getPipelineConfig();
                        const metadataResult = yield* processMetadata(
                          docId,
                          pipelineConfig.metadataPolicy,
                          undefined,
                          undefined,
                          dryRun,
                          (agentEvent) => emit.single(agentEvent),
                        );
                        return {
                          step,
                          success: metadataResult.success,
                          data: metadataResult,
                          error: metadataResult.error,
                        };
                      }),
                      { dryRun, source: "sse", step },
                    );
                    return dryRun ? withCaseSnapshot(docId, run) : run;
                  })()
                : yield* service.processStep(docId, step, dryRun);
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
