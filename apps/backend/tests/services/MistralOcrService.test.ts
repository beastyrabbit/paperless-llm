import { createHash } from "node:crypto";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import { ConcurrencyLimitServiceLive } from "../../src/services/ConcurrencyLimitService.js";
import {
  MISTRAL_OCR_MODEL,
  MistralOcrService,
  MistralOcrServiceLive,
} from "../../src/services/MistralOcrService.js";
import { canonicalMistralOcrRequestForTest } from "../../src/services/mistral-ocr/client.js";

const pdfBytes = Buffer.from("%PDF-1.7\n1 0 obj\n<< /Type /Page >>\nendobj\n%%EOF", "latin1");
const rawPdfSha256 = createHash("sha256").update(pdfBytes).digest("hex");

const createConfigLayer = (
  overrides: {
    readonly apiKey?: string;
    readonly requestTimeoutMs?: number;
    readonly retryAttempts?: number;
    readonly retryBaseDelayMs?: number;
  } = {},
) =>
  Layer.succeed(ConfigService, {
    config: {
      mistral: {
        apiKey: overrides.apiKey ?? "test-key",
        model: "mistral-large-latest",
        apiBaseUrl: "http://mistral.test",
      },
      http: {
        requestTimeoutMs: overrides.requestTimeoutMs ?? 1_000,
        agentPromptTimeoutMs: 1_000,
        mistralRetryAttempts: overrides.retryAttempts ?? 1,
        mistralRetryBaseDelayMs: overrides.retryBaseDelayMs ?? 1,
      },
      concurrency: {
        ollamaMaxConcurrent: 1,
        mistralMaxConcurrent: 1,
        ocrMaxConcurrent: 1,
      },
    },
  } as unknown as ConfigService);

const createTestLayer = (configLayer = createConfigLayer()) =>
  Layer.provideMerge(
    MistralOcrServiceLive,
    Layer.mergeAll(configLayer, Layer.provide(ConcurrencyLimitServiceLive, configLayer)),
  );

const runProcessPdf = (
  input: Parameters<MistralOcrService["processPdf"]>[0],
  layer = createTestLayer(),
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* MistralOcrService;
      return yield* service.processPdf(input);
    }).pipe(Effect.provide(layer)),
  );

const runProcessPdfEither = (
  input: Parameters<MistralOcrService["processPdf"]>[0],
  layer = createTestLayer(),
) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const service = yield* MistralOcrService;
      return yield* Effect.either(service.processPdf(input));
    }).pipe(Effect.provide(layer)),
  );

