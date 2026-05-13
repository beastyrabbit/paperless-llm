/**
 * Processing pipeline tests.
 */

import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { OCRAgentService } from "../../src/agents/OCRAgent.js";
import { PiDocumentAgentService } from "../../src/agents/PiDocumentAgent.js";
import {
  ProcessingPipelineService,
  ProcessingPipelineServiceLive,
} from "../../src/agents/ProcessingPipeline.js";
import { ConfigService } from "../../src/config/index.js";
import { QdrantError } from "../../src/errors/index.js";
import { PaperlessService, QdrantService, TinyBaseService } from "../../src/services/index.js";

const createMockConfig = () =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: { url: "http://paperless:8000", token: "token" },
      ollama: { url: "http://ollama:11434", modelLarge: "llama3", modelSmall: "llama3:8b" },
      mistral: { apiKey: "mistral", model: "mistral-ocr-latest" },
      qdrant: { url: "http://qdrant:6333", collectionName: "paperless", embeddingDimension: 768 },
      autoProcessing: {
        enabled: false,
        intervalMinutes: 10,
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
  };
  return {
    layer: Layer.succeed(PaperlessService, mocks as unknown as PaperlessService),
    mocks,
  };
};

const createMockTinyBase = () => {
  const mocks = {
    getAllSettings: vi.fn(() => Effect.succeed({ "vector_search.enabled": "true" })),
    addProcessingLog: vi.fn(() => Effect.succeed(undefined)),
  };
  return {
    layer: Layer.succeed(TinyBaseService, mocks as unknown as TinyBaseService),
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

const createMockDocumentAgent = () =>
  Layer.succeed(PiDocumentAgentService, {
    name: "document_agent",
    processDocument: vi.fn(),
  } as unknown as PiDocumentAgentService);

describe("ProcessingPipelineService", () => {
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

  it("marks the OCR step failed when OCR returns an unsuccessful result", async () => {
    const { layer: paperlessLayer, mocks: paperlessMocks } = createMockPaperless();
    const { layer: tinybaseLayer } = createMockTinyBase();
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
  });
});
