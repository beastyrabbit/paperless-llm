/**
 * Search API handlers for semantic document search.
 */
import { Effect } from 'effect';
import { QdrantService } from '../../services/QdrantService.js';
import { PaperlessService } from '../../services/PaperlessService.js';

/**
 * Search documents using semantic vector search.
 */
export const searchDocuments = (query: string, limit?: number) =>
  Effect.gen(function* () {
    if (!query || query.trim().length === 0) {
      return { results: [], query: '', total: 0 };
    }

    const qdrant = yield* QdrantService;
    const results = yield* qdrant.searchSimilar(query, {
      limit: limit ?? 10,
      filterProcessed: false, // Search all documents, not just processed ones
    }).pipe(
      Effect.catchAll((e) => {
        // Log the error for debugging
        console.error('[Search] Qdrant search failed:', e);
        // Return empty results on error instead of failing
        return Effect.succeed([]);
      })
    );

    return {
      results,
      query,
      total: results.length,
    };
  });

/**
 * Index a single document into the vector database.
 */
export const indexDocument = (docId: number) =>
  Effect.gen(function* () {
    const qdrant = yield* QdrantService;
    const paperless = yield* PaperlessService;

    // Get document details
    const doc = yield* paperless.getDocument(docId).pipe(
      Effect.catchAll((e) => Effect.fail(new Error(`Failed to get document: ${e}`)))
    );

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
    yield* qdrant.upsertDocument({
      docId: doc.id,
      title: doc.title,
      content: doc.content ?? '',
      tags: tagNames,
      correspondent,
      documentType,
    }).pipe(
      Effect.catchAll((e) => {
        const msg = e && typeof e === 'object' && 'message' in e ? (e as {message: string}).message : String(e);
        return Effect.fail(new Error(`Failed to index: ${msg}`));
      })
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
    })
  );
