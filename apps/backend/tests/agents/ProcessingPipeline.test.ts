/**
 * Processing pipeline tests.
 */

import { Effect, Fiber, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { OCRAgentService } from "../../src/agents/OCRAgent.js";
import { PiDocumentAgentService } from "../../src/agents/PiDocumentAgent.js";
import { normalizeStep } from "../../src/agents/processingPipeline/parse.js";
import {
  ProcessingPipelineService,
  ProcessingPipelineServiceLive,
} from "../../src/agents/ProcessingPipeline.js";
import { ConfigService } from "../../src/config/index.js";
import { QdrantError } from "../../src/errors/index.js";
import {
  DocumentCaseService,
  LockService,
  PaperlessService,
  QdrantService,
  TinyBaseService,
} from "../../src/services/index.js";

const createMockConfig = () =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: { url: "http://paperless:8000", token: "token" },
      ollama: { url: "http://ollama:11434", model: "llama3", embeddingModel: "nomic-embed-text" },
      mistral: { apiKey: "mistral", model: "mistral-ocr-latest" },
      qdrant: { url: "http://qdrant:6333", collectionName: "paperless", embeddingDimension: 768 },
      autoProcessing: {
        enabled: false,
        intervalMinutes: 10,
        includeUntagged: false,
        confirmationEnabled: true,
        confirmationMaxRetries: 3,
      },
      tags: {
        todo: "llm-todo",
        ocr: "llm-ocr",
        metadata: "llm-metadata",
        review: "llm-review",
        index: "llm-index",
        done: "llm-done",
        failed: "llm-failed",
        pending: "llm-pending",
        ocrDone: "llm-ocr-done",
        summaryDone: "llm-summary-done",
        schemaReview: "llm-schema-review",
        titleDone: "llm-title-done",
        correspondentDone: "llm-correspondent-done",
        documentTypeDone: "llm-document-type-done",
        tagsDone: "llm-tags-done",
        processed: "llm-processed",
        manualReview: "llm-manual-review",
      },
      pipeline: {
        enableOcr: true,
        enableSummary: true,
        enableTitle: true,
        enableCorrespondent: true,
        enableDocumentType: true,
        enableTags: true,
        enableCustomFields: true,
        enableDocumentLinks: true,
      },
      language: "en",
      debug: false,
    },
  } as unknown as ConfigService);

const createMockPaperless = () => {
  const mocks = {
    transitionDocumentTag: vi.fn(() => Effect.succeed(undefined)),
    updateDocument: vi.fn(() => Effect.succeed(undefined)),
    getOrCreateTag: vi.fn((name: string) =>
      Effect.succeed(
        name === "llm-index"
          ? 1
          : name === "llm-failed"
            ? 4
            : name === "llm-ocr"
              ? 5
              : name === "llm-metadata"
                ? 6
                : 99,
      ),
    ),
    getDocument: vi.fn(() =>
      Effect.succeed({
        id: 42,
        title: "Index me",
        content: "Document content for indexing",
        correspondent: 7,
        document_type: 8,
        tags: [1, 2, 3],
        tag_names: ["llm-index", "finance"],
        created: "2026-05-13T10:00:00Z",
        modified: "2026-05-13T10:00:00Z",
        added: "2026-05-13T10:00:00Z",
        archive_serial_number: null,
        original_file_name: "index.pdf",
        archived_file_name: "index.pdf",
      }),
    ),
    getTags: vi.fn(() =>
      Effect.succeed([
        { id: 1, name: "llm-index", slug: "llm-index" },
        { id: 2, name: "finance", slug: "finance" },
        { id: 3, name: "llm-done", slug: "llm-done" },
        { id: 4, name: "llm-failed", slug: "llm-failed" },
        { id: 5, name: "llm-ocr", slug: "llm-ocr" },
        { id: 6, name: "llm-metadata", slug: "llm-metadata" },
      ]),
    ),
    getCorrespondents: vi.fn(() => Effect.succeed([{ id: 7, name: "Acme", slug: "acme" }])),
    getDocumentTypes: vi.fn(() => Effect.succeed([{ id: 8, name: "Invoice", slug: "invoice" }])),
    getCustomFields: vi.fn(() => Effect.succeed([])),
  };
  return {
    layer: Layer.succeed(PaperlessService, mocks as unknown as PaperlessService),
    mocks,
  };
};

