/**
 * Documents API handlers.
 *
 * Real implementations using PaperlessService.
 */
import { Effect, pipe } from "effect";
import { ConfigService } from "../../config/index.js";
import { DocumentAuthorizationService, PaperlessService } from "../../services/index.js";
import { logger } from "../../utils/logger.js";
import { getCachedQueueStats, getCachedTotalDocumentCount } from "../paperlessStatusCache.js";

const documentsLogger = logger.child({ component: "api_documents" });

// ===========================================================================
// Queue Stats
// ===========================================================================

export const getQueueStats = Effect.gen(function* () {
  const paperless = yield* PaperlessService;
  const emptyStats = {
    todo: 0,
    ocr: 0,
    metadata: 0,
    review: 0,
    index: 0,
    done: 0,
    pending: 0,
    ocrDone: 0,
    titleDone: 0,
    correspondentDone: 0,
    documentTypeDone: 0,
    tagsDone: 0,
    processed: 0,
    failed: 0,
    manualReview: 0,
    total: 0,
  };

  // Fetch queue stats and total document count in parallel
  const [statsResult, totalDocumentsResult] = yield* Effect.all(
    [
      Effect.either(getCachedQueueStats(paperless)),
      Effect.either(getCachedTotalDocumentCount(paperless)),
    ],
    { concurrency: "unbounded" },
  );

  const paperlessErrors: string[] = [];
  const stats =
    statsResult._tag === "Right"
      ? statsResult.right
      : (() => {
          paperlessErrors.push(`queue_stats: ${String(statsResult.left)}`);
          return emptyStats;
        })();
  const totalDocuments =
    totalDocumentsResult._tag === "Right"
      ? totalDocumentsResult.right
      : (() => {
          paperlessErrors.push(`total_documents: ${String(totalDocumentsResult.left)}`);
          return 0;
        })();

  if (paperlessErrors.length > 0) {
    yield* Effect.sync(() => {
      documentsLogger.warn("paperless_queue_stats_unavailable", { errors: paperlessErrors });
    });
  }

  const todo = stats.todo ?? stats.pending;
  const ocr = stats.ocr ?? stats.ocrDone;
  const metadata =
    stats.metadata ?? stats.titleDone + stats.correspondentDone + stats.documentTypeDone;
  const review = stats.review ?? stats.manualReview;
  const index = stats.index ?? stats.tagsDone;
  const done = stats.done ?? stats.processed;

  // PaperlessService returns canonical counts with legacy aliases deduped into each stage.
  const totalInPipeline = todo + ocr + metadata + review + index;

  // Return in format expected by frontend
  return {
    // Fields expected by frontend QueueStats interface
    pending: stats.pending,
    todo,
    ocr,
    metadata,
    review,
    index,
    done,
    ocr_done: stats.ocrDone,
    title_done: stats.titleDone,
    correspondent_done: stats.correspondentDone,
    document_type_done: stats.documentTypeDone,
    tags_done: stats.tagsDone,
    processed: stats.processed,
    total_in_pipeline: totalInPipeline,
    total_documents: totalDocuments, // Actual total from Paperless
    paperless_reachable: paperlessErrors.length === 0,
    status: paperlessErrors.length === 0 ? "ok" : "paperless_unreachable",
    errors: paperlessErrors,
    // Additional fields for compatibility
    failed: stats.failed,
    manual_review: stats.manualReview,
  };
});

// ===========================================================================
// Pending Documents
// ===========================================================================

export const listDocuments = (limit = 50) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const boundedLimit = Math.min(Math.max(Math.trunc(limit), 1), 250);
    const [documents, tags, correspondents] = yield* Effect.all(
      [
        paperless.getDocuments({ page: 1, pageSize: boundedLimit }),
        paperless.getTags(),
        paperless.getCorrespondents(),
      ],
      { concurrency: "unbounded" },
    );
    const tagNames = new Map(tags.map((tag) => [tag.id, tag.name]));
    const correspondentNames = new Map(
      correspondents.map((correspondent) => [correspondent.id, correspondent.name]),
    );
    return documents.map((document) => ({
      id: document.id,
      title: document.title,
      correspondent:
        document.correspondent === null
          ? null
          : (correspondentNames.get(document.correspondent) ?? null),
      created: document.created,
      tags: document.tags
        .map((tagId) => tagNames.get(tagId))
        .filter((name): name is string => name !== undefined),
      processing_status: null,
    }));
  });

