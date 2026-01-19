/**
 * Pending reviews API handlers.
 */
import { Effect, pipe, Option } from 'effect';
import { TinyBaseService, PaperlessService, ConfigService } from '../../services/index.js';
import { NotFoundError, ValidationError } from '../../errors/index.js';
import type {
  PendingItem,
  ApproveRequest,
  RejectRequest,
  SimilarGroup,
  MergeRequest,
  BulkActionRequest,
} from './api.js';

// ===========================================================================
// List Pending Items
// ===========================================================================

export const listPendingItems = (type?: string) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const items = yield* tinybase.getPendingReviews(type);

    return items.map((item): PendingItem => ({
      id: item.id,
      docId: item.docId,
      docTitle: item.docTitle,
      type: item.type,
      suggestion: item.suggestion,
      reasoning: item.reasoning,
      alternatives: item.alternatives,
      attempts: item.attempts,
      lastFeedback: item.lastFeedback,
      createdAt: item.createdAt,
    }));
  });

// ===========================================================================
// Get Pending Counts
// ===========================================================================

export const getPendingCounts = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  return yield* tinybase.getPendingCounts();
});

// ===========================================================================
// Get Single Pending Item
// ===========================================================================

export const getPendingItem = (id: string) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const item = yield* tinybase.getPendingReview(id);

    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Pending item '${id}' not found`,
          resource: 'pending',
          id,
        })
      );
    }

    return item;
  });

// ===========================================================================
// Approve Pending Item
// ===========================================================================

export const approvePendingItem = (id: string, request: ApproveRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;

    const item = yield* tinybase.getPendingReview(id);
    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Pending item '${id}' not found`,
          resource: 'pending',
          id,
        })
      );
    }

    const value = request.value ?? item.suggestion;

    // Apply the change based on type
    switch (item.type) {
      case 'correspondent': {
        const corrId = yield* paperless.getOrCreateCorrespondent(value);
        yield* paperless.updateDocument(item.docId, { correspondent: corrId });
        break;
      }
      case 'document_type': {
        const typeId = yield* paperless.getOrCreateDocumentType(value);
        yield* paperless.updateDocument(item.docId, { document_type: typeId });
        break;
      }
      case 'tag': {
        yield* paperless.addTagToDocument(item.docId, value);
        break;
      }
      case 'title': {
        yield* paperless.updateDocument(item.docId, { title: value });
        break;
      }
      case 'documentlink': {
        // Parse metadata to get the target document ID and field ID
        let metadata: Record<string, unknown> = {};
        try {
          metadata = item.metadata ? JSON.parse(item.metadata) : {};
        } catch {
          // Malformed metadata, skip processing
          break;
        }
        const targetDocId = metadata.targetDocId as number | undefined;
        const fieldId = metadata.fieldId as number | undefined;

        if (targetDocId && fieldId) {
          // Get current document custom fields
          const doc = yield* paperless.getDocument(item.docId);
          const currentFields = (doc.custom_fields ?? []) as Array<{
            field: number;
            value: unknown;
          }>;

          // Find or create the field entry
          const existingField = currentFields.find((cf) => cf.field === fieldId);
          const existingLinks = Array.isArray(existingField?.value)
            ? (existingField.value as number[])
            : [];

          // Add the new link if not already present
          if (!existingLinks.includes(targetDocId)) {
            const newLinks = [...existingLinks, targetDocId];
            const newCustomFields = currentFields.filter((cf) => cf.field !== fieldId);
            newCustomFields.push({
              field: fieldId,
              value: newLinks,
            });

            yield* paperless.updateDocument(item.docId, {
              custom_fields: newCustomFields,
            });
          }
        }
        break;
      }
      case 'schema_merge':
      case 'schema_delete':
        // These are handled separately
        break;
    }

    // Move to next tag if specified
    if (item.nextTag) {
      yield* paperless.addTagToDocument(item.docId, item.nextTag);
    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true };
  });

// ===========================================================================
// Reject Pending Item
// ===========================================================================