const createMockTinyBase = (caseRow: Record<string, unknown> | null = null) => {
  const mocks = {
    store: {
      getRow: vi.fn((tableId: string, rowId: string) =>
        tableId === "documentCases" && rowId === "doc-42" && caseRow ? caseRow : {},
      ),
    },
    getAllSettings: vi.fn(() => Effect.succeed({ "vector_search.enabled": "true" })),
    addProcessingLog: vi.fn(() => Effect.succeed(undefined)),
  };
  return {
    layer: Layer.succeed(TinyBaseService, mocks as unknown as TinyBaseService),
    mocks,
  };
};

const createMockLockService = () => {
  const mocks = {
    acquire: vi.fn(() =>
      Effect.succeed({
        acquired: true,
        staleRecovered: false,
        lock: {
          id: "document:42",
          scope: "document" as const,
          resourceId: 42,
          owner: "test",
          runId: "run-test",
          acquiredAt: "2026-05-13T10:00:00Z",
          heartbeatAt: "2026-05-13T10:00:00Z",
          expiresAt: "2026-05-13T10:15:00Z",
          metadata: {},
        },
      }),
    ),
    release: vi.fn(() => Effect.succeed(true)),
    get: vi.fn(() => Effect.succeed(null)),
    heartbeat: vi.fn(() =>
      Effect.succeed({
        id: "document:42",
        scope: "document" as const,
        resourceId: "42",
        owner: "test",
        runId: "run-test",
        acquiredAt: "2026-05-13T10:00:00Z",
        heartbeatAt: "2026-05-13T10:05:00Z",
        expiresAt: "2026-05-13T10:20:00Z",
        metadata: {},
      }),
    ),
    list: vi.fn(() => Effect.succeed([])),
    pruneStale: vi.fn(() => Effect.succeed(0)),
  };
  return {
    layer: Layer.succeed(LockService, mocks as unknown as LockService),
    mocks,
  };
};

const createMockDocumentCaseService = (initialCase: Record<string, unknown> = {}) => {
  let caseRecord = {
    id: "case-42",
    docId: 42,
    docTitle: "Index me",
    phase: "new",
    automationStatus: "idle",
    activeRunId: null,
    lastRunId: null,
    lastFailure: null,
    transcript: [],
    finalDecisions: {},
    memory: {},
    runSummaries: [],
    questions: [],
    answers: [],
    createdAt: "2026-05-13T10:00:00Z",
    updatedAt: "2026-05-13T10:00:00Z",
    ...initialCase,
  };
  const mocks = {
    listCases: vi.fn(() => Effect.succeed([])),
    getCase: vi.fn(() => Effect.succeed(caseRecord)),
    getOrCreateCaseForDocument: vi.fn(() => Effect.succeed(caseRecord)),
    updateCase: vi.fn((_caseId: string, updates: Record<string, unknown>) => {
      caseRecord = { ...caseRecord, ...updates };
      return Effect.succeed(caseRecord);
    }),
    addQuestion: vi.fn(),
    answerQuestion: vi.fn(),
    appendTranscript: vi.fn(() => Effect.succeed(caseRecord)),
    appendRunSummary: vi.fn(() => Effect.succeed(caseRecord)),
  };
  return {
    layer: Layer.succeed(DocumentCaseService, mocks as unknown as DocumentCaseService),
    mocks,
  };
};

const createMockQdrant = () => {
  const mocks = {
    upsertDocument: vi.fn(() => Effect.fail(new QdrantError({ message: "Qdrant upsert failed" }))),
  };
  return {
    layer: Layer.succeed(QdrantService, mocks as unknown as QdrantService),
    mocks,
  };
};

const createMockOcrAgent = (process = vi.fn()) => {
  const mocks = {
    name: "ocr",
    process,
    processStream: vi.fn(),
  };
  return {
    layer: Layer.succeed(OCRAgentService, mocks as unknown as OCRAgentService),
    mocks,
  };
};

