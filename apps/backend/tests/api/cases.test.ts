/**
 * Document case API handler tests.
 */

import { Effect, Layer } from "effect";
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as caseHandlers from "../../src/api/cases/handlers.js";
import { ConfigService } from "../../src/config/index.js";
import {
  DocumentAuthorizationServiceNoop,
  type DocumentCase,
  DocumentCaseService,
  type DurableLock,
  LockService,
  PaperlessService,
  TinyBaseService,
} from "../../src/services/index.js";
import { ProcessingPipelineService } from "../../src/agents/ProcessingPipeline.js";

const workflowTags = {
  todo: "ai-queued",
  pending: "ai-queued",
  ocr: "ai-processing",
  metadata: "ai-processing",
  index: "ai-processing",
  review: "ai-needs-input",
  manualReview: "ai-needs-input",
  schemaReview: "ai-needs-input",
  done: "ai-done",
  processed: "ai-done",
  failed: "ai-failed",
  ocrDone: "ai-processing",
  summaryDone: "ai-processing",
  titleDone: "ai-processing",
  correspondentDone: "ai-processing",
  documentTypeDone: "ai-processing",
  tagsDone: "ai-processing",
};

const createCaseRecord = (overrides: Partial<DocumentCase> = {}): DocumentCase => ({
  id: "doc-68",
  docId: 68,
  docTitle: "Document 68",
  phase: "metadata",
  automationStatus: "idle",
  activeRunId: null,
  lastRunId: null,
  lastFailure: null,
  questions: [],
  answers: [],
  finalDecisions: {},
  runSummaries: [],
  memory: {},
  transcript: [],
  createdAt: "2026-05-14T10:00:00.000Z",
  updatedAt: "2026-05-14T10:00:00.000Z",
  ...overrides,
});

const createConfigLayer = () =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: { url: "http://localhost:8000", token: "token" },
      ollama: { url: "http://localhost:11434", model: "llama3", embeddingModel: "nomic" },
      mistral: { apiKey: "", model: "" },
      qdrant: {
        url: "http://localhost:6333",
        collectionName: "documents",
        embeddingDimension: 768,
      },
      autoProcessing: {
        enabled: false,
        intervalMinutes: 5,
        includeUntagged: false,
        confirmationEnabled: true,
        confirmationMaxRetries: 3,
      },
      tags: workflowTags,
      pipeline: {
        enableOcr: true,
        enableSummary: false,
        enableTitle: true,
        enableCorrespondent: true,
        enableDocumentType: true,
        enableTags: true,
        enableCustomFields: false,
        enableDocumentLinks: true,
      },
      language: "en",
      debug: false,
    },
    get: vi.fn(),
  } as unknown as ConfigService);