export const rejectPendingItem = (id: string, request: RejectRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;

    const item = yield* tinybase.getPendingReview(id);
    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Pending item '${id}' not found`,
          resource: 'pending',
          id,
        })
      );
    }

    // Block globally if requested
    if (request.blockGlobally) {
      yield* tinybase.addBlockedSuggestion({
        suggestionName: item.suggestion,
        blockType: request.category === 'wrong_suggestion' ? 'global' : item.type as any,
        rejectionReason: request.feedback ?? null,
        rejectionCategory: request.category as any ?? null,
        docId: item.docId,
      });
    }

    // Move document to manual review tag
    yield* paperless.addTagToDocument(item.docId, config.config.tags.manualReview);

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true };
  });

// ===========================================================================
// Get Similar Items
// ===========================================================================

interface MutableSimilarGroup {
  normalizedName: string;
  items: Array<{
    id: string;
    suggestion: string;
    type: string;
    docId: number;
    docTitle: string;
  }>;
  count: number;
}

export const getSimilarItems = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  const items = yield* tinybase.getPendingReviews();

  // Group by normalized suggestion name
  const groups = new Map<string, MutableSimilarGroup>();

  for (const item of items) {
    const normalized = item.suggestion.toLowerCase().trim();
    const existing = groups.get(normalized);

    if (existing) {
      existing.items.push({
        id: item.id,
        suggestion: item.suggestion,
        type: item.type,
        docId: item.docId,
        docTitle: item.docTitle,
      });
      existing.count++;
    } else {
      groups.set(normalized, {
        normalizedName: normalized,
        items: [
          {
            id: item.id,
            suggestion: item.suggestion,
            type: item.type,
            docId: item.docId,
            docTitle: item.docTitle,
          },
        ],
        count: 1,
      });
    }
  }

  // Return only groups with multiple items
  return Array.from(groups.values()).filter((g) => g.count > 1);
});

// ===========================================================================
// Merge Similar Items
// ===========================================================================

export const mergeSimilarItems = (request: MergeRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    let merged = 0;

    for (const id of request.ids) {
      const item = yield* tinybase.getPendingReview(id);
      if (!item) continue;

      // Apply the target value
      switch (item.type) {
        case 'correspondent': {
          const corrId = yield* paperless.getOrCreateCorrespondent(request.targetValue);
          yield* paperless.updateDocument(item.docId, { correspondent: corrId });
          break;
        }
        case 'document_type': {
          const typeId = yield* paperless.getOrCreateDocumentType(request.targetValue);
          yield* paperless.updateDocument(item.docId, { document_type: typeId });
          break;
        }
        case 'tag': {
          yield* paperless.addTagToDocument(item.docId, request.targetValue);
          break;
        }
        case 'title': {
          yield* paperless.updateDocument(item.docId, { title: request.targetValue });
          break;
        }
      }

      // Move to next tag if specified
      if (item.nextTag) {
        yield* paperless.addTagToDocument(item.docId, item.nextTag);
      }

      // Remove the pending item
      yield* tinybase.removePendingReview(id);
      merged++;
    }

    return { merged };
  });

// ===========================================================================
// Bulk Action
// ===========================================================================

export const bulkAction = (request: BulkActionRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;

    let processed = 0;
    let failed = 0;

    for (const id of request.ids) {
      const item = yield* tinybase.getPendingReview(id);
      if (!item) {
        failed++;
        continue;
      }

      if (request.action === 'approve') {
        const value = request.targetValue ?? item.suggestion;

        switch (item.type) {
          case 'correspondent': {
            const corrId = yield* paperless.getOrCreateCorrespondent(value);
            yield* paperless.updateDocument(item.docId, { correspondent: corrId });
            break;
          }
          case 'document_type': {
            const typeId = yield* paperless.getOrCreateDocumentType(value);
            yield* paperless.updateDocument(item.docId, { document_type: typeId });
            break;
          }
          case 'tag': {
            yield* paperless.addTagToDocument(item.docId, value);
            break;
          }
          case 'title': {
            yield* paperless.updateDocument(item.docId, { title: value });
            break;
          }
          case 'documentlink': {
            // Handle documentlink approval same as single approval
            let metadata: Record<string, unknown> = {};
            try {
              metadata = item.metadata ? JSON.parse(item.metadata) : {};
            } catch {
              // Malformed metadata, skip processing
              break;
            }
            const targetDocId = metadata.targetDocId as number | undefined;
            const fieldId = metadata.fieldId as number | undefined;

            if (targetDocId && fieldId) {
              const doc = yield* paperless.getDocument(item.docId);
              const currentFields = (doc.custom_fields ?? []) as Array<{
                field: number;
                value: unknown;
              }>;

              const existingField = currentFields.find((cf) => cf.field === fieldId);
              const existingLinks = Array.isArray(existingField?.value)
                ? (existingField.value as number[])
                : [];

              if (!existingLinks.includes(targetDocId)) {
                const newLinks = [...existingLinks, targetDocId];
                const newCustomFields = currentFields.filter((cf) => cf.field !== fieldId);
                newCustomFields.push({
                  field: fieldId,
                  value: newLinks,
                });

                yield* paperless.updateDocument(item.docId, {
                  custom_fields: newCustomFields,
                });
              }
            }
            break;
          }
        }

        if (item.nextTag) {
          yield* paperless.addTagToDocument(item.docId, item.nextTag);
        }
      } else {
        // Reject
        if (request.blockGlobally) {
          yield* tinybase.addBlockedSuggestion({
            suggestionName: item.suggestion,
            blockType: 'global',
            rejectionReason: request.feedback ?? null,
            rejectionCategory: request.category as any ?? null,
            docId: item.docId,
          });
        }

        yield* paperless.addTagToDocument(item.docId, config.config.tags.manualReview);
      }

      yield* tinybase.removePendingReview(id);
      processed++;
    }

    return { processed, failed };
  });

// ===========================================================================
// Reject With Feedback
// ===========================================================================

interface RejectWithFeedbackRequest {
  feedback?: string;
  category?: string;
  block_type?: string;
  // Alternative field names for API consistency
  rejection_reason?: string;
  rejection_category?: string;
}

export const rejectWithFeedback = (id: string, request: RejectWithFeedbackRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const config = yield* ConfigService;

    const item = yield* tinybase.getPendingReview(id);
    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Pending item '${id}' not found`,
          resource: 'pending',
          id,
        })
      );
    }

    // Add feedback to blocked suggestions if block_type is provided
    // Support both field naming conventions (feedback/category and rejection_reason/rejection_category)
    if (request.block_type) {
      yield* tinybase.addBlockedSuggestion({
        suggestionName: item.suggestion,
        blockType: request.block_type as any,
        rejectionReason: request.rejection_reason ?? request.feedback ?? null,
        rejectionCategory: (request.rejection_category ?? request.category) as any ?? null,
        docId: item.docId,
      });
    }

    // Move document to manual review tag
    yield* paperless.addTagToDocument(item.docId, config.config.tags.manualReview);

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true, blocked: !!request.block_type };
  });