const createMockDocumentAgent = (processDocument = vi.fn()) =>
  Layer.succeed(PiDocumentAgentService, {
    name: "document_agent",
    processDocument,
  } as unknown as PiDocumentAgentService);

describe("ProcessingPipelineService", () => {
  it("uses the case phase as the authoritative workflow state when present", async () => {
    const { layer: paperlessLayer } = createMockPaperless();
    const { layer: tinybaseLayer } = createMockTinyBase({
      phase: "index",
      automationStatus: "running",
    });
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      tinybaseLayer,
      createMockQdrant().layer,
      createMockOcrAgent().layer,
      createMockDocumentAgent(),
      createMockLockService().layer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const state = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return pipeline.getCurrentState({
          id: 42,
          title: "Diverged document",
          content: "",
          tags: [5],
          tag_names: ["llm-ocr"],
          created: "2026-05-13T10:00:00Z",
          modified: "2026-05-13T10:00:00Z",
          added: "2026-05-13T10:00:00Z",
          archive_serial_number: null,
          original_file_name: "doc.pdf",
          archived_file_name: "doc.pdf",
        });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(state).toBe("index");
  });

  it("continues from answered human decisions after a metadata timeout without another agent call", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    paperlessMocks.getDocument.mockReturnValue(
      Effect.succeed({
        id: 42,
        title: "PayPal invoice",
        content: [
          "# PayPal",
          "",
          "Order Date",
          "2025-11-28 | Seller",
          "ZFI TECH Inc. | Order ID",
        ].join("\n"),
        correspondent: 134,
        document_type: 73,
        tags: [1, 2],
        tag_names: ["llm-index", "finance"],
        custom_fields: [],
        created: "2026-05-13T10:00:00Z",
        modified: "2026-05-13T10:00:00Z",
        added: "2026-05-13T10:00:00Z",
        archive_serial_number: null,
        original_file_name: "paypal.pdf",
        archived_file_name: "paypal.pdf",
      }),
    );
    paperlessMocks.getCustomFields.mockReturnValue(
      Effect.succeed([{ id: 36, name: "Echter Korrespondent", data_type: "string" }]),
    );
    const { layer: tinybaseLayer, mocks: tinybaseMocks } = createMockTinyBase({
      phase: "metadata",
      automationStatus: "running",
    });
    const { layer: qdrantLayer, mocks: qdrantMocks } = createMockQdrant();
    qdrantMocks.upsertDocument.mockReturnValue(Effect.succeed(undefined));
    const documentAgentProcess = vi.fn(() =>
      Effect.succeed({
        success: true,
        docId: 42,
        sessionId: "unused",
        needsReview: false,
        paused: false,
        applied: {},
      }),
    );
    const { layer: casesLayer, mocks: caseMocks } = createMockDocumentCaseService({
      phase: "metadata",
      automationStatus: "failed",
      lastFailure: null,
      memory: {
        sessionId: "doc-42-session",
        lastFailure: {
          message: "Pi document agent timed out after 120000ms",
          kind: "timeout",
          step: "pipeline",
          retryable: true,
          runId: "run-timeout",
          failedAt: "2026-05-13T10:00:00Z",
        },
        humanDecisions: [{ id: "decision-1" }],
      },
      questions: [
        {
          id: "question-1",
          caseId: "case-42",
          docId: 42,
          kind: "metadata_proposal",
          entityKind: "correspondent",
          candidate: { id: 134, name: "PayPal", exists: true },
          alternatives: [],
          requestedAction: "map",
          evidence: null,
          status: "answered",
          source: "document_agent",
          metadata: {},
          createdAt: "2026-05-13T10:00:00Z",
          answeredAt: "2026-05-13T10:01:00Z",
        },
      ],
      answers: [
        {
          id: "answer-1",
          caseId: "case-42",
          questionId: "question-1",
          docId: 42,
          answer: "apply",
          guidance: null,
          selectedCandidate: { id: 134, name: "PayPal", exists: true },
          metadataPatch: null,
          createdAt: "2026-05-13T10:01:00Z",
        },
      ],
    });
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      tinybaseLayer,
      qdrantLayer,
      createMockOcrAgent().layer,
      createMockDocumentAgent(documentAgentProcess),
      createMockLockService().layer,
      casesLayer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processDocument({ docId: 42, resume: true });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.success).toBe(true);
    expect(documentAgentProcess).not.toHaveBeenCalled();
    expect(qdrantMocks.upsertDocument).toHaveBeenCalled();
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, {
      custom_fields: [{ field: 36, value: "ZFI TECH Inc." }],
    });
    expect(caseMocks.updateCase).toHaveBeenCalledWith(
      "case-42",
      expect.objectContaining({
        finalDecisions: expect.objectContaining({
          correspondent: 134,
          custom_fields: { "36": "ZFI TECH Inc." },
        }),
      }),
    );
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "document_agent",
        eventType: "result",
        data: expect.objectContaining({ resumedFromAnsweredHumanDecisions: true }),
      }),
    );
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        step: "custom_fields",
        eventType: "result",
        data: expect.objectContaining({
          fieldName: "Echter Korrespondent",
          value: "ZFI TECH Inc.",
        }),
      }),
    );
  });

  it("marks the index step failed when Qdrant upsert fails", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    const { layer: tinybaseLayer, mocks: tinybaseMocks } = createMockTinyBase();
    const { layer: qdrantLayer, mocks: qdrantMocks } = createMockQdrant();
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      tinybaseLayer,
      qdrantLayer,
      createMockOcrAgent().layer,
      createMockDocumentAgent(),
      createMockLockService().layer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processStep(42, "index");
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.success).toBe(false);
    expect(result.step).toBe("index");
    expect(result.error).toContain("Qdrant upsert failed");
    expect(qdrantMocks.upsertDocument).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        title: "Index me",
        tags: ["finance"],
        correspondent: "Acme",
        documentType: "Invoice",
      }),
    );
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [1, 2] });
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [2, 4] });
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "qdrant_index",
        eventType: "error",
        data: expect.objectContaining({ indexed: false }),
      }),
    );
  });

  it.each([
    { input: { docId: 42, resume: false, rerun: true }, label: "explicit rerun" },
    { input: { docId: 42, resume: false }, label: "fresh run request" },
  ])("reruns a completed document on $label", async ({ input }) => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    paperlessMocks.getDocument.mockReturnValue(
      Effect.succeed({
        id: 42,
        title: "Completed document",
        content: "Document content for rerun",
        correspondent: 7,
        document_type: 8,
        tags: [3],
        tag_names: ["llm-done"],
        created: "2026-05-13T10:00:00Z",
        modified: "2026-05-13T10:00:00Z",
        added: "2026-05-13T10:00:00Z",
        archive_serial_number: null,
        original_file_name: "done.pdf",
        archived_file_name: "done.pdf",
      }),
    );
    const ocrProcess = vi.fn(() =>
      Effect.succeed({ success: true, docId: 42, textLength: 100, pages: 1 }),
    );
    const documentAgentProcess = vi.fn(() =>
      Effect.succeed({ success: true, applied: {}, needsReview: false }),
    );
    const { layer: qdrantLayer, mocks: qdrantMocks } = createMockQdrant();
    qdrantMocks.upsertDocument.mockReturnValue(Effect.succeed(undefined));
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      createMockTinyBase().layer,
      qdrantLayer,
      createMockOcrAgent(ocrProcess).layer,
      createMockDocumentAgent(documentAgentProcess),
      createMockLockService().layer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processDocument(input);
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.success).toBe(true);
    expect(result.steps["ocr"]?.success).toBe(true);
    expect(result.steps["metadata"]?.success).toBe(true);
    expect(result.steps["index"]?.success).toBe(true);
    expect(ocrProcess).toHaveBeenCalled();
    expect(documentAgentProcess).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        resume: false,
        freshRun: true,
      }),
    );
    expect(qdrantMocks.upsertDocument).toHaveBeenCalled();
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [99] });
  });

  it("preserves unrelated llm-prefixed tags during workflow transitions", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    paperlessMocks.getDocument.mockReturnValue(
      Effect.succeed({
        id: 42,
        title: "OCR me",
        content: "",
        correspondent: null,
        document_type: null,
        tags: [1, 2, 7],
        tag_names: ["llm-index", "finance", "llm-custom"],
        created: "2026-05-13T10:00:00Z",
        modified: "2026-05-13T10:00:00Z",
        added: "2026-05-13T10:00:00Z",
        archive_serial_number: null,
        original_file_name: "ocr.pdf",
        archived_file_name: "ocr.pdf",
      }),
    );
    paperlessMocks.getTags.mockReturnValue(
      Effect.succeed([
        { id: 1, name: "llm-index", slug: "llm-index" },
        { id: 2, name: "finance", slug: "finance" },
        { id: 4, name: "llm-failed", slug: "llm-failed" },
        { id: 5, name: "llm-ocr", slug: "llm-ocr" },
        { id: 7, name: "llm-custom", slug: "llm-custom" },
      ]),
    );
    const { layer: ocrLayer } = createMockOcrAgent(
      vi.fn(() =>
        Effect.succeed({
          success: false,
          docId: 42,
          textLength: 0,
          pages: 0,
          error: "OCR failed",
        }),
      ),
    );
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      createMockTinyBase().layer,
      createMockQdrant().layer,
      ocrLayer,
      createMockDocumentAgent(),
      createMockLockService().layer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processStep(42, "ocr");
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [2, 7, 5] });
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [2, 7, 4] });
  });

  it("marks the OCR step failed when OCR returns an unsuccessful result", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    const { layer: tinybaseLayer, mocks: tinybaseMocks } = createMockTinyBase();
    const { layer: qdrantLayer } = createMockQdrant();
    const { layer: ocrLayer, mocks: ocrMocks } = createMockOcrAgent(
      vi.fn(() =>
        Effect.succeed({
          success: false,
          docId: 42,
          textLength: 0,
          pages: 0,
          error: "OCR failed",
        }),
      ),
    );
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      tinybaseLayer,
      qdrantLayer,
      ocrLayer,
      createMockDocumentAgent(),
      createMockLockService().layer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processStep(42, "ocr");
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.success).toBe(false);
    expect(result.step).toBe("ocr");
    expect(result.data).toMatchObject({ success: false, error: "OCR failed" });
    expect(ocrMocks.process).toHaveBeenCalledWith({ docId: 42 });
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [2, 5] });
    expect(paperlessMocks.updateDocument).toHaveBeenCalledWith(42, { tags: [2, 4] });
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "ocr",
        eventType: "stage_failed",
        data: expect.objectContaining({
          message: "OCR failed",
          kind: "unknown",
          retryable: false,
        }),
      }),
    );
  });

  it("records timeout failures on the case and in processing logs", async () => {
    const { layer: paperlessLayer } = createMockPaperless();
    const { layer: tinybaseLayer, mocks: tinybaseMocks } = createMockTinyBase();
    const { layer: qdrantLayer } = createMockQdrant();
    const { layer: ocrLayer } = createMockOcrAgent(
      vi.fn(() =>
        Effect.succeed({
          success: false,
          docId: 42,
          textLength: 0,
          pages: 0,
          error: "Request to http://mistral.test/v1/ocr timed out after 1000ms",
        }),
      ),
    );
    const { layer: casesLayer, mocks: caseMocks } = createMockDocumentCaseService();
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      tinybaseLayer,
      qdrantLayer,
      ocrLayer,
      createMockDocumentAgent(),
      createMockLockService().layer,
      casesLayer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processStep(42, "ocr");
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.success).toBe(false);
    expect(caseMocks.updateCase).toHaveBeenCalledWith(
      "case-42",
      expect.objectContaining({
        phase: "failed",
        automationStatus: "failed",
        lastFailure: expect.objectContaining({
          step: "ocr",
          kind: "timeout",
          retryable: true,
          message: expect.stringContaining("timed out"),
        }),
      }),
    );
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "ocr",
        eventType: "stage_failed",
        data: expect.objectContaining({
          kind: "timeout",
          retryable: true,
          message: expect.stringContaining("timed out"),
        }),
      }),
    );
  });

  it("cancels an active document run and cleans up lock, state, and logs", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    paperlessMocks.getDocument.mockReturnValue(
      Effect.succeed({
        id: 42,
        title: "Slow OCR",
        content: "",
        correspondent: null,
        document_type: null,
        tags: [99],
        tag_names: ["llm-todo"],
        created: "2026-05-13T10:00:00Z",
        modified: "2026-05-13T10:00:00Z",
        added: "2026-05-13T10:00:00Z",
        archive_serial_number: null,
        original_file_name: "slow.pdf",
        archived_file_name: "slow.pdf",
      }),
    );
    const { layer: tinybaseLayer, mocks: tinybaseMocks } = createMockTinyBase();
    const { layer: qdrantLayer } = createMockQdrant();
    let ocrInterrupted = false;
    const { layer: ocrLayer } = createMockOcrAgent(
      vi.fn(() =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              ocrInterrupted = true;
            }),
          ),
        ),
      ),
    );
    const { layer: lockLayer, mocks: lockMocks } = createMockLockService();
    const { layer: casesLayer, mocks: caseMocks } = createMockDocumentCaseService();
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      tinybaseLayer,
      qdrantLayer,
      ocrLayer,
      createMockDocumentAgent(),
      lockLayer,
      casesLayer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        const runFiber = yield* Effect.fork(pipeline.processStep(42, "ocr"));
        let active = yield* pipeline.getActiveDocumentRun(42);
        for (let attempt = 0; attempt < 20 && !active; attempt++) {
          yield* Effect.sleep("10 millis");
          active = yield* pipeline.getActiveDocumentRun(42);
        }
        const cancelResult = yield* pipeline.cancelDocumentRun({
          docId: 42,
          runId: active?.runId,
          reason: "test_cancel",
        });
        const exit = yield* Fiber.await(runFiber);
        const after = yield* pipeline.getActiveDocumentRun(42);
        return { active, cancelResult, exit, after };
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.active).toMatchObject({ docId: 42, runId: "run-test", step: "ocr" });
    expect(result.cancelResult).toEqual({ status: "cancelling", docId: 42, runId: "run-test" });
    expect(result.exit._tag).toBe("Failure");
    expect(result.after).toBeNull();
    expect(ocrInterrupted).toBe(true);
    expect(lockMocks.release).toHaveBeenCalledWith("document", 42, "run-test");
    expect(caseMocks.updateCase).toHaveBeenCalledWith(
      "case-42",
      expect.objectContaining({ activeRunId: null, lastRunId: "run-test" }),
    );
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "pipeline",
        eventType: "run_cancelled",
        data: expect.objectContaining({ runId: "run-test", reason: "test_cancel" }),
      }),
    );
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "lock",
        eventType: "lock_released",
        data: expect.objectContaining({ runId: "run-test" }),
      }),
    );
  });

  it("does not cancel a newer active run when the requested run id does not match", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    paperlessMocks.getDocument.mockReturnValue(
      Effect.succeed({
        id: 42,
        title: "Slow OCR",
        content: "",
        correspondent: null,
        document_type: null,
        tags: [99],
        tag_names: ["llm-todo"],
        created: "2026-05-13T10:00:00Z",
        modified: "2026-05-13T10:00:00Z",
        added: "2026-05-13T10:00:00Z",
        archive_serial_number: null,
        original_file_name: "slow.pdf",
        archived_file_name: "slow.pdf",
      }),
    );
    let ocrInterrupted = false;
    const { layer: ocrLayer } = createMockOcrAgent(
      vi.fn(() =>
        Effect.never.pipe(
          Effect.ensuring(
            Effect.sync(() => {
              ocrInterrupted = true;
            }),
          ),
        ),
      ),
    );
    const { layer: lockLayer } = createMockLockService();
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      paperlessLayer,
      createMockTinyBase().layer,
      createMockQdrant().layer,
      ocrLayer,
      createMockDocumentAgent(),
      lockLayer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        const runFiber = yield* Effect.fork(pipeline.processStep(42, "ocr"));
        let active = yield* pipeline.getActiveDocumentRun(42);
        for (let attempt = 0; attempt < 20 && !active; attempt++) {
          yield* Effect.sleep("10 millis");
          active = yield* pipeline.getActiveDocumentRun(42);
        }
        const mismatch = yield* pipeline.cancelDocumentRun({ docId: 42, runId: "old-run" });
        const afterMismatch = yield* pipeline.getActiveDocumentRun(42);
        yield* pipeline.cancelDocumentRun({ docId: 42, runId: active?.runId });
        yield* Fiber.await(runFiber);
        return { mismatch, afterMismatch };
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.mismatch).toEqual({
      status: "run_mismatch",
      docId: 42,
      activeRunId: "run-test",
      requestedRunId: "old-run",
    });
    expect(result.afterMismatch).toMatchObject({ runId: "run-test" });
    expect(ocrInterrupted).toBe(true);
  });

  it("cancels an orphaned durable lock when no in-memory run exists", async () => {
    const lock = {
      id: "document:42",
      scope: "document" as const,
      resourceId: "42",
      owner: "pipeline",
      runId: "stale-run",
      acquiredAt: "2026-05-13T10:00:00Z",
      heartbeatAt: "2026-05-13T10:00:00Z",
      expiresAt: "2026-05-13T10:15:00Z",
      metadata: {},
    };
    const { layer: lockLayer, mocks: lockMocks } = createMockLockService();
    lockMocks.get.mockReturnValue(Effect.succeed(lock));
    const { layer: casesLayer, mocks: caseMocks } = createMockDocumentCaseService({
      activeRunId: "stale-run",
      automationStatus: "running",
    });
    const { layer: tinybaseLayer, mocks: tinybaseMocks } = createMockTinyBase();
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      createMockPaperless().layer,
      tinybaseLayer,
      createMockQdrant().layer,
      createMockOcrAgent().layer,
      createMockDocumentAgent(),
      lockLayer,
      casesLayer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.cancelDocumentRun({ docId: 42, runId: "stale-run" });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result).toEqual({
      status: "cancelled_orphaned_run",
      docId: 42,
      runId: "stale-run",
      lockReleased: true,
    });
    expect(lockMocks.release).toHaveBeenCalledWith("document", 42, "stale-run");
    expect(caseMocks.updateCase).toHaveBeenCalledWith(
      "case-42",
      expect.objectContaining({ activeRunId: null, lastRunId: "stale-run" }),
    );
    expect(tinybaseMocks.addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 42,
        step: "pipeline",
        eventType: "run_cancelled",
        data: expect.objectContaining({ runId: "stale-run", orphaned: true }),
      }),
    );
  });

  it("preserves legacy processing step normalization aliases", () => {
    expect(normalizeStep("ocr")).toBe("ocr");
    expect(normalizeStep("index")).toBe("index");
    expect(normalizeStep("finalizing")).toBe("index");
    expect(normalizeStep("complete")).toBe("index");
    expect(normalizeStep("bogus")).toBe("metadata");
  });

  it("treats unknown processing steps as metadata for processStep compatibility", async () => {
    const processDocument = vi.fn(() =>
      Effect.succeed({ success: true, applied: {}, needsReview: false }),
    );
    const dependencies = Layer.mergeAll(
      createMockConfig(),
      createMockPaperless().layer,
      createMockTinyBase().layer,
      createMockQdrant().layer,
      createMockOcrAgent().layer,
      createMockDocumentAgent(processDocument),
      createMockLockService().layer,
      createMockDocumentCaseService().layer,
    );
    const TestLayer = Layer.provideMerge(ProcessingPipelineServiceLive, dependencies);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const pipeline = yield* ProcessingPipelineService;
        return yield* pipeline.processStep(42, "bogus");
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.step).toBe("bogus");
    expect(result.success).toBe(true);
    expect(processDocument).toHaveBeenCalledWith(expect.objectContaining({ docId: 42 }));
  });
});