describe("case handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("moves stale ai-processing documents back to queued when no active lock exists", async () => {
    let caseRecord = createCaseRecord();
    const updateDocument = vi.fn((id: number, updates: { tags?: number[] }) =>
      Effect.succeed({
        id,
        title: "Document 68",
        content: "content",
        correspondent: null,
        document_type: null,
        tags: updates.tags ?? [1, 2],
        tag_names: [],
        created: "2026-05-14T10:00:00.000Z",
        modified: "2026-05-14T10:00:00.000Z",
        added: "2026-05-14T10:00:00.000Z",
        archive_serial_number: null,
        original_file_name: "68.pdf",
        archived_file_name: "68.pdf",
      }),
    );
    const updateCase = vi.fn((id: string, updates: Partial<DocumentCase>) => {
      caseRecord = { ...caseRecord, ...updates, id };
      return Effect.succeed(caseRecord);
    });
    const addProcessingLog = vi.fn(() => Effect.succeed(undefined));

    const TestLayer = Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      createConfigLayer(),
      Layer.succeed(LockService, {
        get: vi.fn(() => Effect.succeed(null)),
        pruneStale: vi.fn(() => Effect.succeed(0)),
      } as unknown as LockService),
      Layer.succeed(PaperlessService, {
        getDocument: vi.fn(() =>
          Effect.succeed({
            id: 68,
            title: "Document 68",
            content: "content",
            correspondent: null,
            document_type: null,
            tags: [1, 2],
            tag_names: ["SKYWAY", "ai-processing"],
            created: "2026-05-14T10:00:00.000Z",
            modified: "2026-05-14T10:00:00.000Z",
            added: "2026-05-14T10:00:00.000Z",
            archive_serial_number: null,
            original_file_name: "68.pdf",
            archived_file_name: "68.pdf",
          }),
        ),
        getTags: vi.fn(() =>
          Effect.succeed([
            { id: 1, name: "SKYWAY", slug: "skyway" },
            { id: 2, name: "ai-processing", slug: "ai-processing" },
            { id: 3, name: "ai-queued", slug: "ai-queued" },
          ]),
        ),
        getOrCreateTag: vi.fn(() => Effect.succeed(3)),
        updateDocument,
      } as unknown as PaperlessService),
      Layer.succeed(DocumentCaseService, {
        getOrCreateCaseForDocument: vi.fn(() => Effect.succeed(caseRecord)),
        updateCase,
      } as unknown as DocumentCaseService),
      Layer.succeed(TinyBaseService, {
        addProcessingLog,
      } as unknown as TinyBaseService),
    );

    const result = await Effect.runPromise(
      caseHandlers.getOrCreateDocumentCase(68).pipe(Effect.provide(TestLayer)),
    );

    expect(result.automationStatus).toBe("queued");
    expect(result.activeRunId).toBeNull();
    expect(updateDocument).toHaveBeenCalledWith(68, { tags: [1, 3] });
    expect(updateCase).toHaveBeenCalledWith("doc-68", {
      automationStatus: "queued",
      activeRunId: null,
      phase: "metadata",
    });
    expect(addProcessingLog).toHaveBeenCalledWith(
      expect.objectContaining({
        docId: 68,
        step: "lock",
        eventType: "lock_stale",
        data: expect.objectContaining({
          reason: "active_workflow_tag_without_active_lock",
          retaggedTo: "ai-queued",
        }),
      }),
    );
  });

  it("shows a completed case in the queued filter when Paperless has the queued workflow tag", async () => {
    let caseRecord = createCaseRecord({
      id: "doc-664",
      docId: 664,
      docTitle: "Document 664",
      phase: "done",
      automationStatus: "done",
    });
    const queuedDoc = {
      id: 664,
      title: "Document 664",
      content: "content",
      correspondent: null,
      document_type: null,
      tags: [3],
      tag_names: ["ai-queued"],
      created: "2026-05-14T10:00:00.000Z",
      modified: "2026-05-14T10:00:00.000Z",
      added: "2026-05-14T10:00:00.000Z",
      archive_serial_number: null,
      original_file_name: "664.pdf",
      archived_file_name: "664.pdf",
    };
    const updateCase = vi.fn((id: string, updates: Partial<DocumentCase>) => {
      caseRecord = { ...caseRecord, ...updates, id };
      return Effect.succeed(caseRecord);
    });

    const TestLayer = Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      createConfigLayer(),
      Layer.succeed(LockService, {
        get: vi.fn(() => Effect.succeed(null)),
        pruneStale: vi.fn(() => Effect.succeed(0)),
      } as unknown as LockService),
      Layer.succeed(PaperlessService, {
        getDocumentsByTags: vi.fn((tagNames: string[]) =>
          Effect.succeed(tagNames.includes("ai-queued") ? [queuedDoc] : []),
        ),
        getDocument: vi.fn(() => Effect.succeed(queuedDoc)),
        getTags: vi.fn(() => Effect.succeed([{ id: 3, name: "ai-queued", slug: "ai-queued" }])),
      } as unknown as PaperlessService),
      Layer.succeed(DocumentCaseService, {
        getOrCreateCaseForDocument: vi.fn(() => Effect.succeed(caseRecord)),
        listCases: vi.fn(() => Effect.succeed([caseRecord])),
        updateCase,
      } as unknown as DocumentCaseService),
      Layer.succeed(TinyBaseService, {
        addProcessingLog: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as TinyBaseService),
    );

    const result = await Effect.runPromise(
      caseHandlers.listCases("queued").pipe(Effect.provide(TestLayer)),
    );

    expect(result.cases.map((item) => item.docId)).toEqual([664]);
    expect(result.cases[0]?.automationStatus).toBe("queued");
    expect(result.cases[0]?.phase).toBe("new");
    expect(updateCase).toHaveBeenCalledWith("doc-664", {
      automationStatus: "queued",
      activeRunId: null,
      phase: "new",
    });
  });

  it("keeps active ai-processing documents running when a live lock exists", async () => {
    let caseRecord = createCaseRecord();
    const activeLock: DurableLock = {
      id: "document:68",
      scope: "document",
      resourceId: "68",
      owner: "pipeline",
      runId: "active-run",
      acquiredAt: "2026-05-14T10:00:00.000Z",
      heartbeatAt: "2026-05-14T10:01:00.000Z",
      expiresAt: "2026-05-14T10:16:00.000Z",
      metadata: {},
    };
    const updateDocument = vi.fn(() => Effect.succeed({}));
    const updateCase = vi.fn((id: string, updates: Partial<DocumentCase>) => {
      caseRecord = { ...caseRecord, ...updates, id };
      return Effect.succeed(caseRecord);
    });

    const TestLayer = Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      createConfigLayer(),
      Layer.succeed(LockService, {
        get: vi.fn(() => Effect.succeed(activeLock)),
        pruneStale: vi.fn(() => Effect.succeed(0)),
      } as unknown as LockService),
      Layer.succeed(PaperlessService, {
        getDocument: vi.fn(() =>
          Effect.succeed({
            id: 68,
            title: "Document 68",
            content: "content",
            correspondent: null,
            document_type: null,
            tags: [2],
            tag_names: ["ai-processing"],
            created: "2026-05-14T10:00:00.000Z",
            modified: "2026-05-14T10:00:00.000Z",
            added: "2026-05-14T10:00:00.000Z",
            archive_serial_number: null,
            original_file_name: "68.pdf",
            archived_file_name: "68.pdf",
          }),
        ),
        getTags: vi.fn(() =>
          Effect.succeed([{ id: 2, name: "ai-processing", slug: "ai-processing" }]),
        ),
        getOrCreateTag: vi.fn(() => Effect.succeed(3)),
        updateDocument,
      } as unknown as PaperlessService),
      Layer.succeed(DocumentCaseService, {
        getOrCreateCaseForDocument: vi.fn(() => Effect.succeed(caseRecord)),
        updateCase,
      } as unknown as DocumentCaseService),
      Layer.succeed(TinyBaseService, {
        addProcessingLog: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as TinyBaseService),
    );

    const result = await Effect.runPromise(
      caseHandlers.getOrCreateDocumentCase(68).pipe(Effect.provide(TestLayer)),
    );

    expect(result.automationStatus).toBe("running");
    expect(result.activeRunId).toBe("active-run");
    expect(updateDocument).not.toHaveBeenCalled();
    expect(updateCase).toHaveBeenCalledWith("doc-68", {
      automationStatus: "running",
      activeRunId: "active-run",
    });
  });

  it("passes rerun requests through to the processing pipeline", async () => {
    const caseRecord = createCaseRecord({
      id: "doc-68",
      docId: 68,
      phase: "done",
      automationStatus: "done",
    });
    const processDocument = vi.fn(() =>
      Effect.succeed({ docId: 68, success: true, needsReview: false, steps: {} }),
    );

    const TestLayer = Layer.mergeAll(
      DocumentAuthorizationServiceNoop,
      createConfigLayer(),
      Layer.succeed(DocumentCaseService, {
        getCase: vi.fn(() => Effect.succeed(caseRecord)),
        getOrCreateCaseForDocument: vi.fn(() => Effect.succeed(caseRecord)),
      } as unknown as DocumentCaseService),
      Layer.succeed(LockService, {
        get: vi.fn(() => Effect.succeed(null)),
      } as unknown as LockService),
      Layer.succeed(PaperlessService, {
        getDocument: vi.fn(() =>
          Effect.succeed({
            id: 68,
            title: "Document 68",
            content: "content",
            correspondent: null,
            document_type: null,
            tags: [],
            tag_names: [],
            created: "2026-05-14T10:00:00.000Z",
            modified: "2026-05-14T10:00:00.000Z",
            added: "2026-05-14T10:00:00.000Z",
            archive_serial_number: null,
            original_file_name: "68.pdf",
            archived_file_name: "68.pdf",
          }),
        ),
        getTags: vi.fn(() => Effect.succeed([])),
      } as unknown as PaperlessService),
      Layer.succeed(TinyBaseService, {
        addProcessingLog: vi.fn(() => Effect.succeed(undefined)),
      } as unknown as TinyBaseService),
      Layer.succeed(ProcessingPipelineService, {
        processDocument,
      } as unknown as ProcessingPipelineService),
    );

    const result = await Effect.runPromise(
      caseHandlers.runCase(68, { rerun: true }).pipe(Effect.provide(TestLayer)),
    );

    expect(result.case).toEqual(caseRecord);
    expect(processDocument).toHaveBeenCalledWith({
      docId: 68,
      resume: false,
      rerun: true,
      dryRun: false,
    });
  });
});
