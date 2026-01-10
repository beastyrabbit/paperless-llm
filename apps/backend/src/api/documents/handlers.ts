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

  const stats = yield* pipe(
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
  );

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
    total_documents: stats.total + stats.processed, // Total includes processed docs
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
      // All documents including processed
      tagNames = [
        tagConfig.pending,
        tagConfig.ocrDone,
        tagConfig.titleDone,
        tagConfig.correspondentDone,
        tagConfig.documentTypeDone,
        tagConfig.tagsDone,
        tagConfig.processed,
      ];
    } else if (!tag) {
      // Default: in-progress only (excludes processed)
      tagNames = [
        tagConfig.pending,
        tagConfig.ocrDone,
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
  tagConfig: { pending: string; ocrDone: string; titleDone: string; correspondentDone: string; documentTypeDone: string; tagsDone: string; processed: string }
): string | null => {
  if (tagNames.includes(tagConfig.processed)) return 'processed';
  if (tagNames.includes(tagConfig.tagsDone)) return 'tags_done';
  if (tagNames.includes(tagConfig.documentTypeDone)) return 'document_type_done';
  if (tagNames.includes(tagConfig.correspondentDone)) return 'correspondent_done';
  if (tagNames.includes(tagConfig.titleDone)) return 'title_done';
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
