import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessingPipelineService } from "../../src/agents/ProcessingPipeline.js";
import { clearPaperlessStatusCacheForTests } from "../../src/api/paperlessStatusCache.js";
import * as processingHandlers from "../../src/api/processing/handlers.js";
import { NotFoundError } from "../../src/errors/index.js";
import {
  AutoProcessingService,
  type AutoProcessingStatus,
  DocumentAuthorizationService,
  DocumentAuthorizationServiceNoop,
  type DocumentCase,
  DocumentCaseService,
  type DurableLock,
  LockService,
  PaperlessService,
  TinyBaseService,
} from "../../src/services/index.js";

const lock: DurableLock = {
  id: "document:42",
  scope: "document",
  resourceId: "42",
  owner: "pipeline",
  runId: "run-42",
  acquiredAt: "2026-05-15T10:00:00.000Z",
  heartbeatAt: "2026-05-15T10:01:00.000Z",
  expiresAt: "2026-05-15T10:15:00.000Z",
  metadata: { source: "processing_pipeline" },
};

const documentCase: DocumentCase = {
  id: "doc-42",
  docId: 42,
  docTitle: "Document 42",
  phase: "metadata",
  automationStatus: "running",
  activeRunId: "run-42",
  lastRunId: null,
  lastFailure: null,
  questions: [],
  answers: [],
  finalDecisions: {},
  runSummaries: [],
  memory: {},
  transcript: [],
  createdAt: "2026-05-15T10:00:00.000Z",
  updatedAt: "2026-05-15T10:00:00.000Z",
};

const createLayer = (
  overrides: {
    activeLock?: DurableLock | null;
    releaseResult?: boolean;
    forceReleaseResult?: boolean;
  } = {},
) => {
  const get = vi.fn(() => Effect.succeed("activeLock" in overrides ? overrides.activeLock : lock));
  const release = vi.fn(() => Effect.succeed(overrides.releaseResult ?? true));
  const forceRelease = vi.fn(() => Effect.succeed(overrides.forceReleaseResult ?? true));
  const updateCase = vi.fn(() => Effect.succeed({ ...documentCase, activeRunId: null }));
  const addProcessingLog = vi.fn(() => Effect.succeed("log-1"));

  return {
    get,
    release,
    forceRelease,
    updateCase,
    addProcessingLog,
    layer: Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      Layer.succeed(LockService, {
        get,
        release,
        forceRelease,
        list: vi.fn(() => Effect.succeed([])),
        pruneStale: vi.fn(() => Effect.succeed(0)),
      } as unknown as LockService),
      Layer.succeed(DocumentCaseService, {
        getOrCreateCaseForDocument: vi.fn(() => Effect.succeed(documentCase)),
        updateCase,
      } as unknown as DocumentCaseService),
      Layer.succeed(TinyBaseService, {
        addProcessingLog,
      } as unknown as TinyBaseService),
    ),
  };
};

const runRelease = (
  test: ReturnType<typeof createLayer>,
  body?: processingHandlers.LockReleaseRequest,
) =>
  Effect.runPromise(
    processingHandlers.releaseDocumentLock(42, body).pipe(Effect.provide(test.layer)),
  );

const autoStatus: AutoProcessingStatus = {
  running: true,
  enabled: true,
  intervalMinutes: 5,
  includeUntagged: false,
  queueLength: 7,
  lastCheckAt: "2026-05-15T10:00:00.000Z",
  currentlyProcessingDocId: 42,
  currentlyProcessingDocTitle: "Secret Document 42",
  currentStep: "metadata",
  processedSinceStart: 3,
  errorsSinceStart: 1,
};

const createAggregateLayer = (authorizedDocIds: ReadonlySet<number>) => {
  const authorizeDocument = vi.fn((docId: number) =>
    authorizedDocIds.has(docId)
      ? Effect.void
      : Effect.fail(
          new NotFoundError({
            message: `Document ${docId} not found`,
            resource: "document",
            id: docId,
          }),
        ),
  );
  const filterAuthorizedDocuments = vi.fn(
    (items: ReadonlyArray<unknown>, getDocId: (item: unknown) => number | null | undefined) =>
      Effect.succeed(
        items.filter((item) => {
          const docId = getDocId(item);
          return typeof docId === "number" && authorizedDocIds.has(docId);
        }),
      ),
  );
  const trigger = vi.fn(() => Effect.void);
  return {
    authorizeDocument,
    trigger,
    layer: Layer.mergeAll(
      Layer.succeed(DocumentAuthorizationService, {
        authorizeDocument,
        filterAuthorizedDocuments,
      } as unknown as DocumentAuthorizationService),
      Layer.succeed(LockService, {
        list: vi.fn(() =>
          Effect.succeed([
            lock,
            { ...lock, id: "document:43", resourceId: "43", runId: "run-43" },
            {
              ...lock,
              id: "catalog:global",
              scope: "catalog",
              resourceId: "global",
              runId: "run-catalog",
            },
          ]),
        ),
      } as unknown as LockService),
      Layer.succeed(AutoProcessingService, {
        getStatus: vi.fn(() => Effect.succeed(autoStatus)),
        trigger,
      } as unknown as AutoProcessingService),
      Layer.succeed(PaperlessService, {
        getQueueStats: vi.fn(() => Effect.succeed(null)),
      } as unknown as PaperlessService),
    ),
  };
};

