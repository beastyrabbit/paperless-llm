import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { OCRAgentService, OCRAgentServiceLive } from "../../src/agents/OCRAgent.js";
import { ConfigService } from "../../src/config/index.js";
import {
  ConcurrencyLimitServiceLive,
  OcrUsageService,
  PaperlessService,
  TinyBaseService,
} from "../../src/services/index.js";

const sha256Bytes = (bytes: Uint8Array): string =>
  createHash("sha256").update(Buffer.from(bytes)).digest("hex");

const createConfigLayer = () =>
  Layer.succeed(ConfigService, {
    config: {
      mistral: {
        apiKey: "mistral-key",
        model: "mistral-ocr-latest",
        apiBaseUrl: "https://mistral.test",
      },
      tags: {
        pending: "llm-pending",
        ocrDone: "llm-ocr-done",
      },
      http: {
        requestTimeoutMs: 1000,
        mistralRetryAttempts: 1,
        mistralRetryBaseDelayMs: 1,
      },
      concurrency: {
        ollamaMaxConcurrent: 1,
        mistralMaxConcurrent: 1,
        ocrMaxConcurrent: 1,
      },
    },
  } as unknown as ConfigService);

describe("OCRAgentService", () => {
  it("runs Mistral for PDFs that only have generic Paperless content", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const mistralText = "Fresh Mistral OCR text from the PDF.";
    vi.mocked(fetch).mockResolvedValue(
      Response.json({ pages: [{ index: 0, markdown: mistralText }] }),
    );
    const reservation = {
      id: "reservation-1",
      runId: "ocr-agent-42",
      docId: 42,
      source: "ocr_agent" as const,
      estimatedPages: 1,
      estimatedTokens: 100,
      date: "2026-05-16",
    };
    const paperlessMocks = {
      getDocument: vi.fn(() =>
        Effect.succeed({
          id: 42,
          title: "Scanned",
          content: "Existing Paperless OCR text that should not be trusted as Mistral output.",
          tags: [],
          tag_names: [],
          mime_type: "application/pdf",
          original_file_name: "scan.pdf",
          archived_file_name: "scan.pdf",
        }),
      ),
      downloadPdf: vi.fn(() => Effect.succeed(pdfBytes)),
      getDocumentVersions: vi.fn(() => Effect.succeed([])),
      uploadOcrPdfVersion: vi.fn(() => Effect.succeed({ id: 77 })),
      pollVersionCreation: vi.fn(() => Effect.succeed(null)),
      patchVersionContent: vi.fn(() => Effect.succeed(undefined)),
      transitionDocumentTag: vi.fn(() => Effect.succeed(undefined)),
    };
    const tinybaseMocks = {
      getAllSettings: vi.fn(() => Effect.succeed({})),
      getDocumentMemory: vi.fn(() => Effect.succeed(null)),
      getDocumentOcrContent: vi.fn(() => Effect.succeed(null)),
      setDocumentOcrContent: vi.fn(() => Effect.succeed(undefined)),
      patchDocumentMemory: vi.fn(() => Effect.succeed({})),
      appendRunSummary: vi.fn(() => Effect.succeed(undefined)),
      addProcessingLog: vi.fn(() => Effect.succeed("log-1")),
    };
    const ocrUsageMocks = {
      estimatePdfPages: vi.fn(() => 1),
      estimateOcrTokens: vi.fn(() => 100),
      reserve: vi.fn(() => Effect.succeed(reservation)),
      commit: vi.fn(() => Effect.succeed(undefined)),
      release: vi.fn(() => Effect.succeed(undefined)),
      getSnapshot: vi.fn(() =>
        Effect.succeed({
          dailyPagesUsed: 0,
          dailyTokensUsed: 0,
          runPagesUsed: 0,
          runTokensUsed: 0,
          dailyPageLimit: null,
          runPageLimit: null,
          dailyTokenLimit: null,
          runTokenLimit: null,
        }),
      ),
      getBudget: vi.fn(() =>
        Effect.succeed({
          dailyPageLimit: null,
          runPageLimit: null,
          dailyTokenLimit: null,
          runTokenLimit: null,
        }),
      ),
      withReservation: vi.fn(),
    };
    const configLayer = createConfigLayer();
    const TestLayer = Layer.provideMerge(
      OCRAgentServiceLive,
      Layer.mergeAll(
        configLayer,
        Layer.provide(ConcurrencyLimitServiceLive, configLayer),
        Layer.succeed(PaperlessService, paperlessMocks as unknown as PaperlessService),
        Layer.succeed(TinyBaseService, tinybaseMocks as unknown as TinyBaseService),
        Layer.succeed(OcrUsageService, ocrUsageMocks as unknown as OcrUsageService),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ocr = yield* OCRAgentService;
        return yield* ocr.process({ docId: 42 });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result).toMatchObject({
      success: true,
      textLength: mistralText.length,
      pages: 1,
      ocrVersionId: 77,
      ocrPersisted: true,
    });
    expect(result.skipped).toBeUndefined();
    expect(fetch).toHaveBeenCalledWith(
      "https://mistral.test/v1/ocr",
      expect.objectContaining({ method: "POST" }),
    );
    expect(paperlessMocks.downloadPdf).toHaveBeenCalledWith(42);
    expect(paperlessMocks.patchVersionContent).toHaveBeenCalledWith(42, 77, mistralText);
  });

  it("skips OCR when the current Paperless version is already labeled as Mistral OCR", async () => {
    const paperlessContent =
      "Existing Mistral OCR text that is long enough to reuse without another OCR request.";
    const paperlessMocks = {
      getDocument: vi.fn(() =>
        Effect.succeed({
          id: 42,
          title: "Scanned",
          content: paperlessContent,
          tags: [],
          tag_names: [],
          mime_type: "application/pdf",
          original_file_name: "scan.pdf",
          archived_file_name: "scan.pdf",
        }),
      ),
      downloadPdf: vi.fn(() => Effect.fail(new Error("should not download current Mistral OCR"))),
      getDocumentVersions: vi.fn(() =>
        Effect.succeed([
          {
            id: 76,
            label: "Original import",
            created: "2026-05-15T09:00:00.000Z",
          },
          {
            id: 77,
            label: "Mistral OCR searchable PDF 2026-05-16T09:00:00.000Z",
            created: "2026-05-16T09:00:00.000Z",
          },
        ]),
      ),
      uploadOcrPdfVersion: vi.fn(() => Effect.fail(new Error("should not upload"))),
      pollVersionCreation: vi.fn(() => Effect.succeed(null)),
      patchVersionContent: vi.fn(() => Effect.fail(new Error("should not patch"))),
      transitionDocumentTag: vi.fn(() => Effect.succeed(undefined)),
    };
    const tinybaseMocks = {
      getAllSettings: vi.fn(() => Effect.succeed({})),
      getDocumentMemory: vi.fn(() => Effect.succeed(null)),
      getDocumentOcrContent: vi.fn(() => Effect.succeed(null)),
      setDocumentOcrContent: vi.fn(() => Effect.succeed(undefined)),
      patchDocumentMemory: vi.fn(() => Effect.succeed({})),
      appendRunSummary: vi.fn(() => Effect.succeed(undefined)),
      addProcessingLog: vi.fn(() => Effect.succeed("log-1")),
    };
    const ocrUsageMocks = {
      estimatePdfPages: vi.fn(() => 1),
      estimateOcrTokens: vi.fn(() => 100),
      reserve: vi.fn(() => Effect.fail(new Error("should not reserve current Mistral OCR"))),
      commit: vi.fn(() => Effect.succeed(undefined)),
      release: vi.fn(() => Effect.succeed(undefined)),
      getSnapshot: vi.fn(),
      getBudget: vi.fn(),
      withReservation: vi.fn(),
    };
    const configLayer = createConfigLayer();
    const TestLayer = Layer.provideMerge(
      OCRAgentServiceLive,
      Layer.mergeAll(
        configLayer,
        Layer.provide(ConcurrencyLimitServiceLive, configLayer),
        Layer.succeed(PaperlessService, paperlessMocks as unknown as PaperlessService),
        Layer.succeed(TinyBaseService, tinybaseMocks as unknown as TinyBaseService),
        Layer.succeed(OcrUsageService, ocrUsageMocks as unknown as OcrUsageService),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ocr = yield* OCRAgentService;
        return yield* ocr.process({ docId: 42 });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: "existing_mistral_ocr_version",
      textLength: paperlessContent.length,
      pages: 1,
    });
    expect(fetch).not.toHaveBeenCalled();
    expect(paperlessMocks.downloadPdf).not.toHaveBeenCalled();
    expect(ocrUsageMocks.reserve).not.toHaveBeenCalled();
  });

  it("reuses cached OCR text when the source PDF hash matches", async () => {
    const pdfBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    const sourcePdfSha256 = sha256Bytes(pdfBytes);
    const paperlessMocks = {
      getDocument: vi.fn(() =>
        Effect.succeed({
          id: 42,
          title: "Scanned",
          content: "",
          tags: [],
          tag_names: [],
          mime_type: "application/pdf",
          original_file_name: "scan.pdf",
          archived_file_name: "scan.pdf",
        }),
      ),
      downloadPdf: vi.fn(() => Effect.succeed(pdfBytes)),
      getDocumentVersions: vi.fn(() => Effect.succeed([])),
      uploadOcrPdfVersion: vi.fn(() => Effect.succeed({ id: 77 })),
      pollVersionCreation: vi.fn(() => Effect.succeed(null)),
      patchVersionContent: vi.fn(() => Effect.succeed(undefined)),
      transitionDocumentTag: vi.fn(() => Effect.succeed(undefined)),
    };
    const tinybaseMocks = {
      getAllSettings: vi.fn(() => Effect.succeed({})),
      getDocumentMemory: vi.fn(() =>
        Effect.succeed({
          extractedFacts: { ocr: { sourcePdfSha256 } },
        }),
      ),
      getDocumentOcrContent: vi.fn(() =>
        Effect.succeed({
          content: "Cached OCR text",
          pages: 2,
          source: "mistral",
          createdAt: "2026-05-15T10:00:00.000Z",
          updatedAt: "2026-05-15T10:00:00.000Z",
        }),
      ),
      setDocumentOcrContent: vi.fn(() => Effect.succeed(undefined)),
      patchDocumentMemory: vi.fn(() => Effect.succeed({})),
      appendRunSummary: vi.fn(() => Effect.succeed(undefined)),
      addProcessingLog: vi.fn(() => Effect.succeed("log-1")),
    };
    const ocrUsageMocks = {
      estimatePdfPages: vi.fn(() => 1),
      estimateOcrTokens: vi.fn(() => 100),
      reserve: vi.fn(() => Effect.fail(new Error("should not reserve cached OCR"))),
      commit: vi.fn(() => Effect.succeed(undefined)),
      release: vi.fn(() => Effect.succeed(undefined)),
      getSnapshot: vi.fn(() =>
        Effect.succeed({
          dailyPagesUsed: 0,
          dailyTokensUsed: 0,
          runPagesUsed: 0,
          runTokensUsed: 0,
          dailyPageLimit: null,
          runPageLimit: null,
          dailyTokenLimit: null,
          runTokenLimit: null,
        }),
      ),
      getBudget: vi.fn(() =>
        Effect.succeed({
          dailyPageLimit: null,
          runPageLimit: null,
          dailyTokenLimit: null,
          runTokenLimit: null,
        }),
      ),
      withReservation: vi.fn(),
    };
    const configLayer = createConfigLayer();
    const TestLayer = Layer.provideMerge(
      OCRAgentServiceLive,
      Layer.mergeAll(
        configLayer,
        Layer.provide(ConcurrencyLimitServiceLive, configLayer),
        Layer.succeed(PaperlessService, paperlessMocks as unknown as PaperlessService),
        Layer.succeed(TinyBaseService, tinybaseMocks as unknown as TinyBaseService),
        Layer.succeed(OcrUsageService, ocrUsageMocks as unknown as OcrUsageService),
      ),
    );

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const ocr = yield* OCRAgentService;
        return yield* ocr.process({ docId: 42 });
      }).pipe(Effect.provide(TestLayer)),
    );

    expect(result).toMatchObject({
      success: true,
      skipped: true,
      skipReason: "cached_ocr_result",
      textLength: "Cached OCR text".length,
      pages: 2,
      sourcePdfSha256,
    });
    expect(tinybaseMocks.getDocumentOcrContent).toHaveBeenCalledWith(42);
    expect(paperlessMocks.patchVersionContent).toHaveBeenCalledWith(42, 77, "Cached OCR text");
    expect(ocrUsageMocks.reserve).not.toHaveBeenCalled();
  });
});
