import { Effect, Layer } from "effect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  getDocument,
  getDocumentContent,
  getQueueStats,
} from "../../src/api/documents/handlers.js";
import { clearPaperlessStatusCacheForTests } from "../../src/api/paperlessStatusCache.js";
import { ConfigService } from "../../src/config/index.js";
import { NotFoundError } from "../../src/errors/index.js";
import { DocumentAuthorizationService } from "../../src/services/DocumentAuthorizationService.js";
import { PaperlessService } from "../../src/services/PaperlessService.js";

describe("documents handlers", () => {
  beforeEach(() => {
    clearPaperlessStatusCacheForTests();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearPaperlessStatusCacheForTests();
  });

  it("preserves queue stats behavior without document authorization", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const TestLayer = Layer.succeed(PaperlessService, {
      getQueueStats: vi.fn(() => Effect.fail(new Error("Paperless unavailable"))),
      getTotalDocumentCount: vi.fn(() => Effect.fail(new Error("Paperless unavailable"))),
    } as unknown as PaperlessService);

    const result = await Effect.runPromise(getQueueStats.pipe(Effect.provide(TestLayer)));

    expect(result).toMatchObject({
      paperless_reachable: false,
      status: "paperless_unreachable",
      total_documents: 0,
    });
    expect(result.errors).toHaveLength(2);
  });

  it("caches immediate queue stats reads", async () => {
    const queueStats = {
      todo: 1,
      ocr: 0,
      metadata: 0,
      review: 0,
      index: 0,
      done: 2,
      pending: 1,
      ocrDone: 0,
      titleDone: 0,
      correspondentDone: 0,
      documentTypeDone: 0,
      tagsDone: 0,
      processed: 0,
      failed: 0,
      manualReview: 0,
      total: 3,
    };
    const getQueueStatsMock = vi.fn(() => Effect.succeed(queueStats));
    const getTotalDocumentCountMock = vi.fn(() => Effect.succeed(650));
    const TestLayer = Layer.succeed(PaperlessService, {
      getQueueStats: getQueueStatsMock,
      getTotalDocumentCount: getTotalDocumentCountMock,
    } as unknown as PaperlessService);

    const first = await Effect.runPromise(getQueueStats.pipe(Effect.provide(TestLayer)));
    const second = await Effect.runPromise(getQueueStats.pipe(Effect.provide(TestLayer)));

    expect(getQueueStatsMock).toHaveBeenCalledTimes(1);
    expect(getTotalDocumentCountMock).toHaveBeenCalledTimes(1);
    expect(second).toEqual(first);
    expect(first.total_documents).toBe(650);
  });

  it("loads document details with targeted metadata lookups", async () => {
    const getTagsMock = vi.fn(() => Effect.fail(new Error("should not fetch all tags")));
    const getCorrespondentsMock = vi.fn(() =>
      Effect.fail(new Error("should not fetch all correspondents")),
    );
    const getDocumentTypesMock = vi.fn(() =>
      Effect.fail(new Error("should not fetch all document types")),
    );
    const TestLayer = Layer.mergeAll(
      Layer.succeed(ConfigService, {
        config: {
          tags: {
            todo: "ai-queued",
            ocr: "ai-processing",
            metadata: "ai-processing",
            review: "ai-review",
            index: "ai-processing",
            done: "ai-done",
            failed: "ai-failed",
            pending: "ai-queued",
            ocrDone: "ai-ocr-done",
            summaryDone: "ai-summary-done",
            titleDone: "ai-title-done",
            correspondentDone: "ai-correspondent-done",
            documentTypeDone: "ai-document-type-done",
            tagsDone: "ai-tags-done",
            processed: "ai-done",
            manualReview: "ai-review",
            schemaReview: "ai-review",
          },
        },
      } as unknown as ConfigService),
      Layer.succeed(DocumentAuthorizationService, {
        authorizeDocument: vi.fn(() => Effect.void),
        filterAuthorizedDocuments: vi.fn((items) => Effect.succeed([...items])),
      } as unknown as DocumentAuthorizationService),
      Layer.succeed(PaperlessService, {
        getDocument: vi.fn(() =>
          Effect.succeed({
            id: 42,
            title: "Invoice",
            content: "content",
            tags: [7],
            correspondent: 11,
            document_type: 13,
            custom_fields: [],
            created: "2026-05-16",
            modified: "2026-05-16",
            added: "2026-05-16",
            original_file_name: "invoice.pdf",
            archive_serial_number: null,
          }),
        ),
        getTag: vi.fn(() =>
          Effect.succeed({ id: 7, name: "ai-done", slug: "ai-done", color: "#00ff00" }),
        ),
        getCorrespondent: vi.fn(() => Effect.succeed({ id: 11, name: "PayPal", slug: "paypal" })),
        getDocumentType: vi.fn(() =>
          Effect.succeed({ id: 13, name: "Rechnung", slug: "rechnung" }),
        ),
        getTags: getTagsMock,
        getCorrespondents: getCorrespondentsMock,
        getDocumentTypes: getDocumentTypesMock,
      } as unknown as PaperlessService),
    );

    const result = await Effect.runPromise(getDocument(42).pipe(Effect.provide(TestLayer)));

    expect(result).toMatchObject({
      id: 42,
      correspondent: "PayPal",
      document_type: "Rechnung",
      processing_status: "done",
      tags: [{ id: 7, name: "ai-done", color: "#00ff00" }],
    });
    expect(getTagsMock).not.toHaveBeenCalled();
    expect(getCorrespondentsMock).not.toHaveBeenCalled();
    expect(getDocumentTypesMock).not.toHaveBeenCalled();
  });

  it("blocks document content before Paperless access when document authorization denies", async () => {
    const getDocumentContentMock = vi.fn(() => Effect.succeed("secret"));
    const TestLayer = Layer.mergeAll(
      Layer.succeed(DocumentAuthorizationService, {
        authorizeDocument: vi.fn(() =>
          Effect.fail(
            new NotFoundError({ message: "Document 42 not found", resource: "document", id: 42 }),
          ),
        ),
        filterAuthorizedDocuments: vi.fn((items) => Effect.succeed([...items])),
      } as unknown as DocumentAuthorizationService),
      Layer.succeed(PaperlessService, {
        getDocumentContent: getDocumentContentMock,
      } as unknown as PaperlessService),
    );

    await expect(
      Effect.runPromise(getDocumentContent(42).pipe(Effect.provide(TestLayer))),
    ).rejects.toThrow("Document 42 not found");
    expect(getDocumentContentMock).not.toHaveBeenCalled();
  });
});