describe("MistralOcrService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("posts PDFs to the dedicated OCR endpoint and returns typed in-memory OCR data", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          model: MISTRAL_OCR_MODEL,
          pages: [
            {
              index: 0,
              markdown: "# Invoice\n\n| Item | Total |\n| --- | --- |\n| A | 10 |",
              tables: [{ id: "tbl-0", markdown: "| Item | Total |" }],
              images: [],
              hyperlinks: [],
              header: "Header",
              footer: null,
              dimensions: { dpi: 200, height: 2200, width: 1700 },
              confidence_scores: {
                average_page_confidence_score: 0.98,
                minimum_page_confidence_score: 0.91,
              },
              blocks: [
                {
                  type: "table",
                  content: "| Item | Total |",
                  top_left_x: 1,
                  top_left_y: 2,
                  bottom_right_x: 3,
                  bottom_right_y: 4,
                  table_id: "tbl-0",
                },
              ],
            },
          ],
          usage_info: { pages_processed: 1, doc_size_bytes: pdfBytes.byteLength },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const input = {
      pdfBytes,
      source: { id: "doc-42", fileName: "invoice.pdf" },
      options: { pages: "0", includeImageBase64: false },
    };
    const result = await runProcessPdf(input);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const firstCall = fetchMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [url, init] = firstCall as unknown as [string, RequestInit];
    expect(url).toBe("http://mistral.test/v1/ocr");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer test-key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({
      model: MISTRAL_OCR_MODEL,
      table_format: "markdown",
      include_blocks: true,
      confidence_scores_granularity: "page",
      include_image_base64: false,
      pages: [0],
      document: {
        type: "document_url",
      },
    });
    expect(body.document.document_url).toBe(
      `data:application/pdf;base64,${pdfBytes.toString("base64")}`,
    );
    expect(result.pages[0]?.confidence?.averagePageConfidenceScore).toBe(0.98);
    expect(result.pages[0]?.blocks[0]).toMatchObject({
      type: "table",
      tableId: "tbl-0",
      topLeftX: 1,
    });
    expect(result.usage).toEqual({ pagesProcessed: 1, docSizeBytes: pdfBytes.byteLength });
    expect(result.sourceHash).toBe(rawPdfSha256);
    expect(result.optionsHash).toBe(canonicalMistralOcrRequestForTest(input).optionsHash);
    expect(result.ocrHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("uses the raw PDF byte hash as sourceHash without source descriptor metadata", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        Response.json({
          model: MISTRAL_OCR_MODEL,
          pages: [{ index: 0, markdown: "same pdf" }],
          usage_info: { pages_processed: 1, doc_size_bytes: pdfBytes.byteLength },
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const first = await runProcessPdf({
      pdfBytes,
      source: { id: "doc-1", fileName: "first.pdf", mimeType: "application/pdf" },
    });
    const second = await runProcessPdf({
      pdfBytes,
      source: { id: "doc-2", fileName: "second.pdf", mimeType: "application/pdf" },
    });

    expect(first.sourceHash).toBe(rawPdfSha256);
    expect(second.sourceHash).toBe(rawPdfSha256);
    expect(canonicalMistralOcrRequestForTest({ pdfBytes }).sourceHash).toBe(rawPdfSha256);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("retries transient OCR failures without including provider bodies in errors", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response("temporary body with test-key", { status: 500 }))
      .mockResolvedValueOnce(
        Response.json({
          model: MISTRAL_OCR_MODEL,
          pages: [{ index: 0, markdown: "ok" }],
          usage_info: { pages_processed: 1, doc_size_bytes: null },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const layer = createTestLayer(createConfigLayer({ retryAttempts: 2, retryBaseDelayMs: 1 }));
    const result = await runProcessPdf({ pdfBytes }, layer);

    expect(result.markdown).toBe("ok");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("returns sanitized non-retryable HTTP errors", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(new Response("bad request body with test-key", { status: 400 })),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProcessPdfEither({ pdfBytes });

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("http");
      expect(result.left.statusCode).toBe(400);
      expect(result.left.retryable).toBe(false);
      expect(result.left.message).toBe("Mistral OCR request rejected with HTTP 400");
      expect(result.left.message).not.toContain("test-key");
      expect(result.left.message).not.toContain("bad request body");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("validates provider response schemas", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() => Promise.resolve(Response.json({ model: MISTRAL_OCR_MODEL, pages: [{}] }))),
    );

    const result = await runProcessPdfEither({ pdfBytes });

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("schema");
      expect(result.left.message).toBe("Mistral OCR response did not match the expected schema");
    }
  });

  it("enforces PDF byte and page limits before calling the provider", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const byteLimitResult = await runProcessPdfEither({
      pdfBytes,
      options: { limits: { maxInputBytes: 4 } },
    });
    expect(byteLimitResult._tag).toBe("Left");
    if (byteLimitResult._tag === "Left") {
      expect(byteLimitResult.left.kind).toBe("limit");
    }

    const pageLimitResult = await runProcessPdfEither({
      pdfBytes,
      options: { pages: [0, 1], limits: { maxPages: 1 } },
    });
    expect(pageLimitResult._tag).toBe("Left");
    if (pageLimitResult._tag === "Left") {
      expect(pageLimitResult.left.kind).toBe("limit");
    }

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("enforces output limits after receiving OCR data", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(() =>
        Promise.resolve(
          Response.json({
            model: MISTRAL_OCR_MODEL,
            pages: [{ index: 0, markdown: "x".repeat(100) }],
            usage_info: { pages_processed: 1, doc_size_bytes: null },
          }),
        ),
      ),
    );

    const result = await runProcessPdfEither({
      pdfBytes,
      options: { limits: { maxOutputBytes: 20 } },
    });
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("output_limit");
    }
  });

  it("cancels requests through AbortSignal", async () => {
    const controller = new AbortController();
    let markStarted: () => void = () => {};
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const fetchMock = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          markStarted();
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new DOMException("Aborted", "AbortError")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const promise = runProcessPdfEither({ pdfBytes, options: { signal: controller.signal } });
    await started;
    controller.abort(new Error("user cancelled"));

    const result = await promise;
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("cancelled");
      expect(result.left.retryable).toBe(false);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("fails fast when the OCR API key is absent", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const result = await runProcessPdfEither(
      { pdfBytes },
      createTestLayer(createConfigLayer({ apiKey: "" })),
    );
    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.kind).toBe("configuration");
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
