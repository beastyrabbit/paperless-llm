/**
 * Documents API handlers.
 *
 * Real implementations using PaperlessService.
 */
import { Effect, pipe } from 'effect';
import { PaperlessService } from '../../services/index.js';
import { ConfigService } from '../../config/index.js';

// ===========================================================================
// Queue Stats
// ===========================================================================

export const getQueueStats = Effect.gen(function* () {
  const paperless = yield* PaperlessService;

  // Fetch queue stats and total document count in parallel
  const [stats, totalDocuments] = yield* Effect.all([
    pipe(
      paperless.getQueueStats(),
      Effect.catchAll(() =>
        Effect.succeed({
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
        })
      )
    ),
    pipe(
      paperless.getTotalDocumentCount(),
      Effect.catchAll(() => Effect.succeed(0))
    ),
  ], { concurrency: 'unbounded' });

  // Calculate pipeline total (all stages except processed)
  const totalInPipeline = stats.pending + stats.ocrDone + stats.titleDone +
    stats.correspondentDone + stats.documentTypeDone + stats.tagsDone;

  // Return in format expected by frontend
  return {
    // Fields expected by frontend QueueStats interface
    pending: stats.pending,
    ocr_done: stats.ocrDone,
    title_done: stats.titleDone,
    correspondent_done: stats.correspondentDone,
    document_type_done: stats.documentTypeDone,
    tags_done: stats.tagsDone,
    processed: stats.processed,
    total_in_pipeline: totalInPipeline,
    total_documents: totalDocuments, // Actual total from Paperless
    // Additional fields for compatibility
    failed: stats.failed,
    manual_review: stats.manualReview,
  };
});

// ===========================================================================
// Pending Documents
// ===========================================================================

export const getPendingDocuments = (tag?: string, limit = 50) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;
    const tagConfig = config.config.tags;

    // Determine which tags to fetch based on filter
    // Default (no tag): in-progress only (excludes processed)
    // "all": includes processed
    // specific tag: just that tag
    let tagNames: string[];
    if (tag === 'all') {
      // All documents including processed, failed, and manual review
      tagNames = [
        tagConfig.pending,
        tagConfig.ocrDone,
        tagConfig.summaryDone,
        tagConfig.schemaReview,
        tagConfig.titleDone,
        tagConfig.correspondentDone,
        tagConfig.documentTypeDone,
        tagConfig.tagsDone,
        tagConfig.processed,
        tagConfig.failed,
        tagConfig.manualReview,
      ];
    } else if (!tag) {
      // Default: in-progress only (excludes processed, failed, manual review)
      tagNames = [
        tagConfig.pending,
        tagConfig.ocrDone,
        tagConfig.summaryDone,
        tagConfig.schemaReview,
        tagConfig.titleDone,
        tagConfig.correspondentDone,
        tagConfig.documentTypeDone,
        tagConfig.tagsDone,
      ];
    } else {
      // Specific tag filter
      tagNames = [tag];
    }

    // Fetch documents and tags in parallel
    const [docs, allTags, allCorrespondents] = yield* Effect.all([
      pipe(
        paperless.getDocumentsByTags(tagNames, limit),
        Effect.catchAll(() => Effect.succeed([]))
      ),
      pipe(
        paperless.getTags(),
        Effect.catchAll(() => Effect.succeed([]))
      ),
      pipe(
        paperless.getCorrespondents(),
        Effect.catchAll(() => Effect.succeed([]))
      ),
    ], { concurrency: 'unbounded' });

    // Create lookup maps for efficient name resolution
    const tagMap = new Map(allTags.map((t) => [t.id, t.name]));
    const corrMap = new Map(allCorrespondents.map((c) => [c.id, c.name]));

    return docs.map((doc) => {
      // Map tag IDs to names
      const docTagNames = doc.tags.map((id) => tagMap.get(id)).filter((n): n is string => n !== undefined);
      // Get correspondent name
      const correspondentName = doc.correspondent ? corrMap.get(doc.correspondent) ?? null : null;

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
  }
): string | null => {
  // Check final/error states first
  if (tagNames.includes(tagConfig.processed)) return 'processed';
  if (tagNames.includes(tagConfig.failed)) return 'failed';
  if (tagNames.includes(tagConfig.manualReview)) return 'manual_review';
  // Check pipeline states in reverse order (most advanced first)
  if (tagNames.includes(tagConfig.tagsDone)) return 'tags_done';
  if (tagNames.includes(tagConfig.documentTypeDone)) return 'document_type_done';
  if (tagNames.includes(tagConfig.correspondentDone)) return 'correspondent_done';
  if (tagNames.includes(tagConfig.titleDone)) return 'title_done';
  if (tagNames.includes(tagConfig.schemaReview)) return 'schema_review';
  if (tagNames.includes(tagConfig.summaryDone)) return 'summary_done';
  if (tagNames.includes(tagConfig.ocrDone)) return 'ocr_done';
  if (tagNames.includes(tagConfig.pending)) return 'pending';
  return null;
};