// ===========================================================================
// Search Entities
// ===========================================================================

export const getSearchEntities = pipe(
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;

    const [correspondents, tags, documentTypes] = yield* Effect.all([
      pipe(paperless.getCorrespondents(), Effect.catchAll(() => Effect.succeed([]))),
      pipe(paperless.getTags(), Effect.catchAll(() => Effect.succeed([]))),
      pipe(paperless.getDocumentTypes(), Effect.catchAll(() => Effect.succeed([]))),
    ]);

    return {
      correspondents: correspondents.map((c) => ({ id: c.id, name: c.name })),
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      document_types: documentTypes.map((dt) => ({ id: dt.id, name: dt.name })),
    };
  }),
  // Return empty arrays if PaperlessService is not configured
  Effect.catchAll(() => Effect.succeed({
    correspondents: [],
    tags: [],
    document_types: [],
  }))
);

// ===========================================================================
// Blocked Items
// ===========================================================================

export const getBlocked = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  const blocked = yield* tinybase.getBlockedSuggestions();

  return {
    items: blocked.map((b) => ({
      id: b.id,
      name: b.suggestionName,
      block_type: b.blockType,
      reason: b.rejectionReason,
      category: b.rejectionCategory,
      created_at: b.createdAt,
    })),
  };
});

export const unblockItem = (blockId: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    yield* tinybase.removeBlockedSuggestion(blockId);

    return { success: true, unblocked_id: blockId };
  });

// ===========================================================================
// Add Blocked Suggestion (for seeding training data)
// ===========================================================================

interface AddBlockedSuggestionRequest {
  name: string;
  block_type: string;
  rejection_reason?: string;
  rejection_category?: string;
}

export const addBlockedSuggestion = (request: AddBlockedSuggestionRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    const id = yield* tinybase.addBlockedSuggestion({
      suggestionName: request.name,
      blockType: request.block_type as any,
      rejectionReason: request.rejection_reason ?? null,
      rejectionCategory: request.rejection_category as any ?? null,
      docId: null,
    });

    return { success: true, id };
  });

// ===========================================================================
// Approve Cleanup
// ===========================================================================

export const approveCleanup = (id: string, finalName?: string) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    const item = yield* tinybase.getPendingReview(id);
    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Pending item '${id}' not found`,
          resource: 'pending',
          id,
        })
      );
    }

    const value = finalName ?? item.suggestion;

    // Handle schema cleanup types
    if (item.type === 'schema_merge') {
      // Merge logic would go here
      // For now just mark as processed
    } else if (item.type === 'schema_delete') {
      // Delete logic would go here
    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true, final_name: value };
  });
