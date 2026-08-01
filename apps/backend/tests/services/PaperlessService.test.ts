import { sha256Hex } from "@repo/api-contracts";
import { Effect, Layer } from "effect";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConfigService } from "../../src/config/index.js";
import { PaperlessService, PaperlessServiceLive } from "../../src/services/PaperlessService.js";

const createConfigLayer = (requestTimeoutMs = 1_000, tags: Record<string, string> = {}) =>
  Layer.succeed(ConfigService, {
    config: {
      paperless: {
        url: "http://paperless.test",
        token: "paperless-token",
      },
      tags,
      http: {
        requestTimeoutMs,
      },
    },
  } as unknown as ConfigService);

const createTestLayer = (requestTimeoutMs = 1_000, tags: Record<string, string> = {}) =>
  Layer.provideMerge(PaperlessServiceLive, createConfigLayer(requestTimeoutMs, tags));

const jsonResponse = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const bytesResponse = (bytes: Uint8Array, status = 200) =>
  new Response(bytes, {
    status,
    headers: { "Content-Type": "application/pdf" },
  });

const documentFixture = (
  overrides: Partial<{
    id: number;
    title: string;
    content: string | null;
    correspondent: number | null;
    document_type: number | null;
    tags: number[];
    custom_fields: unknown[];
    modified: string;
  }> = {},
) => ({
  id: overrides.id ?? 42,
  title: overrides.title ?? "Invoice",
  content: overrides.content ?? "content",
  correspondent: overrides.correspondent ?? null,
  document_type: overrides.document_type ?? null,
  tags: overrides.tags ?? [1],
  created: "2026-07-22T08:00:00.000Z",
  modified: overrides.modified ?? "2026-07-22T10:00:00.000Z",
  added: "2026-07-22T08:30:00.000Z",
  archive_serial_number: null,
  original_file_name: "invoice.pdf",
  archived_file_name: "invoice_archive.pdf",
  custom_fields: overrides.custom_fields ?? [],
});

const paginatedDocuments = ({
  count,
  next,
  previous = null,
  results,
}: {
  readonly count: number;
  readonly next: string | null;
  readonly previous?: string | null;
  readonly results: readonly ReturnType<typeof documentFixture>[];
}) =>
  jsonResponse({
    count,
    next,
    previous,
    results,
  });

