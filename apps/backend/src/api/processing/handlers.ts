/**
 * Processing API handlers.
 *
 * Document processing endpoints that invoke the processing pipeline.
 */
import { Effect } from "effect";
import { ProcessingPipelineService } from "../../agents/ProcessingPipeline.js";
import {
  AutoProcessingService,
  DocumentAuthorizationService,
  DocumentCaseService,
  LockService,
  PaperlessService,
  TinyBaseService,
} from "../../services/index.js";
import { getCachedQueueStats } from "../paperlessStatusCache.js";

// ===========================================================================
// Processing Control
// ===========================================================================

export const startProcessing = (docId: number, step?: string, dryRun?: boolean) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "process");
    const pipeline = yield* ProcessingPipelineService;

    if (step && step !== "all") {
      // Process a specific step
      const result = yield* pipeline.processStep(docId, step, dryRun);
      return {
        status: result.success ? "completed" : "failed",
        doc_id: docId,
        step,
        data: result.data,
        error: result.error,
      };
    } else {
      // Process all steps
      const result = yield* pipeline.processDocument({ docId, dryRun });
      return {
        status: result.success ? "completed" : result.needsReview ? "needs_review" : "failed",
        doc_id: docId,
        step: "all",
        data: result.steps,
        needsReview: result.needsReview,
        schemaReviewNeeded: result.schemaReviewNeeded,
        error: result.error,
      };
    }
  });

export const cancelProcessing = (
  docId: number,
  request: { runId?: string; reason?: string } = {},
) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "process");
    const pipeline = yield* ProcessingPipelineService;
    const result = yield* pipeline.cancelDocumentRun({
      docId,
      runId: request.runId,
      reason: request.reason,
    });
    if (result.status === "run_mismatch") {
      return {
        status: result.status,
        doc_id: result.docId,
        active_run_id: result.activeRunId,
        requested_run_id: result.requestedRunId,
      };
    }
    if (result.status === "cancelled_orphaned_run") {
      return {
        status: result.status,
        doc_id: result.docId,
        run_id: result.runId,
        lock_released: result.lockReleased,
      };
    }
    if (result.status === "no_active_run") {
      return {
        status: result.status,
        doc_id: result.docId,
        lock_run_id: result.lockRunId ?? null,
      };
    }
    return { status: result.status, doc_id: result.docId, run_id: result.runId };
  });

export const confirmProcessing = (docId: number, confirmed: boolean) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "process");
    return {
      status: "confirmed",
      doc_id: docId,
      confirmed,
    };
  });

const recoverableStatuses = new Set(["idle", "queued", "running", "ready"]);

const parsePositiveDocumentId = (value: string | number | null | undefined): number | null => {
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isInteger(numeric) && numeric > 0 ? numeric : null;
};

const isDocumentAuthorized = (docId: number, action: "view" | "process" | "change" | "admin") =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    return yield* auth.authorizeDocument(docId, action).pipe(
      Effect.as(true),
      Effect.catchAll(() => Effect.succeed(false)),
    );
  });

export const listLocks = Effect.gen(function* () {
  const locks = yield* LockService;
  const allLocks = yield* locks.list();
  const visibleLocks = yield* Effect.forEach(
    allLocks,
    (lock) => {
      if (lock.scope !== "document") return Effect.succeed(lock);
      const docId = parsePositiveDocumentId(lock.resourceId);
      if (docId === null) return Effect.succeed(null);
      return isDocumentAuthorized(docId, "view").pipe(
        Effect.map((authorized) => (authorized ? lock : null)),
      );
    },
    { concurrency: 4 },
  ).pipe(Effect.map((results) => results.filter((lock) => lock !== null)));
  return { locks: visibleLocks };
});

export const pruneStaleLocks = Effect.gen(function* () {
  const locks = yield* LockService;
  const pruned = yield* locks.pruneStale();
  return {
    success: true,
    pruned,
    message: `Pruned ${pruned} stale processing lock${pruned === 1 ? "" : "s"}`,
  };
});

export interface LockReleaseRequest {
  runId?: string;
  force?: boolean;
}

