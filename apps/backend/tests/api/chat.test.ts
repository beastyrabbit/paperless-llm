import { Effect, Layer } from "effect";
import { describe, expect, it, vi } from "vitest";
import { chatWithDocuments } from "../../src/api/chat/handlers.js";
import { NotFoundError } from "../../src/errors/index.js";
import { DocumentAuthorizationService, OllamaService, QdrantService } from "../../src/services/index.js";


describe("Chat handlers", () => {
  it("does not search the archive for a ping message", async () => {
    const result = await Effect.runPromise(chatWithDocuments([{ role: "user", content: "test" }]));

    expect(result.sources).toEqual([]);
    expect(result.message).toContain("I'm ready");
  });

  it("filters unauthorized Qdrant sources before building a chat response", async () => {
    const chat = vi.fn(() => Effect.succeed({ message: { content: "Found one document." } }));
    const TestLayer = Layer.mergeAll(
      Layer.succeed(QdrantService, {
        searchSimilar: vi.fn(() =>
          Effect.succeed([
            { docId: 1, title: "Allowed", score: 0.9, tags: [] },
            { docId: 2, title: "Denied", score: 0.8, tags: [] },
          ]),
        ),
      } as unknown as QdrantService),
      Layer.succeed(OllamaService, {
        getModel: vi.fn(() => ({ name: "test", options: {} })),
        chat,
      } as unknown as OllamaService),
      Layer.succeed(DocumentAuthorizationService, {
        authorizeDocument: vi.fn((docId: number) =>
          docId === 2
            ? Effect.fail(new NotFoundError({ message: "Document 2 not found", resource: "document", id: 2 }))
            : Effect.void,
        ),
        filterAuthorizedDocuments: (items, getDocId) =>
          Effect.forEach(items, (item) =>
            getDocId(item) === 2 ? Effect.succeed(null) : Effect.succeed(item),
          ).pipe(Effect.map((items) => items.filter((item) => item !== null))),
      } as unknown as DocumentAuthorizationService),
    );

    const result = await Effect.runPromise(
      chatWithDocuments([{ role: "user", content: "find invoice documents" }]).pipe(
        Effect.provide(TestLayer),
      ),
    );

    expect(result.sources.map((source) => source.docId)).toEqual([1]);
    expect(JSON.stringify(chat.mock.calls[0])).not.toContain("Denied");
  });
});