// ===========================================================================
// Document Details
// ===========================================================================

export const getDocument = (id: number) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;

    // Fetch document and metadata in parallel
    const [doc, allTags, allCorrespondents, allDocTypes] = yield* Effect.all([
      paperless.getDocument(id),
      pipe(paperless.getTags(), Effect.catchAll(() => Effect.succeed([]))),
      pipe(paperless.getCorrespondents(), Effect.catchAll(() => Effect.succeed([]))),
      pipe(paperless.getDocumentTypes(), Effect.catchAll(() => Effect.succeed([]))),
    ], { concurrency: 'unbounded' });

    // Map tag IDs to tag objects with id and name
    const tagObjects = doc.tags
      .map((tagId) => {
        const tag = allTags.find((t) => t.id === tagId);
        return tag ? { id: tag.id, name: tag.name, color: tag.color ?? null } : null;
      })
      .filter((t): t is { id: number; name: string; color: string | null } => t !== null);

    // Get correspondent and document type names
    const correspondentName = doc.correspondent
      ? allCorrespondents.find((c) => c.id === doc.correspondent)?.name ?? null
      : null;
    const documentTypeName = doc.document_type
      ? allDocTypes.find((t) => t.id === doc.document_type)?.name ?? null
      : null;

    return {
      id: doc.id,
      title: doc.title,
      content: doc.content ?? '',
      correspondent: correspondentName,
      correspondent_id: doc.correspondent ?? null,
      document_type: documentTypeName,
      document_type_id: doc.document_type ?? null,
      tags: tagObjects,
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
    const paperless = yield* PaperlessService;
    return yield* paperless.downloadPdf(id);
  });

// ===========================================================================
// Admin: Clean up document tags
// ===========================================================================

export const cleanupDocumentTags = (id: number, keepLlmTag?: string) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;
    const tagConfig = config.config.tags;

    // Get the document and all tags
    const [doc, allTags] = yield* Effect.all([
      paperless.getDocument(id),
      paperless.getTags(),
    ], { concurrency: 'unbounded' });

    const tagNameById = new Map(allTags.map((t) => [t.id, t.name]));
    const tagIdByName = new Map(allTags.map((t) => [t.name, t.id]));

    // Get current tag names
    const currentTagNames = doc.tags.map((id) => tagNameById.get(id)).filter((n): n is string => n !== undefined);
    const llmTags = currentTagNames.filter((n) => n.startsWith('llm-'));

    // Determine which llm tag to keep (default: llm-processed if present, otherwise none)
    const targetTagName = keepLlmTag ?? (currentTagNames.includes(tagConfig.processed) ? tagConfig.processed : null);
    const targetTagId = targetTagName ? tagIdByName.get(targetTagName) : null;

    // Filter: keep non-llm tags + optionally the target llm tag
    const newTagIds = doc.tags.filter((id) => {
      const name = tagNameById.get(id);
      if (!name?.startsWith('llm-')) return true; // Keep non-llm tags
      return targetTagId != null && id === targetTagId; // Keep only target llm tag
    });

    // Compute actual kept llm tag based on what's in the result
    const actualKeptLlmTag = targetTagId != null && newTagIds.includes(targetTagId) ? targetTagName : null;
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
      message: 'No changes needed',
    };
  });