export const releaseDocumentLock = (docId: number, request: LockReleaseRequest = {}) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "admin");
    const locks = yield* LockService;
    const tinybase = yield* TinyBaseService;
    const cases = yield* DocumentCaseService;

    const previousLock = yield* locks.get("document", docId);
    if (!previousLock) {
      return {
        success: true,
        doc_id: docId,
        released: false,
        previous_lock: null,
        message: `No active document lock found for document ${docId}`,
      };
    }

    const guardedRunId = request.runId?.trim();
    const force = request.force === true;
    const released = force
      ? yield* locks.forceRelease("document", docId)
      : guardedRunId
        ? yield* locks.release("document", docId, guardedRunId)
        : false;
    if (!released) {
      const message = guardedRunId
        ? `Document lock for ${docId} was not released because the run id did not match`
        : `Document lock for ${docId} requires a matching run id or force=true to release`;
      return {
        success: false,
        doc_id: docId,
        released: false,
        previous_lock: previousLock,
        message,
      };
    }

    const documentCase = yield* cases.getOrCreateCaseForDocument(docId);
    if (documentCase.activeRunId === previousLock.runId) {
      yield* cases.updateCase(documentCase.id, {
        activeRunId: null,
        automationStatus: recoverableStatuses.has(documentCase.automationStatus)
          ? "queued"
          : documentCase.automationStatus,
      });
    }

    yield* tinybase.addProcessingLog({
      docId,
      timestamp: new Date().toISOString(),
      step: "lock",
      eventType: "lock_released",
      data: {
        manual: true,
        force,
        previousRunId: previousLock.runId,
        owner: previousLock.owner,
        expiresAt: previousLock.expiresAt,
      },
    });

    return {
      success: true,
      doc_id: docId,
      released: true,
      previous_lock: previousLock,
      message: `Released document lock for document ${docId}`,
    };
  });

// ===========================================================================
// Processing Status
// ===========================================================================

const getVisibleQueueLength = (fallback: number) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const queueStats = yield* getCachedQueueStats(paperless).pipe(
      Effect.catchAll(() => Effect.succeed(null)),
    );
    return queueStats
      ? (queueStats.todo ?? 0) +
          (queueStats.ocr ?? 0) +
          (queueStats.metadata ?? 0) +
          (queueStats.review ?? 0) +
          (queueStats.index ?? 0)
      : fallback;
  });

export const getProcessingStatus = Effect.gen(function* () {
  const autoProcessing = yield* AutoProcessingService;
  const status = yield* autoProcessing.getStatus();
  const queueLength = yield* getVisibleQueueLength(status.queueLength);
  const currentDocId = status.currentlyProcessingDocId;
  const canViewCurrentDoc =
    currentDocId === null ? true : yield* isDocumentAuthorized(currentDocId, "view");

  return {
    is_processing: status.currentlyProcessingDocId !== null,
    current_doc_id: canViewCurrentDoc ? currentDocId : null,
    current_step: status.currentStep,
    queue_length: queueLength,
    processed_today: status.processedSinceStart,
    errors_today: status.errorsSinceStart,
    auto_processing: status.enabled,
    auto_processing_running: status.running,
    include_untagged: status.includeUntagged,
  };
});

// ===========================================================================
// Processing Logs
// ===========================================================================

export const getProcessingLogs = (docId: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "view");
    const tinybase = yield* TinyBaseService;
    const logs = yield* tinybase.getProcessingLogs(docId);
    return { logs };
  });

export const clearProcessingLogs = (docId: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "admin");
    const tinybase = yield* TinyBaseService;
    yield* tinybase.clearProcessingLogs(docId);
    return { success: true };
  });

// ===========================================================================
// Auto Processing
// ===========================================================================

export const getAutoProcessingStatus = Effect.gen(function* () {
  const autoProcessing = yield* AutoProcessingService;
  const status = yield* autoProcessing.getStatus();
  const queueLength = yield* getVisibleQueueLength(status.queueLength);
  const currentDocId = status.currentlyProcessingDocId;
  const canViewCurrentDoc =
    currentDocId === null ? true : yield* isDocumentAuthorized(currentDocId, "view");
  return {
    running: status.running,
    enabled: status.enabled,
    interval_minutes: status.intervalMinutes,
    include_untagged: status.includeUntagged,
    queue_length: queueLength,
    last_check_at: status.lastCheckAt,
    currently_processing_doc_id: canViewCurrentDoc ? currentDocId : null,
    currently_processing_doc_title: canViewCurrentDoc ? status.currentlyProcessingDocTitle : null,
    current_step: status.currentStep,
    processed_since_start: status.processedSinceStart,
    errors_since_start: status.errorsSinceStart,
  };
});

export const triggerAutoProcessing = Effect.gen(function* () {
  const autoProcessing = yield* AutoProcessingService;
  yield* autoProcessing.trigger();
  const status = yield* autoProcessing.getStatus();
  const currentDocId = status.currentlyProcessingDocId;
  const canViewCurrentDoc =
    currentDocId === null ? true : yield* isDocumentAuthorized(currentDocId, "view");
  return {
    message: "Triggered auto processing check",
    running: status.running,
    enabled: status.enabled,
    currently_processing_doc_id: canViewCurrentDoc ? currentDocId : null,
  };
});
