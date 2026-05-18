/**
 * Search API handlers for semantic document search.
 */
import { Effect } from "effect";
import { DocumentAuthorizationService } from "../../services/DocumentAuthorizationService.js";
import { PaperlessService } from "../../services/PaperlessService.js";
import { QdrantService } from "../../services/QdrantService.js";
import { logger } from "../../utils/logger.js";

const searchLogger = logger.child({ component: "api_search" });

/**
 * Search documents using semantic vector search.
 */
export const searchDocuments = (query: string, limit?: number) =>
  Effect.gen(function* () {
    if (!query || query.trim().length === 0) {
      return { results: [], query: "", total: 0 };
    }

    const auth = yield* DocumentAuthorizationService;
    const qdrant = yield* QdrantService;
    const results = yield* qdrant
      .searchSimilar(query, {
        limit: limit ?? 10,
        filterProcessed: false, // Search all documents, not just processed ones
      })
      .pipe(
        Effect.catchAll((e) => {
          searchLogger.warn("qdrant_search_failed", { error: e });
          // Return empty results on error instead of failing
          return Effect.succeed([]);
        }),
      );

    const authorizedResults = yield* auth.filterAuthorizedDocuments(
      results,
      (result) => result.docId,
      "view",
    );

    return {
      results: authorizedResults,
      query,
      total: authorizedResults.length,
    };
  });

/**
 * Index a single document into the vector database.
 */
export const indexDocument = (docId: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(docId, "view");
    const qdrant = yield* QdrantService;
    const paperless = yield* PaperlessService;

    // Get document details
    const doc = yield* paperless
      .getDocument(docId)
      .pipe(Effect.catchAll((e) => Effect.fail(new Error(`Failed to get document: ${e}`))));

    // Get all tags, correspondents, document types for metadata
    const [allTags, allCorrespondents, allDocTypes] = yield* Effect.all([
      paperless.getTags().pipe(Effect.catchAll(() => Effect.succeed([]))),
      paperless.getCorrespondents().pipe(Effect.catchAll(() => Effect.succeed([]))),
      paperless.getDocumentTypes().pipe(Effect.catchAll(() => Effect.succeed([]))),
    ]);

    const tagMap = new Map(allTags.map((t) => [t.id, t.name]));
    const corrMap = new Map(allCorrespondents.map((c) => [c.id, c.name]));
    const typeMap = new Map(allDocTypes.map((dt) => [dt.id, dt.name]));

    const tagNames = (doc.tags ?? []).map((id) => tagMap.get(id)).filter((n): n is string => !!n);
    const correspondent = doc.correspondent ? corrMap.get(doc.correspondent) : undefined;
    const documentType = doc.document_type ? typeMap.get(doc.document_type) : undefined;

    // Index into Qdrant
    yield* qdrant
      .upsertDocument({
        docId: doc.id,
        title: doc.title,
        content: doc.content ?? "",
        tags: tagNames,
        correspondent,
        documentType,
      })
      .pipe(
        Effect.catchAll((e) => {
          const msg =
            e && typeof e === "object" && "message" in e
              ? (e as { message: string }).message
              : String(e);
          return Effect.fail(new Error(`Failed to index: ${msg}`));
        }),
      );

    return {
      success: true,
      docId: doc.id,
      title: doc.title,
      message: `Document ${doc.id} indexed successfully`,
    };
  }).pipe(
    Effect.catchAll((e) => {
      const msg = e instanceof Error ? e.message : String(e);
      return Effect.succeed({
        success: false,
        docId,
        error: msg,
      });
    }),
  );