describe("PaperlessService", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("fails hanging Paperless endpoints within the configured timeout", async () => {
    const fetchMock = vi.fn(
      (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(init.signal?.reason ?? new Error("aborted")),
            { once: true },
          );
        }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.getTags());
      }).pipe(Effect.provide(createTestLayer(5))),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("timed out");
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid endpoint response shapes at the Paperless boundary", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: "not-a-number", name: "A", slug: "a" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.getTags());
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("Invalid Paperless");
    }
  });

  it("fetches every page for catalog hydration", async () => {
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      expect(url.pathname).toBe("/api/tags/");
      const page = url.searchParams.get("page");
      if (page === "1") {
        return Promise.resolve(
          jsonResponse({
            count: 3,
            next: "http://paperless.test/api/tags/?page=2",
            previous: null,
            results: [{ id: 1, name: "A", slug: "a" }],
          }),
        );
      }
      return Promise.resolve(
        jsonResponse({
          count: 3,
          next: null,
          previous: "http://paperless.test/api/tags/?page=1",
          results: [
            { id: 2, name: "B", slug: "b" },
            { id: 3, name: "C", slug: "c" },
          ],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const tags = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* paperless.getTags();
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(tags.map((tag) => tag.id)).toEqual([1, 2, 3]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fails closed when Paperless ends pagination before the declared count", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        jsonResponse({
          count: 2,
          next: null,
          previous: null,
          results: [{ id: 1, name: "A", slug: "a" }],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.getTags());
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("early end");
    }
  });

  it("selects the original non-application-generated version for PDF downloads", async () => {
    const pdfBytes = new Uint8Array([1, 2, 3]);
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname === "/api/documents/42/") {
        return Promise.resolve(
          jsonResponse({
            ...documentFixture(),
            versions: [
              {
                id: 7,
                version_label: "Mistral OCR searchable PDF",
                created: "2026-07-22T12:00:00.000Z",
              },
              {
                id: 3,
                version_label: "Original",
                created: "2026-07-22T08:00:00.000Z",
                is_root: true,
              },
              {
                id: 4,
                version_label: "Source upload",
                created: "2026-07-22T10:00:00.000Z",
              },
            ],
          }),
        );
      }
      expect(url.pathname).toBe("/api/documents/42/download/");
      expect(url.searchParams.get("version")).toBe("4");
      return Promise.resolve(bytesResponse(pdfBytes));
    });
    vi.stubGlobal("fetch", fetchMock);

    const bytes = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* paperless.downloadPdf(42);
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect([...bytes]).toEqual([...pdfBytes]);
  });

  it("performs exact updates while preserving configured system tags and unconfigured custom fields", async () => {
    const before = documentFixture({
      correspondent: 5,
      document_type: 6,
      tags: [1, 99],
      custom_fields: [
        { field: 10, value: "keep" },
        { field: 11, value: "old" },
      ],
    });
    const after = documentFixture({
      title: "Invoice cleared",
      correspondent: null,
      document_type: null,
      tags: [2, 99],
      custom_fields: [
        { field: 10, value: "keep" },
        { field: 11, value: null },
      ],
    });
    const patchBodies: unknown[] = [];
    let documentReads = 0;
    const fetchMock = vi.fn(
      async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/tags/") {
          return jsonResponse({
            count: 1,
            next: null,
            previous: null,
            results: [{ id: 99, name: "llm-todo", slug: "llm-todo" }],
          });
        }
        if (url.pathname === "/api/documents/42/" && init?.method === "PATCH") {
          patchBodies.push(JSON.parse(String(init.body)));
          return jsonResponse(after);
        }
        if (url.pathname === "/api/documents/42/") {
          documentReads += 1;
          return jsonResponse(documentReads === 1 ? before : after);
        }
        throw new Error(`unexpected request ${url.pathname}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* paperless.updateDocument(42, {
          title: "Invoice cleared",
          correspondent: null,
          document_type: null,
          tags: [2],
          custom_fields: [{ field: 11, value: null }],
        });
      }).pipe(Effect.provide(createTestLayer(1_000, { todo: "llm-todo" }))),
    );

    expect(updated.title).toBe("Invoice cleared");
    expect(updated.correspondent).toBeNull();
    expect(updated.document_type).toBeNull();
    expect(updated.tags).toEqual([2, 99]);
    expect(patchBodies).toEqual([
      {
        title: "Invoice cleared",
        correspondent: null,
        document_type: null,
        tags: [2, 99],
        custom_fields: [
          { field: 10, value: "keep" },
          { field: 11, value: null },
        ],
      },
    ]);
  });

  it("rejects stale document-state preconditions before writing", async () => {
    const fetchMock = vi.fn(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/documents/42/" && init?.method !== "PATCH") {
          return Promise.resolve(jsonResponse(documentFixture()));
        }
        throw new Error("PATCH should not be called for stale writes");
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(
          paperless.updateDocumentExact(
            42,
            { title: "New" },
            {
              preconditions: [
                {
                  kind: "paperless_document_state",
                  digest: "0".repeat(64) as ReturnType<typeof sha256Hex>,
                },
              ],
              preserveTagIds: new Set(),
            },
          ),
        );
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect("statusCode" in result.left ? result.left.statusCode : undefined).toBe(409);
    }
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("rereads after ambiguous successful writes", async () => {
    let documentReads = 0;
    const fetchMock = vi.fn(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/documents/42/" && init?.method === "PATCH") {
          return Promise.resolve(jsonResponse({ status: "accepted" }));
        }
        if (url.pathname === "/api/documents/42/") {
          documentReads += 1;
          return Promise.resolve(
            jsonResponse(documentFixture({ title: documentReads === 1 ? "Before" : "After" })),
          );
        }
        throw new Error(`unexpected request ${url.pathname}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const updated = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* paperless.updateDocumentExact(
          42,
          { title: "After" },
          { preserveTagIds: new Set() },
        );
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(updated.title).toBe("After");
    expect(documentReads).toBe(2);
  });

  it("submits official bulk requests and polls actual task failures", async () => {
    const digest = sha256Hex("payload");
    const bulkBodies: unknown[] = [];
    const taskPolls: string[] = [];
    const fetchMock = vi.fn(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/documents/42/") {
          return Promise.resolve(jsonResponse(documentFixture()));
        }
        if (url.pathname === "/api/documents/bulk_edit/") {
          bulkBodies.push(JSON.parse(String(init?.body)));
          return Promise.resolve(jsonResponse({ result: `task-${bulkBodies.length}` }));
        }
        if (url.pathname === "/api/tasks/") {
          taskPolls.push(url.searchParams.get("task_id") ?? "");
          return Promise.resolve(
            jsonResponse({
              count: 1,
              next: null,
              previous: null,
              results: [
                {
                  id: 1,
                  task_id: "task-1",
                  task_type: "documents.tasks.bulk_update_documents",
                  status: "FAILURE",
                  date_created: "2026-07-22T10:00:00.000Z",
                  date_done: "2026-07-22T10:00:01.000Z",
                  result_data: { error: "bulk failed" },
                },
              ],
            }),
          );
        }
        throw new Error(`unexpected request ${url.pathname}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        const tagTask = yield* paperless.submitBulkOperation({
          operation: "modify_tags",
          documentIds: [42],
          preconditions: [{ kind: "catalog_epoch", digest }],
          payloadHash: digest,
          idempotencyKey: "bulk-tags-1",
          parameters: { addTagIds: [9], removeTagIds: [3] },
        });
        const correspondentTask = yield* paperless.submitBulkOperation({
          operation: "set_correspondent",
          documentIds: [42],
          preconditions: [{ kind: "catalog_epoch", digest }],
          payloadHash: digest,
          idempotencyKey: "bulk-correspondent-1",
          parameters: { correspondentId: 17 },
        });
        const documentTypeTask = yield* paperless.submitBulkOperation({
          operation: "set_document_type",
          documentIds: [42],
          preconditions: [{ kind: "catalog_epoch", digest }],
          payloadHash: digest,
          idempotencyKey: "bulk-doctype-1",
          parameters: { documentTypeId: 23 },
        });
        const polled = yield* paperless.pollTask(tagTask.taskId, { timeoutMs: 50, intervalMs: 1 });
        return { tagTask, correspondentTask, documentTypeTask, polled };
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result.tagTask).toMatchObject({ taskId: "task-1", status: "queued" });
    expect(result.correspondentTask).toMatchObject({ taskId: "task-2", status: "queued" });
    expect(result.documentTypeTask).toMatchObject({ taskId: "task-3", status: "queued" });
    expect(result.polled).toMatchObject({
      taskId: "task-1",
      status: "failed",
      errorCode: "bulk failed",
    });
    expect(taskPolls).toEqual(["task-1"]);
    expect(bulkBodies).toEqual([
      {
        documents: [42],
        method: "modify_tags",
        parameters: { add_tags: [9], remove_tags: [3] },
      },
      {
        documents: [42],
        method: "set_correspondent",
        parameters: { correspondent: 17 },
      },
      {
        documents: [42],
        method: "set_document_type",
        parameters: { document_type: 23 },
      },
    ]);
  });

  it("invalidates catalog caches after catalog mutations", async () => {
    let tagPageReads = 0;
    const fetchMock = vi.fn(
      (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
        const url = new URL(String(input));
        if (url.pathname === "/api/tags/" && init?.method !== "PATCH") {
          tagPageReads += 1;
          return Promise.resolve(
            jsonResponse({
              count: 1,
              next: null,
              previous: null,
              results: [
                {
                  id: 1,
                  name: tagPageReads === 1 ? "Old" : "Renamed",
                  slug: tagPageReads === 1 ? "old" : "renamed",
                },
              ],
            }),
          );
        }
        if (url.pathname === "/api/tags/1/" && init?.method === "PATCH") {
          expect(JSON.parse(String(init.body))).toEqual({ name: "Renamed" });
          return Promise.resolve(jsonResponse({ id: 1, name: "Renamed", slug: "renamed" }));
        }
        throw new Error(`unexpected request ${url.pathname}`);
      },
    );
    vi.stubGlobal("fetch", fetchMock);

    const names = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        const first = yield* paperless.getTags();
        const cached = yield* paperless.getTags();
        yield* paperless.renameTag(1, "Renamed");
        const refreshed = yield* paperless.getTags();
        return [first[0]?.name, cached[0]?.name, refreshed[0]?.name];
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(names).toEqual(["Old", "Old", "Renamed"]);
    expect(tagPageReads).toBe(2);
  });

  it("builds assignment receipts for more than 100 documents per side with exact filters", async () => {
    const tagOneDocs = Array.from({ length: 120 }, (_, index) =>
      documentFixture({ id: index + 1, tags: index + 1 >= 61 ? [1, 2] : [1] }),
    );
    const tagTwoDocs = Array.from({ length: 120 }, (_, index) =>
      documentFixture({ id: index + 61, tags: index + 61 <= 120 ? [1, 2] : [2] }),
    );
    const requestKeys: string[] = [];
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/documents/") {
        throw new Error(`unexpected request ${url.pathname}`);
      }
      const filterKeys = ["tags__id", "correspondent", "document_type"].filter((key) =>
        url.searchParams.has(key),
      );
      expect(filterKeys).toHaveLength(1);
      expect(url.searchParams.get("page_size")).toBe("100");
      requestKeys.push(`${filterKeys[0]}=${url.searchParams.get(filterKeys[0] ?? "")}`);

      const page = Number(url.searchParams.get("page") ?? "1");
      const tagId = url.searchParams.get("tags__id");
      if (tagId === "1") {
        return Promise.resolve(
          paginatedDocuments({
            count: tagOneDocs.length,
            next:
              page === 1
                ? "http://paperless.test/api/documents/?tags__id=1&page=2&page_size=100"
                : null,
            previous: page === 2 ? "http://paperless.test/api/documents/?tags__id=1&page=1" : null,
            results: page === 1 ? tagOneDocs.slice(0, 100) : tagOneDocs.slice(100),
          }),
        );
      }
      if (tagId === "2") {
        return Promise.resolve(
          paginatedDocuments({
            count: tagTwoDocs.length,
            next:
              page === 1
                ? "http://paperless.test/api/documents/?tags__id=2&page=2&page_size=100"
                : null,
            previous: page === 2 ? "http://paperless.test/api/documents/?tags__id=2&page=1" : null,
            results: page === 1 ? tagTwoDocs.slice(0, 100) : tagTwoDocs.slice(100),
          }),
        );
      }
      if (url.searchParams.get("correspondent") === "5") {
        return Promise.resolve(
          paginatedDocuments({
            count: 1,
            next: null,
            results: [documentFixture({ id: 200, correspondent: 5 })],
          }),
        );
      }
      if (url.searchParams.get("document_type") === "7") {
        return Promise.resolve(
          paginatedDocuments({
            count: 1,
            next: null,
            results: [documentFixture({ id: 201, document_type: 7 })],
          }),
        );
      }
      throw new Error(`unexpected filter ${url.search}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const receipts = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        const tags = yield* paperless.enumerateTagAssignments(1, 2);
        const correspondent = yield* paperless.readCorrespondentAssignmentReceipt(5);
        const documentType = yield* paperless.readDocumentTypeAssignmentReceipt(7);
        return { tags, correspondent, documentType };
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(receipts.tags.xDocumentIds).toHaveLength(120);
    expect(receipts.tags.yDocumentIds).toHaveLength(120);
    expect(receipts.tags.bothDocumentIds).toEqual(
      Array.from({ length: 60 }, (_, index) => index + 61),
    );
    expect(receipts.tags.xReceipt).toMatchObject({
      expectedApiCount: 120,
      fetchedCount: 120,
      pageCount: 2,
      filterDescriptor: { path: "/documents/", params: { tags__id: 1 } },
      complete: true,
    });
    expect(receipts.tags.xReceipt?.documents[0]).toMatchObject({
      documentId: 1,
      verifiedMembership: true,
    });
    expect(receipts.tags.yProof?.documentIds).toEqual(receipts.tags.yDocumentIds);
    expect(receipts.correspondent).toMatchObject({
      filterDescriptor: { path: "/documents/", params: { correspondent: 5 } },
      documentIds: [200],
      complete: true,
    });
    expect(receipts.documentType).toMatchObject({
      filterDescriptor: { path: "/documents/", params: { document_type: 7 } },
      documentIds: [201],
      complete: true,
    });
    expect(requestKeys).toContain("tags__id=1");
    expect(requestKeys).toContain("tags__id=2");
    expect(requestKeys).toContain("correspondent=5");
    expect(requestKeys).toContain("document_type=7");
  });

  it("rejects moving pagination counts while reading assignment receipts", async () => {
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      const page = url.searchParams.get("page");
      if (page === "1") {
        return Promise.resolve(
          paginatedDocuments({
            count: 101,
            next: "http://paperless.test/api/documents/?tags__id=1&page=2&page_size=100",
            results: Array.from({ length: 100 }, (_, index) =>
              documentFixture({ id: index + 1, tags: [1] }),
            ),
          }),
        );
      }
      return Promise.resolve(
        paginatedDocuments({
          count: 102,
          next: null,
          previous: "http://paperless.test/api/documents/?tags__id=1&page=1",
          results: [documentFixture({ id: 101, tags: [1] })],
        }),
      );
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.readTagAssignmentReceipt(1));
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("count changed");
    }
  });

  it("rejects pagination links that change the assignment filter", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        paginatedDocuments({
          count: 2,
          next: "http://paperless.test/api/documents/?tags__id=2&page=2&page_size=100",
          results: [documentFixture({ id: 1, tags: [1, 2] })],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.readTagAssignmentReceipt(1));
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("query parameter tags__id changed");
    }
  });

  it("rejects forged assignment memberships", async () => {
    const fetchMock = vi.fn(() =>
      Promise.resolve(
        paginatedDocuments({
          count: 1,
          next: null,
          results: [documentFixture({ id: 1, tags: [999] })],
        }),
      ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        return yield* Effect.either(paperless.readTagAssignmentReceipt(1));
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(result._tag).toBe("Left");
    if (result._tag === "Left") {
      expect(result.left.message).toContain("membership verification failed");
    }
  });

  it("rejects duplicate pages and duplicate document IDs while paginating receipts", async () => {
    const runReceipt = async (
      fetchMock: ReturnType<
        typeof vi.fn<(input: Parameters<typeof fetch>[0]) => Promise<Response>>
      >,
    ) => {
      vi.stubGlobal("fetch", fetchMock);
      return Effect.runPromise(
        Effect.gen(function* () {
          const paperless = yield* PaperlessService;
          return yield* Effect.either(paperless.readTagAssignmentReceipt(1));
        }).pipe(Effect.provide(createTestLayer())),
      );
    };

    const duplicatePage = await runReceipt(
      vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        if (url.searchParams.get("page") !== "1") {
          throw new Error("duplicate page test should not fetch page 2");
        }
        return Promise.resolve(
          paginatedDocuments({
            count: 2,
            next: "http://paperless.test/api/documents/?tags__id=1&page=1&page_size=100",
            results: [documentFixture({ id: 1, tags: [1] })],
          }),
        );
      }),
    );
    expect(duplicatePage._tag).toBe("Left");
    if (duplicatePage._tag === "Left") {
      expect(duplicatePage.left.message).toContain("duplicate or cyclic next page");
    }

    vi.restoreAllMocks();

    const duplicateModifiedEpoch = await runReceipt(
      vi.fn((input: Parameters<typeof fetch>[0]) => {
        const url = new URL(String(input));
        if (url.searchParams.get("page") === "1") {
          return Promise.resolve(
            paginatedDocuments({
              count: 2,
              next: "http://paperless.test/api/documents/?tags__id=1&page=2&page_size=100",
              results: [
                documentFixture({ id: 1, tags: [1], modified: "2026-07-22T10:00:00.000Z" }),
              ],
            }),
          );
        }
        return Promise.resolve(
          paginatedDocuments({
            count: 2,
            next: null,
            previous: "http://paperless.test/api/documents/?tags__id=1&page=1",
            results: [documentFixture({ id: 1, tags: [1], modified: "2026-07-22T11:00:00.000Z" })],
          }),
        );
      }),
    );
    expect(duplicateModifiedEpoch._tag).toBe("Left");
    if (duplicateModifiedEpoch._tag === "Left") {
      expect(duplicateModifiedEpoch.left.message).toContain("duplicate entity/document id 1");
    }
  });

  it("enumerates separate X/Y assignments with full pagination and membership verification", async () => {
    const fetchMock = vi.fn((input: Parameters<typeof fetch>[0]) => {
      const url = new URL(String(input));
      if (url.pathname !== "/api/documents/") {
        throw new Error(`unexpected request ${url.pathname}`);
      }
      const tagId = url.searchParams.get("tags__id");
      const page = url.searchParams.get("page");
      if (tagId === "1" && page === "1") {
        return Promise.resolve(
          jsonResponse({
            count: 2,
            next: "http://paperless.test/api/documents/?tags__id=1&page=2",
            previous: null,
            results: [documentFixture({ id: 1, tags: [1] })],
          }),
        );
      }
      if (tagId === "1" && page === "2") {
        return Promise.resolve(
          jsonResponse({
            count: 2,
            next: null,
            previous: "http://paperless.test/api/documents/?tags__id=1&page=1",
            results: [documentFixture({ id: 2, tags: [1, 2] })],
          }),
        );
      }
      if (tagId === "2") {
        return Promise.resolve(
          jsonResponse({
            count: 2,
            next: null,
            previous: null,
            results: [
              documentFixture({ id: 2, tags: [1, 2] }),
              documentFixture({ id: 3, tags: [2] }),
            ],
          }),
        );
      }
      const correspondentId = url.searchParams.get("correspondent");
      if (correspondentId === "5") {
        return Promise.resolve(
          jsonResponse({
            count: 1,
            next: null,
            previous: null,
            results: [documentFixture({ id: 4, correspondent: 5 })],
          }),
        );
      }
      if (correspondentId === "6") {
        return Promise.resolve(
          jsonResponse({
            count: 1,
            next: null,
            previous: null,
            results: [documentFixture({ id: 5, correspondent: 6 })],
          }),
        );
      }
      const documentTypeId = url.searchParams.get("document_type");
      if (documentTypeId === "7") {
        return Promise.resolve(
          jsonResponse({
            count: 1,
            next: null,
            previous: null,
            results: [documentFixture({ id: 6, document_type: 7 })],
          }),
        );
      }
      if (documentTypeId === "8") {
        return Promise.resolve(
          jsonResponse({
            count: 1,
            next: null,
            previous: null,
            results: [documentFixture({ id: 7, document_type: 8 })],
          }),
        );
      }
      throw new Error(`unexpected tag filter ${tagId}`);
    });
    vi.stubGlobal("fetch", fetchMock);

    const enumerations = await Effect.runPromise(
      Effect.gen(function* () {
        const paperless = yield* PaperlessService;
        const tags = yield* paperless.enumerateTagAssignments(1, 2);
        const correspondents = yield* paperless.enumerateCorrespondentAssignments(5, 6);
        const documentTypes = yield* paperless.enumerateDocumentTypeAssignments(7, 8);
        return { tags, correspondents, documentTypes };
      }).pipe(Effect.provide(createTestLayer())),
    );

    expect(enumerations.tags).toMatchObject({
      kind: "tag",
      xId: 1,
      yId: 2,
      xDocumentIds: [1, 2],
      yDocumentIds: [2, 3],
      xOnlyDocumentIds: [1],
      yOnlyDocumentIds: [3],
      bothDocumentIds: [2],
    });
    expect(enumerations.correspondents).toMatchObject({
      kind: "correspondent",
      xId: 5,
      yId: 6,
      xDocumentIds: [4],
      yDocumentIds: [5],
      xOnlyDocumentIds: [4],
      yOnlyDocumentIds: [5],
      bothDocumentIds: [],
    });
    expect(enumerations.documentTypes).toMatchObject({
      kind: "document_type",
      xId: 7,
      yId: 8,
      xDocumentIds: [6],
      yDocumentIds: [7],
      xOnlyDocumentIds: [6],
      yOnlyDocumentIds: [7],
      bothDocumentIds: [],
    });
  });
});
