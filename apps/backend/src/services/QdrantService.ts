/**
 * Qdrant vector database service for semantic search.
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import { Context, Effect, Layer, pipe } from "effect";
import { ConfigService } from "../config/index.js";
import { withClientSpan } from "../observability/tracing.js";
import { OllamaService } from "./OllamaService.js";

// ===========================================================================
// Types
// ===========================================================================

export interface QdrantError {
  readonly _tag: "QdrantError";
  readonly message: string;
  readonly cause?: unknown;
}

export const QdrantError = (message: string, cause?: unknown): QdrantError => ({
  _tag: "QdrantError",
  message,
  cause,
});

export interface DocumentVector {
  docId: number;
  title: string;
  content: string;
  tags: string[];
  correspondent?: string;
  documentType?: string;
}

export interface SearchResult {
  docId: number;
  score: number;
  title: string;
  tags: string[];
  correspondent?: string;
  documentType?: string;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface QdrantService {
  /**
   * Search for similar documents using semantic search
   */
  readonly searchSimilar: (
    query: string,
    options?: {
      limit?: number;
      filterProcessed?: boolean;
      filterByTag?: string;
      filterByCorrespondent?: string;
      filterByDocumentType?: string;
    },
  ) => Effect.Effect<SearchResult[], QdrantError>;

  /**
   * Add or update a document in the vector store
   */
  readonly upsertDocument: (doc: DocumentVector) => Effect.Effect<void, QdrantError>;

  /**
   * Delete a document from the vector store
   */
  readonly deleteDocument: (docId: number) => Effect.Effect<void, QdrantError>;

  /**
   * Test connection to Qdrant
   */
  readonly testConnection: () => Effect.Effect<boolean, QdrantError>;

  /**
   * Ensure collection exists with proper schema
   */
  readonly ensureCollection: () => Effect.Effect<void, QdrantError>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const QdrantService = Context.GenericTag<QdrantService>("QdrantService");

// ===========================================================================
// Live Implementation
// ===========================================================================