export const getPendingDocuments = (tag?: string, limit = 50) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;
    const tagConfig = config.config.tags;
    const uniqueTagNames = (...names: string[]): string[] => [...new Set(names.filter(Boolean))];

    // Determine which tags to fetch based on filter
    // Default (no tag): in-progress only (excludes processed)
    // "all": includes processed
    // specific tag: just that tag
    let tagNames: string[];
    if (tag === "all") {
      // All documents including processed, failed, and manual review
      tagNames = uniqueTagNames(
        tagConfig.todo,
        tagConfig.pending,
        tagConfig.ocr,
        tagConfig.ocrDone,
        tagConfig.metadata,
        tagConfig.summaryDone,
        tagConfig.titleDone,
        tagConfig.correspondentDone,
        tagConfig.documentTypeDone,
        tagConfig.review,
        tagConfig.schemaReview,
        tagConfig.manualReview,
        tagConfig.index,
        tagConfig.tagsDone,
        tagConfig.done,
        tagConfig.processed,
        tagConfig.failed,
      );
    } else if (!tag) {
      // Default: in-progress only (excludes processed, failed, manual review)
      tagNames = uniqueTagNames(
        tagConfig.todo,
        tagConfig.pending,
        tagConfig.ocr,
        tagConfig.ocrDone,
        tagConfig.metadata,
        tagConfig.summaryDone,
        tagConfig.titleDone,
        tagConfig.correspondentDone,
        tagConfig.documentTypeDone,
        tagConfig.review,
        tagConfig.schemaReview,
        tagConfig.index,
        tagConfig.tagsDone,
      );
    } else {
      // Specific tag filter
      tagNames = [tag];
    }

    // Fetch documents and tags in parallel
    const [docs, allTags, allCorrespondents] = yield* Effect.all(
      [
        pipe(
          paperless.getDocumentsByTags(tagNames, limit),
          Effect.catchAll(() => Effect.succeed([])),
        ),
        pipe(
          paperless.getTags(),
          Effect.catchAll(() => Effect.succeed([])),
        ),
        pipe(
          paperless.getCorrespondents(),
          Effect.catchAll(() => Effect.succeed([])),
        ),
      ],
      { concurrency: "unbounded" },
    );

    // Create lookup maps for efficient name resolution
    const tagMap = new Map(allTags.map((t) => [t.id, t.name]));
    const corrMap = new Map(allCorrespondents.map((c) => [c.id, c.name]));

    return docs.map((doc) => {
      // Map tag IDs to names
      const docTagNames = doc.tags
        .map((id) => tagMap.get(id))
        .filter((n): n is string => n !== undefined);
      // Get correspondent name
      const correspondentName = doc.correspondent ? (corrMap.get(doc.correspondent) ?? null) : null;

      return {
        id: doc.id,
        title: doc.title,
        correspondent: correspondentName,
        created: doc.created,
        tags: docTagNames,
        processing_status: getProcessingStatus(docTagNames, tagConfig),
      };
    });
  });

// Helper to determine processing status from tags
const getProcessingStatus = (
  tagNames: string[],
  tagConfig: {
    todo: string;
    ocr: string;
    metadata: string;
    review: string;
    index: string;
    done: string;
    pending: string;
    ocrDone: string;
    summaryDone: string;
    schemaReview: string;
    titleDone: string;
    correspondentDone: string;
    documentTypeDone: string;
    tagsDone: string;
    processed: string;
    failed: string;
    manualReview: string;
  },
): string | null => {
  // Check final/error states first
  if (tagNames.includes(tagConfig.done)) return "done";
  if (tagNames.includes(tagConfig.processed)) return "processed";
  if (tagNames.includes(tagConfig.failed)) return "failed";
  if (tagNames.includes(tagConfig.review)) return "review";
  if (tagNames.includes(tagConfig.manualReview)) return "manual_review";
  const activeProcessingTags = new Set([
    tagConfig.ocr,
    tagConfig.metadata,
    tagConfig.summaryDone,
    tagConfig.index,
  ]);
  if (activeProcessingTags.size === 1 && tagNames.includes(tagConfig.ocr)) return "processing";
  if (tagNames.includes(tagConfig.todo)) return "queued";
  if (tagNames.includes(tagConfig.pending)) return "queued";
  // Check pipeline states in reverse order (most advanced first)
  if (tagNames.includes(tagConfig.index)) return "index";
  if (tagNames.includes(tagConfig.metadata)) return "metadata";
  if (tagNames.includes(tagConfig.ocr)) return "ocr";
  if (tagNames.includes(tagConfig.tagsDone)) return "tags_done";
  if (tagNames.includes(tagConfig.documentTypeDone)) return "document_type_done";
  if (tagNames.includes(tagConfig.correspondentDone)) return "correspondent_done";
  if (tagNames.includes(tagConfig.titleDone)) return "title_done";
  if (tagNames.includes(tagConfig.schemaReview)) return "schema_review";
  if (tagNames.includes(tagConfig.summaryDone)) return "summary_done";
  if (tagNames.includes(tagConfig.ocrDone)) return "ocr_done";
  if (tagNames.includes(tagConfig.pending)) return "pending";
  return null;
};

