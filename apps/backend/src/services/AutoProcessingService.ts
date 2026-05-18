/**
 * Auto Processing Service - Background loop for automatic document processing.
 *
 * Continuously checks for pending documents and processes them through the pipeline.
 */
import { Context, Deferred, Duration, Effect, Fiber, Layer, Option, Ref } from "effect";
import { ProcessingPipelineService } from "../agents/ProcessingPipeline.js";
import { ConfigService } from "../config/index.js";
import { logger } from "../utils/logger.js";
import { LockService } from "./LockService.js";
import { PaperlessService } from "./PaperlessService.js";
import { TinyBaseService } from "./TinyBaseService.js";

// ===========================================================================
// Types
// ===========================================================================

export interface AutoProcessingStatus {
  running: boolean;
  enabled: boolean;
  intervalMinutes: number;
  includeUntagged: boolean;
  queueLength: number;
  lastCheckAt: string | null;
  currentlyProcessingDocId: number | null;
  currentlyProcessingDocTitle: string | null;
  currentStep: string | null;
  processedSinceStart: number;
  errorsSinceStart: number;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface AutoProcessingService {
  readonly start: () => Effect.Effect<void, never>;
  readonly stop: () => Effect.Effect<void, never>;
  readonly getStatus: () => Effect.Effect<AutoProcessingStatus, never>;
  readonly trigger: () => Effect.Effect<void, never>;
}

export const AutoProcessingService =
  Context.GenericTag<AutoProcessingService>("AutoProcessingService");

const autoProcessingLogger = logger.child({ component: "auto_processing" });

// ===========================================================================
// Live Implementation
// ===========================================================================

export const AutoProcessingServiceLive = Layer.effect(
  AutoProcessingService,
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const paperless = yield* PaperlessService;
    const tinybase = yield* TinyBaseService;
    const pipeline = yield* ProcessingPipelineService;
    const locks = yield* LockService;

    // State refs
    const runningRef = yield* Ref.make(false);
    const currentDocRef = yield* Ref.make<number | null>(null);
    const currentDocTitleRef = yield* Ref.make<string | null>(null);
    const currentStepRef = yield* Ref.make<string | null>(null);
    const lastCheckRef = yield* Ref.make<string | null>(null);
    const queueLengthRef = yield* Ref.make(0);
    const includeUntaggedRef = yield* Ref.make(false);
    const processedCountRef = yield* Ref.make(0);
    const errorCountRef = yield* Ref.make(0);
    const fiberRef = yield* Ref.make<Fiber.RuntimeFiber<void, never> | null>(null);
    const documentBackoffRef = yield* Ref.make(new Map<number, { retryAfter: number; reason: string }>());
    const documentFailureCountRef = yield* Ref.make(new Map<number, number>());

    // Deferred for triggering immediate check (interrupts sleep)
    const triggerDeferredRef = yield* Ref.make<Deferred.Deferred<void, never> | null>(null);

    const tagConfig = config.config.tags;

    // Get auto processing settings from TinyBase (runtime configurable)
    const getSettings = Effect.gen(function* () {
      const enabledStr = yield* tinybase.getSetting("auto_processing.enabled");
      const intervalStr = yield* tinybase.getSetting("auto_processing.interval_minutes");
      const includeUntaggedStr = yield* tinybase.getSetting("auto_processing.include_untagged");

      // Parse and validate interval - fall back to config default if invalid
      const parsedInterval = intervalStr ? parseInt(intervalStr, 10) : NaN;
      const intervalMinutes =
        Number.isFinite(parsedInterval) && parsedInterval > 0
          ? parsedInterval
          : config.config.autoProcessing.intervalMinutes;

      return {
        enabled:
          enabledStr === "true"
            ? true
            : enabledStr === "false"
              ? false
              : config.config.autoProcessing.enabled,
        intervalMinutes,
        includeUntagged:
          includeUntaggedStr === "true"
            ? true
            : includeUntaggedStr === "false"
              ? false
              : config.config.autoProcessing.includeUntagged,
      };
    });

    // The main processing loop
    const runLoop: Effect.Effect<void, never, never> = Effect.gen(function* () {
      autoProcessingLogger.info("background_loop_started");

      while (yield* Ref.get(runningRef)) {
        const settings = yield* getSettings.pipe(
          Effect.catchAll(() =>
            Effect.succeed({ enabled: false, intervalMinutes: 5, includeUntagged: false }),
          ),
        );
        yield* Ref.set(includeUntaggedRef, settings.includeUntagged);

        // If not enabled, wait a short time and check again
        if (!settings.enabled) {
          yield* Effect.sleep(Duration.seconds(5));
          continue;
        }

        // Check for documents at any canonical or legacy Pi pipeline stage.
        yield* locks.pruneStale().pipe(Effect.catchAll(() => Effect.succeed(0)));
        const now = Date.now();
        const documentBackoff = yield* Ref.updateAndGet(documentBackoffRef, (entries) => {
          const next = new Map(entries);
          for (const [docId, entry] of next) {
            if (entry.retryAfter <= now) next.delete(docId);
          }
          return next;
        });
        const stageTags = (...tagNames: string[]): string[] => [
          ...new Set(tagNames.filter(Boolean)),
        ];
        const processingStageTags = stageTags(
          tagConfig.todo,
          tagConfig.pending,
          tagConfig.ocr,
          tagConfig.ocrDone,
          tagConfig.metadata,
          tagConfig.summaryDone,
          tagConfig.titleDone,
          tagConfig.correspondentDone,
          tagConfig.documentTypeDone,
          tagConfig.index,
          tagConfig.tagsDone,
        );
        const allWorkflowStageTags = stageTags(
          ...processingStageTags,
          tagConfig.review,
          tagConfig.schemaReview,
          tagConfig.manualReview,
          tagConfig.done,
          tagConfig.processed,
          tagConfig.failed,
        );
        const primaryProcessingTags = stageTags(
          tagConfig.ocr,
          tagConfig.metadata,
          tagConfig.summaryDone,
          tagConfig.index,
        );
        const usesCoarseProcessingTag =
          new Set([tagConfig.todo, ...primaryProcessingTags]).size === 1;
        const usesQueuedAndActiveTags =
          new Set(primaryProcessingTags).size === 1 && tagConfig.todo !== tagConfig.ocr;
        const pipelineStages: Array<{ tags: string[]; processingStep: string }> =
          usesCoarseProcessingTag
            ? [{ tags: processingStageTags, processingStep: "case" }]
            : usesQueuedAndActiveTags
              ? [
                  { tags: stageTags(tagConfig.todo, tagConfig.pending), processingStep: "case" },
                  { tags: primaryProcessingTags, processingStep: "case" },
                ]
              : [
                  { tags: stageTags(tagConfig.todo, tagConfig.pending), processingStep: "ocr" },
                  { tags: stageTags(tagConfig.ocr, tagConfig.ocrDone), processingStep: "metadata" },
                  {
                    tags: stageTags(
                      tagConfig.metadata,
                      tagConfig.summaryDone,
                      tagConfig.titleDone,
                      tagConfig.correspondentDone,
                      tagConfig.documentTypeDone,
                    ),
                    processingStep: "metadata",
                  },
                  { tags: stageTags(tagConfig.index, tagConfig.tagsDone), processingStep: "index" },
                ];

        let docToProcess: { id: number; title: string; tags: readonly number[] } | null = null;
        let currentStep: string | null = null;
        let discoveredQueueLength = 0;

        // Filter out final-state documents that still have stale stage tags.
        const finalTagIds = new Set<number>();
        for (const finalTagName of stageTags(tagConfig.done, tagConfig.processed)) {
          const finalTag = yield* paperless
            .getTagByName(finalTagName)
            .pipe(Effect.catchAll(() => Effect.succeed(Option.none<{ id: number }>())));
          if (Option.isSome(finalTag)) finalTagIds.add(finalTag.value.id);
        }
        const workflowTagIds = new Set<number>();
        for (const workflowTagName of allWorkflowStageTags) {
          const workflowTag = yield* paperless
            .getTagByName(workflowTagName)
            .pipe(Effect.catchAll(() => Effect.succeed(Option.none<{ id: number }>())));
          if (Option.isSome(workflowTag)) workflowTagIds.add(workflowTag.value.id);
        }

        for (const stage of pipelineStages) {
          // Fetch each pipeline stage with one OR query across canonical and legacy tags.
          const docs = yield* paperless.getDocumentsByTags(stage.tags, 10).pipe(
            Effect.catchAll((e) => {
              autoProcessingLogger.error("stage_documents_fetch_failed", {
                stageTags: stage.tags,
                processingStep: stage.processingStep,
                error: e,
              });
              return Effect.succeed([]);
            }),
          );

          // Filter out documents that already have a final-state tag
          const eligibleDocs =
            finalTagIds.size > 0
              ? docs.filter((d) => !d.tags.some((tagId) => finalTagIds.has(tagId)))
              : docs;
          const unlockedDocs: typeof eligibleDocs = [];
          for (const candidate of eligibleDocs) {
            if (documentBackoff.has(candidate.id)) continue;
            const lock = yield* locks
              .get("document", candidate.id)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (!lock) {
              unlockedDocs.push(candidate);
            }
          }
          discoveredQueueLength += unlockedDocs.length;

          const firstUnlockedDoc = unlockedDocs[0];
          if (firstUnlockedDoc) {
            docToProcess = firstUnlockedDoc;
            currentStep = stage.processingStep;
            autoProcessingLogger.info("stage_document_selected", {
              docId: firstUnlockedDoc.id,
              title: firstUnlockedDoc.title,
              stageTags: stage.tags,
              processingStep: stage.processingStep,
              queueLength: unlockedDocs.length,
            });
            break;
          } else if (docs.length > 0 && eligibleDocs.length === 0) {
            autoProcessingLogger.info("stage_documents_already_final", {
              stageTags: stage.tags,
              documentCount: docs.length,
            });
          }
        }

        if (!docToProcess && settings.includeUntagged) {
          const docs = yield* paperless.getDocuments({ pageSize: 25 }).pipe(
            Effect.catchAll((e) => {
              autoProcessingLogger.error("untagged_candidates_fetch_failed", { error: e });
              return Effect.succeed([]);
            }),
          );
          const eligibleDocs = docs.filter(
            (candidate) => !candidate.tags.some((tagId) => workflowTagIds.has(tagId)),
          );
          const unlockedDocs: typeof eligibleDocs = [];
          for (const candidate of eligibleDocs) {
            const lock = yield* locks
              .get("document", candidate.id)
              .pipe(Effect.catchAll(() => Effect.succeed(null)));
            if (!lock) {
              unlockedDocs.push(candidate);
            }
          }
          discoveredQueueLength += unlockedDocs.length;
          const firstUnlockedDoc = unlockedDocs[0];
          if (firstUnlockedDoc) {
            docToProcess = firstUnlockedDoc;
            currentStep = "case";
            autoProcessingLogger.info("untagged_document_selected", {
              docId: docToProcess.id,
              title: docToProcess.title,
              queueLength: unlockedDocs.length,
            });
          }
        }

        // Update last check time on every poll
        yield* Ref.set(lastCheckRef, new Date().toISOString());
        yield* Ref.set(queueLengthRef, discoveredQueueLength);

        if (docToProcess) {
          const doc = docToProcess;
          const runLogger = autoProcessingLogger.child({
            docId: doc.id,
            title: doc.title,
            processingStep: currentStep,
          });
          runLogger.info("document_processing_started");

          yield* Ref.set(currentDocRef, doc.id);
          yield* Ref.set(currentDocTitleRef, doc.title);
          yield* Ref.set(currentStepRef, currentStep);

          // Process the document
          yield* pipeline.processDocument({ docId: doc.id }).pipe(
            Effect.tap((result) =>
              Effect.gen(function* () {
                if (result.success) {
                  yield* Ref.update(documentFailureCountRef, (entries) => {
                    const next = new Map(entries);
                    next.delete(doc.id);
                    return next;
                  });
                  runLogger.info("document_processing_completed", {
                    needsReview: result.needsReview,
                  });
                } else if (result.needsReview) {
                  yield* Ref.update(documentFailureCountRef, (entries) => {
                    const next = new Map(entries);
                    next.delete(doc.id);
                    return next;
                  });
                  runLogger.info("document_processing_needs_review");
                } else {
                  runLogger.warn("document_processing_failed", { error: result.error });
                  const failureCount = yield* Ref.updateAndGet(documentFailureCountRef, (entries) => {
                    const next = new Map(entries);
                    next.set(doc.id, (next.get(doc.id) ?? 0) + 1);
                    return next;
                  }).pipe(Effect.map((entries) => entries.get(doc.id) ?? 1));
                  const isOcrInProgress = result.error?.includes("OCR is already in progress");
                  const retryAfterMinutes = isOcrInProgress
                    ? 10
                    : Math.min(30, Math.max(2, failureCount * 2));
                  yield* Ref.update(documentBackoffRef, (entries) => {
                    const next = new Map(entries);
                    next.set(doc.id, {
                      retryAfter: Date.now() + Duration.toMillis(Duration.minutes(retryAfterMinutes)),
                      reason: result.error ?? "processing_failed",
                    });
                    return next;
                  });
                  runLogger.info("document_temporarily_skipped_after_failure", {
                    retryAfterMinutes,
                    failureCount,
                    error: result.error,
                  });
                }
              }),
            ),
            Effect.tap(() => Ref.update(processedCountRef, (n) => n + 1)),
            Effect.catchAll((e) => {
              runLogger.error("document_processing_error", { error: e });
              return Ref.update(errorCountRef, (n) => n + 1);
            }),
          );

          yield* Ref.set(currentDocRef, null);
          yield* Ref.set(currentDocTitleRef, null);
          yield* Ref.set(currentStepRef, null);

          // Immediately check for more work (no wait)
          continue;
        }

        // No work found - wait for interval
        autoProcessingLogger.info("no_documents_waiting", {
          intervalMinutes: settings.intervalMinutes,
          includeUntagged: settings.includeUntagged,
          queueLength: discoveredQueueLength,
        });

        // Create a deferred for manual trigger interruption
        const triggerDeferred = yield* Deferred.make<void, never>();
        yield* Ref.set(triggerDeferredRef, triggerDeferred);

        // Wait for either the interval or a manual trigger
        yield* Effect.race(
          Effect.sleep(Duration.minutes(settings.intervalMinutes)),
          Deferred.await(triggerDeferred),
        );

        yield* Ref.set(triggerDeferredRef, null);
      }

      autoProcessingLogger.info("background_loop_stopped");
    }).pipe(Effect.catchAll(() => Effect.void)) as Effect.Effect<void, never, never>;

    const service: AutoProcessingService = {
      start: () =>
        Effect.gen(function* () {
          const isRunning = yield* Ref.get(runningRef);
          if (isRunning) {
            autoProcessingLogger.info("service_start_ignored_already_running");
            return;
          }

          yield* Ref.set(runningRef, true);
          yield* Ref.set(processedCountRef, 0);
          yield* Ref.set(errorCountRef, 0);

          // Fork the loop as a daemon (runs independently of parent scope)
          const fiber = yield* Effect.forkDaemon(runLoop);
          yield* Ref.set(fiberRef, fiber as Fiber.RuntimeFiber<void, never>);

          autoProcessingLogger.info("service_started");
        }),

      stop: () =>
        Effect.gen(function* () {
          yield* Ref.set(runningRef, false);

          // Interrupt any pending trigger deferred
          const triggerDeferred = yield* Ref.get(triggerDeferredRef);
          if (triggerDeferred) {
            yield* Deferred.succeed(triggerDeferred, undefined);
          }

          // Wait for fiber to complete
          const fiber = yield* Ref.get(fiberRef);
          if (fiber) {
            yield* Fiber.interrupt(fiber);
            yield* Ref.set(fiberRef, null);
          }

          autoProcessingLogger.info("service_stopped");
        }),

      getStatus: () =>
        Effect.gen(function* () {
          const running = yield* Ref.get(runningRef);
          const currentDocId = yield* Ref.get(currentDocRef);
          const currentDocTitle = yield* Ref.get(currentDocTitleRef);
          const currentStep = yield* Ref.get(currentStepRef);
          const lastCheckAt = yield* Ref.get(lastCheckRef);
          const queueLength = yield* Ref.get(queueLengthRef);
          const includeUntagged = yield* Ref.get(includeUntaggedRef);
          const processed = yield* Ref.get(processedCountRef);
          const errors = yield* Ref.get(errorCountRef);
          const settings = yield* getSettings.pipe(
            Effect.catchAll(() =>
              Effect.succeed({ enabled: false, intervalMinutes: 5, includeUntagged: false }),
            ),
          );

          return {
            running,
            enabled: settings.enabled,
            intervalMinutes: settings.intervalMinutes,
            includeUntagged: settings.includeUntagged || includeUntagged,
            queueLength,
            lastCheckAt,
            currentlyProcessingDocId: currentDocId,
            currentlyProcessingDocTitle: currentDocTitle,
            currentStep,
            processedSinceStart: processed,
            errorsSinceStart: errors,
          };
        }),

      trigger: () =>
        Effect.gen(function* () {
          const triggerDeferred = yield* Ref.get(triggerDeferredRef);
          if (triggerDeferred) {
            yield* Deferred.succeed(triggerDeferred, undefined);
            autoProcessingLogger.info("manual_trigger_accepted");
          } else {
            autoProcessingLogger.info("manual_trigger_ignored");
          }
        }),
    };

    return service;
  }),
);