export const QdrantServiceLive = Layer.effect(
  QdrantService,
  Effect.gen(function* () {
    const configService = yield* ConfigService;
    const ollamaService = yield* OllamaService;
    const { qdrant: configQdrant } = configService.config;

    // Provider connection, collection, and vector shape are immutable startup
    // configuration. Reading stale TinyBase values here can silently point the
    // runtime at another collection.
    const getConfig = () =>
      Effect.succeed({
        url: configQdrant.url,
        collectionName: configQdrant.collectionName,
        embeddingDimension: configQdrant.embeddingDimension,
      });

    // Create Qdrant client lazily
    const getClient = () =>
      Effect.gen(function* () {
        const { url } = yield* getConfig();
        return new QdrantClient({ url });
      });

    // Generate embedding for text
    const embed = (text: string) => ollamaService.embed(text);

    return {
      searchSimilar: (query, options = {}) =>
        pipe(
          Effect.gen(function* () {
            const {
              limit = 5,
              filterProcessed = true,
              filterByTag,
              filterByCorrespondent,
              filterByDocumentType,
            } = options;
            const { collectionName } = yield* getConfig();
            const client = yield* getClient();

            // Generate embedding for query
            const queryVector = yield* embed(query).pipe(
              Effect.mapError((e) => QdrantError(`Embedding failed: ${e.message}`, e)),
            );

            // Build filter conditions
            const mustConditions: Array<{ key: string; match: { value: string | boolean } }> = [];

            if (filterProcessed) {
              mustConditions.push({ key: "is_processed", match: { value: true } });
            }
            if (filterByTag) {
              mustConditions.push({ key: "tags", match: { value: filterByTag } });
            }
            if (filterByCorrespondent) {
              mustConditions.push({
                key: "correspondent",
                match: { value: filterByCorrespondent },
              });
            }
            if (filterByDocumentType) {
              mustConditions.push({ key: "document_type", match: { value: filterByDocumentType } });
            }

            return yield* Effect.tryPromise({
              try: async () => {
                const results = await client.search(collectionName, {
                  vector: queryVector,
                  limit,
                  filter: mustConditions.length > 0 ? { must: mustConditions } : undefined,
                  with_payload: true,
                });

                return results.map((r) => ({
                  docId: r.payload?.docId as number,
                  score: r.score,
                  title: (r.payload?.title as string) ?? "",
                  tags: (r.payload?.tags as string[]) ?? [],
                  correspondent: r.payload?.correspondent as string | undefined,
                  documentType: r.payload?.document_type as string | undefined,
                }));
              },
              catch: (error) => QdrantError(`Search failed: ${String(error)}`, error),
            });
          }),
          withClientSpan("qdrant.search", {
            "peer.service": "qdrant",
            limit: options.limit ?? 5,
            has_filters: Boolean(
              options.filterByTag || options.filterByCorrespondent || options.filterByDocumentType,
            ),
          }),
        ),

      upsertDocument: (doc) =>
        pipe(
          Effect.gen(function* () {
            const { collectionName } = yield* getConfig();
            const client = yield* getClient();

            // Generate embedding for document content
            const vector = yield* embed(doc.content.slice(0, 8000)).pipe(
              Effect.mapError((e) => QdrantError(`Embedding failed: ${e.message}`, e)),
            );

            yield* Effect.tryPromise({
              try: async () => {
                await client.upsert(collectionName, {
                  wait: true,
                  points: [
                    {
                      id: doc.docId,
                      vector,
                      payload: {
                        docId: doc.docId,
                        title: doc.title,
                        tags: doc.tags,
                        correspondent: doc.correspondent,
                        document_type: doc.documentType,
                        is_processed: doc.tags.some((t) => t.toLowerCase().includes("processed")),
                      },
                    },
                  ],
                });
              },
              catch: (error) => QdrantError(`Upsert failed: ${String(error)}`, error),
            });
          }),
          withClientSpan("qdrant.upsert", {
            "peer.service": "qdrant",
            "doc.id": doc.docId,
          }),
        ),

      deleteDocument: (docId) =>
        pipe(
          Effect.gen(function* () {
            const { collectionName } = yield* getConfig();
            const client = yield* getClient();

            yield* Effect.tryPromise({
              try: async () => {
                await client.delete(collectionName, {
                  wait: true,
                  points: [docId],
                });
              },
              catch: (error) => QdrantError(`Delete failed: ${String(error)}`, error),
            });
          }),
          withClientSpan("qdrant.delete", { "peer.service": "qdrant", "doc.id": docId }),
        ),

      testConnection: () =>
        Effect.gen(function* () {
          const client = yield* getClient();

          return yield* Effect.tryPromise({
            try: async () => {
              await client.getCollections();
              return true;
            },
            catch: () => false,
          }).pipe(Effect.catchAll(() => Effect.succeed(false)));
        }),

      ensureCollection: () =>
        pipe(
          Effect.gen(function* () {
            const { collectionName, embeddingDimension } = yield* getConfig();
            const client = yield* getClient();

            yield* Effect.tryPromise({
              try: async () => {
                const collections = await client.getCollections();
                const exists = collections.collections.some((c) => c.name === collectionName);

                if (!exists) {
                  // Create collection with vector size matching configured embedding model
                  await client.createCollection(collectionName, {
                    vectors: {
                      size: embeddingDimension,
                      distance: "Cosine",
                    },
                  });

                  // Create payload indexes for filtering
                  await client.createPayloadIndex(collectionName, {
                    field_name: "is_processed",
                    field_schema: "bool",
                  });
                  await client.createPayloadIndex(collectionName, {
                    field_name: "tags",
                    field_schema: "keyword",
                  });
                  await client.createPayloadIndex(collectionName, {
                    field_name: "correspondent",
                    field_schema: "keyword",
                  });
                  await client.createPayloadIndex(collectionName, {
                    field_name: "document_type",
                    field_schema: "keyword",
                  });
                }
              },
              catch: (error) => QdrantError(`Collection setup failed: ${String(error)}`, error),
            });
          }),
          withClientSpan("qdrant.ensure_collection", { "peer.service": "qdrant" }),
        ),
    };
  }),
);