// ===========================================================================
// Document Details
// ===========================================================================

export const getDocument = (id: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(id, "view");
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;
    const tagConfig = config.config.tags;

    const doc = yield* paperless.getDocument(id);

    const [tagObjects, correspondent, documentType] = yield* Effect.all(
      [
        Effect.forEach(
          doc.tags,
          (tagId) =>
            pipe(
              paperless.getTag(tagId),
              Effect.map((tag) => ({ id: tag.id, name: tag.name, color: tag.color ?? null })),
              Effect.catchAll(() => Effect.succeed(null)),
            ),
          { concurrency: "unbounded" },
        ).pipe(
          Effect.map((tags) =>
            tags.filter(
              (tag): tag is { id: number; name: string; color: string | null } => tag !== null,
            ),
          ),
        ),
        doc.correspondent
          ? pipe(
              paperless.getCorrespondent(doc.correspondent),
              Effect.catchAll(() => Effect.succeed(null)),
            )
          : Effect.succeed(null),
        doc.document_type
          ? pipe(
              paperless.getDocumentType(doc.document_type),
              Effect.catchAll(() => Effect.succeed(null)),
            )
          : Effect.succeed(null),
      ],
      { concurrency: "unbounded" },
    );

    // Get correspondent and document type names
    const correspondentName = correspondent?.name ?? null;
    const documentTypeName = documentType?.name ?? null;

    return {
      id: doc.id,
      title: doc.title,
      content: doc.content ?? "",
      correspondent: correspondentName,
      correspondent_id: doc.correspondent ?? null,
      document_type: documentTypeName,
      document_type_id: doc.document_type ?? null,
      tags: tagObjects,
      processing_status: getProcessingStatus(
        tagObjects.map((tag) => tag.name),
        tagConfig,
      ),
      custom_fields: doc.custom_fields ?? [],
      created: doc.created,
      modified: doc.modified,
      added: doc.added,
      original_file_name: doc.original_file_name ?? null,
      archive_serial_number: doc.archive_serial_number ?? null,
    };
  });

export const getDocumentContent = (id: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(id, "view");
    const paperless = yield* PaperlessService;

    const content = yield* paperless.getDocumentContent(id);

    return {
      id,
      content,
    };
  });

// ===========================================================================
// PDF Download (Binary)
// ===========================================================================

export const getDocumentPdf = (id: number) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(id, "view");
    const paperless = yield* PaperlessService;
    return yield* paperless.downloadPdf(id);
  });

// ===========================================================================
// Admin: Clean up document tags
// ===========================================================================

export const cleanupDocumentTags = (id: number, keepLlmTag?: string) =>
  Effect.gen(function* () {
    const auth = yield* DocumentAuthorizationService;
    yield* auth.authorizeDocument(id, "change");
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;
    const tagConfig = config.config.tags;

    // Get the document and all tags
    const [doc, allTags] = yield* Effect.all([paperless.getDocument(id), paperless.getTags()], {
      concurrency: "unbounded",
    });

    const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));
    const tagIdByName = new Map(allTags.map((t) => [t.name, t.id]));

    // Get current tag names
    const currentTagNames = doc.tags
      .map((id) => tagNameById.get(id))
      .filter((n): n is string => n !== undefined);
    const llmTags = currentTagNames.filter((n) => n.startsWith("llm-"));

    // Determine which llm tag to keep (default: llm-done if present, otherwise none)
    const targetTagName =
      keepLlmTag ?? (currentTagNames.includes(tagConfig.processed) ? tagConfig.processed : null);
    const targetTagId = targetTagName ? tagIdByName.get(targetTagName) : null;

    // Filter: keep non-llm tags + optionally the target llm tag
    const newTagIds = doc.tags.filter((id) => {
      const name = tagNameById.get(id);
      if (!name?.startsWith("llm-")) return true; // Keep non-llm tags
      return targetTagId != null && id === targetTagId; // Keep only target llm tag
    });

    // Compute actual kept llm tag based on what's in the result
    const actualKeptLlmTag =
      targetTagId != null && newTagIds.includes(targetTagId) ? targetTagName : null;
    const removedTags = llmTags.filter((n) => n !== actualKeptLlmTag);

    // Update if changed
    if (newTagIds.length !== doc.tags.length) {
      yield* paperless.updateDocument(id, { tags: newTagIds });
      return {
        success: true,
        docId: id,
        removedTags,
        keptLlmTag: actualKeptLlmTag,
        message: `Removed ${removedTags.length} extra llm tags`,
      };
    }

    return {
      success: true,
      docId: id,
      removedTags: [],
      keptLlmTag: actualKeptLlmTag,
      message: "No changes needed",
    };
  });