const createCancelLayer = (
  result:
    | { status: "cancelling"; docId: number; runId: string }
    | { status: "cancelled_orphaned_run"; docId: number; runId: string; lockReleased: boolean }
    | { status: "no_active_run"; docId: number; lockRunId?: string | null }
    | { status: "run_mismatch"; docId: number; activeRunId: string; requestedRunId: string },
) => {
  const cancelDocumentRun = vi.fn(() => Effect.succeed(result));
  return {
    cancelDocumentRun,
    layer: Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      Layer.succeed(ProcessingPipelineService, {
        cancelDocumentRun,
        getActiveDocumentRun: vi.fn(() => Effect.succeed(null)),
        getCurrentState: vi.fn(),
        processDocument: vi.fn(),
        processDocumentStream: vi.fn(),
        processStep: vi.fn(),
        processStepStream: vi.fn(),
      } as unknown as ProcessingPipelineService),
    ),
  };
};

describe("processing handlers", () => {
  beforeEach(() => {
    clearPaperlessStatusCacheForTests();
  });

  it("does not start processing when document authorization denies access", async () => {
    const processDocument = vi.fn(() => Effect.succeed({ success: true, steps: [] }));
    const TestLayer = Layer.mergeAll(
      Layer.succeed(DocumentAuthorizationService, {
        authorizeDocument: vi.fn(() =>
          Effect.fail(
            new NotFoundError({ message: "Document 42 not found", resource: "document", id: 42 }),
          ),
        ),
        filterAuthorizedDocuments: vi.fn((items) => Effect.succeed([...items])),
      } as unknown as DocumentAuthorizationService),
      Layer.succeed(ProcessingPipelineService, {
        processDocument,
        processStep: vi.fn(),
      } as unknown as ProcessingPipelineService),
    );

    await expect(
      Effect.runPromise(processingHandlers.startProcessing(42).pipe(Effect.provide(TestLayer))),
    ).rejects.toThrow("Document 42 not found");
    expect(processDocument).not.toHaveBeenCalled();
  });

  it("maps active run cancellation responses", async () => {
    const test = createCancelLayer({ status: "cancelling", docId: 42, runId: "run-42" });

    const result = await Effect.runPromise(
      processingHandlers
        .cancelProcessing(42, { runId: "run-42", reason: "user_requested" })
        .pipe(Effect.provide(test.layer)),
    );

    expect(result).toEqual({ status: "cancelling", doc_id: 42, run_id: "run-42" });
    expect(test.cancelDocumentRun).toHaveBeenCalledWith({
      docId: 42,
      runId: "run-42",
      reason: "user_requested",
    });
  });

  it("maps no-active cancellation diagnostics", async () => {
    const test = createCancelLayer({ status: "no_active_run", docId: 42, lockRunId: "lock-run" });

    const result = await Effect.runPromise(
      processingHandlers.cancelProcessing(42).pipe(Effect.provide(test.layer)),
    );

    expect(result).toEqual({ status: "no_active_run", doc_id: 42, lock_run_id: "lock-run" });
  });

  it("maps orphaned run cancellation responses", async () => {
    const test = createCancelLayer({
      status: "cancelled_orphaned_run",
      docId: 42,
      runId: "lock-run",
      lockReleased: true,
    });

    const result = await Effect.runPromise(
      processingHandlers.cancelProcessing(42).pipe(Effect.provide(test.layer)),
    );

    expect(result).toEqual({
      status: "cancelled_orphaned_run",
      doc_id: 42,
      run_id: "lock-run",
      lock_released: true,
    });
  });

  it("maps run mismatch cancellation responses", async () => {
    const test = createCancelLayer({
      status: "run_mismatch",
      docId: 42,
      activeRunId: "new-run",
      requestedRunId: "old-run",
    });

    const result = await Effect.runPromise(
      processingHandlers
        .cancelProcessing(42, { runId: "old-run" })
        .pipe(Effect.provide(test.layer)),
    );

    expect(result).toEqual({
      status: "run_mismatch",
      doc_id: 42,
      active_run_id: "new-run",
      requested_run_id: "old-run",
    });
  });

  it("filters processing locks through document authorization while preserving non-document locks", async () => {
    const test = createAggregateLayer(new Set([42]));

    const result = await Effect.runPromise(
      processingHandlers.listLocks.pipe(Effect.provide(test.layer)),
    );

    expect(result.locks.map((entry) => entry.id)).toEqual(["document:42", "catalog:global"]);
    expect(test.authorizeDocument).toHaveBeenCalledWith(42, "view");
    expect(test.authorizeDocument).toHaveBeenCalledWith(43, "view");
  });

  it("redacts unauthorized current document details from processing aggregate status", async () => {
    const test = createAggregateLayer(new Set());

    const [processingStatus, autoProcessingStatus, triggerResult] = await Effect.runPromise(
      Effect.all([
        processingHandlers.getProcessingStatus,
        processingHandlers.getAutoProcessingStatus,
        processingHandlers.triggerAutoProcessing,
      ]).pipe(Effect.provide(test.layer)),
    );

    expect(processingStatus).toMatchObject({ is_processing: true, current_doc_id: null });
    expect(autoProcessingStatus).toMatchObject({
      currently_processing_doc_id: null,
      currently_processing_doc_title: null,
    });
    expect(triggerResult).toMatchObject({ currently_processing_doc_id: null });
    expect(test.trigger).toHaveBeenCalled();
  });

  it("preserves current document details when aggregate status document is authorized", async () => {
    const test = createAggregateLayer(new Set([42]));

    const autoProcessingStatus = await Effect.runPromise(
      processingHandlers.getAutoProcessingStatus.pipe(Effect.provide(test.layer)),
    );

    expect(autoProcessingStatus).toMatchObject({
      currently_processing_doc_id: 42,
      currently_processing_doc_title: "Secret Document 42",
    });
  });

  it("returns released false when no document lock exists", async () => {
    const test = createLayer({ activeLock: null });

    const result = await runRelease(test, { force: true });

    expect(result).toMatchObject({
      success: true,
      doc_id: 42,
      released: false,
      previous_lock: null,
    });
    expect(test.release).not.toHaveBeenCalled();
    expect(test.forceRelease).not.toHaveBeenCalled();
    expect(test.addProcessingLog).not.toHaveBeenCalled();
  });

  it("does not release when force is omitted and no run id is provided", async () => {
    const test = createLayer();

    const result = await runRelease(test);

    expect(result).toMatchObject({
      success: false,
      doc_id: 42,
      released: false,
      previous_lock: lock,
    });
    expect(result.message).toContain("requires a matching run id or force=true");
    expect(test.release).not.toHaveBeenCalled();
    expect(test.forceRelease).not.toHaveBeenCalled();
    expect(test.updateCase).not.toHaveBeenCalled();
    expect(test.addProcessingLog).not.toHaveBeenCalled();
  });

  it("does not release when force is false and no run id is provided", async () => {
    const test = createLayer();

    const result = await runRelease(test, { force: false });

    expect(result).toMatchObject({
      success: false,
      doc_id: 42,
      released: false,
      previous_lock: lock,
    });
    expect(test.release).not.toHaveBeenCalled();
    expect(test.forceRelease).not.toHaveBeenCalled();
    expect(test.updateCase).not.toHaveBeenCalled();
    expect(test.addProcessingLog).not.toHaveBeenCalled();
  });

  it("does not release when run id is empty", async () => {
    const test = createLayer();

    const result = await runRelease(test, { runId: "   " });

    expect(result).toMatchObject({
      success: false,
      doc_id: 42,
      released: false,
      previous_lock: lock,
    });
    expect(test.release).not.toHaveBeenCalled();
    expect(test.forceRelease).not.toHaveBeenCalled();
    expect(test.updateCase).not.toHaveBeenCalled();
    expect(test.addProcessingLog).not.toHaveBeenCalled();
  });

  it("releases a document lock with a matching non-empty run id and clears matching case run state", async () => {
    const test = createLayer();

    const result = await runRelease(test, { runId: " run-42 " });

    expect(result).toMatchObject({
      success: true,
      doc_id: 42,
      released: true,
      previous_lock: lock,
    });
    expect(test.release).toHaveBeenCalledWith("document", 42, "run-42");
    expect(test.forceRelease).not.toHaveBeenCalled();
    expect(test.updateCase).toHaveBeenCalledWith("doc-42", {
      activeRunId: null,
      automationStatus: "queued",
    });
    expect(test.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "lock",
        eventType: "lock_released",
        data: expect.objectContaining({ manual: true, force: false, previousRunId: "run-42" }),
      }),
    );
  });

  it("does not mutate case or log when guarded release has a run id mismatch", async () => {
    const test = createLayer({ releaseResult: false });

    const result = await runRelease(test, { runId: "other-run" });

    expect(result).toMatchObject({
      success: false,
      doc_id: 42,
      released: false,
      previous_lock: lock,
    });
    expect(test.release).toHaveBeenCalledWith("document", 42, "other-run");
    expect(test.forceRelease).not.toHaveBeenCalled();
    expect(test.updateCase).not.toHaveBeenCalled();
    expect(test.addProcessingLog).not.toHaveBeenCalled();
  });

  it("force releases a document lock only when force is explicitly true", async () => {
    const test = createLayer();

    const result = await runRelease(test, { force: true });

    expect(result).toMatchObject({
      success: true,
      doc_id: 42,
      released: true,
      previous_lock: lock,
    });
    expect(test.release).not.toHaveBeenCalled();
    expect(test.forceRelease).toHaveBeenCalledWith("document", 42);
    expect(test.updateCase).toHaveBeenCalledWith("doc-42", {
      activeRunId: null,
      automationStatus: "queued",
    });
    expect(test.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "lock",
        eventType: "lock_released",
        data: expect.objectContaining({ manual: true, force: true, previousRunId: "run-42" }),
      }),
    );
  });
});
