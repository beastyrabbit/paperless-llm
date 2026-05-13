/**
 * Pending reviews API handlers.
 */
import { Effect, pipe, Option } from 'effect';
import { TinyBaseService, PaperlessService, ConfigService } from '../../services/index.js';
import { ProcessingPipelineService } from '../../agents/ProcessingPipeline.js';
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
// Helper Functions
// ===========================================================================

const parseMetadata = (metadataJson: string | null): Record<string, unknown> => {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed)
      ? parsed as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
};

/**
 * Apply a document link from pending review metadata.
 * Returns true if the link was applied, false if skipped (invalid metadata).
 */
const applyDocumentLink = (docId: number, metadataJson: string | null) =>
  Effect.gen(function* () {
    const metadata = parseMetadata(metadataJson);
    const targetDocId = metadata['targetDocId'] as number | undefined;
    const fieldId = metadata['fieldId'] as number | undefined;

    if (!targetDocId || !fieldId) return false;

    const paperless = yield* PaperlessService;
    const doc = yield* paperless.getDocument(docId);
    const currentFields = (doc.custom_fields ?? []) as Array<{ field: number; value: unknown }>;
    const existingField = currentFields.find((cf) => cf.field === fieldId);
    const existingLinks = Array.isArray(existingField?.value)
      ? (existingField.value as number[])
      : [];

    if (!existingLinks.includes(targetDocId)) {
      const newCustomFields = currentFields.filter((cf) => cf.field !== fieldId);
      newCustomFields.push({ field: fieldId, value: [...existingLinks, targetDocId] });
      yield* paperless.updateDocument(docId, { custom_fields: newCustomFields });
    }

    return true;
  });

const applyHumanDecision = (
  docId: number,
  pendingId: string,
  metadataJson: string | null,
  value: string,
  answer: 'create' | 'map' | 'edit' | 'skip' | 'reject',
  feedback?: string | null
) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const metadata = parseMetadata(metadataJson);
    const entityKind = metadata['entityKind'] as string | undefined;
    const question = metadata['question'] as string | undefined;

    yield* tinybase.appendHumanDecision(docId, {
      id: `decision-${Date.now()}`,
      pendingId,
      type: entityKind ?? 'unknown',
      question: question ?? 'Human decision',
      suggestion: value,
      answer,
      value: answer === 'skip' || answer === 'reject' ? null : value,
      feedback,
      decidedAt: new Date().toISOString(),
    }).pipe(Effect.catchAll(() => Effect.void));

    if (answer === 'skip' || answer === 'reject') {
      return;
    }

    const numericValue = Number(value);
    switch (entityKind) {
      case 'correspondent': {
        const correspondentId = Number.isFinite(numericValue)
          ? numericValue
          : yield* paperless.getOrCreateCorrespondent(value);
        yield* paperless.updateDocument(docId, { correspondent: correspondentId });
        break;
      }
      case 'document_type': {
        const documentTypeId = Number.isFinite(numericValue)
          ? numericValue
          : yield* paperless.getOrCreateDocumentType(value);
        yield* paperless.updateDocument(docId, { document_type: documentTypeId });
        break;
      }
      case 'tag': {
        if (Number.isFinite(numericValue)) {
          const doc = yield* paperless.getDocument(docId);
          if (!doc.tags.includes(numericValue)) {
            yield* paperless.updateDocument(docId, { tags: [...doc.tags, numericValue] });
          }
        } else {
          yield* paperless.addTagToDocument(docId, value);
        }
        break;
      }
      default:
        break;
    }
  });

const applyConsolidationProposal = (metadataJson: string | null, finalName?: string) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const metadata = parseMetadata(metadataJson);
    const proposal = metadata['proposal'] as {
      action?: string;
      attributeType?: string;
      sourceIds?: number[];
      targetId?: number;
      proposedName?: string;
    } | undefined;

    if (!proposal) return false;

    const sourceIds = proposal.sourceIds ?? [];
    const targetId = proposal.targetId;
    const name = finalName ?? proposal.proposedName;

    const applyMerge = (sourceId: number, mergeTargetId: number) => {
      switch (proposal.attributeType) {
        case 'correspondent':
          return paperless.mergeCorrespondents(sourceId, mergeTargetId);
        case 'document_type':
          return paperless.mergeDocumentTypes(sourceId, mergeTargetId);
        case 'tag':
          return paperless.mergeTags(sourceId, mergeTargetId);
        default:
          return Effect.void;
      }
    };

    const applyDelete = (sourceId: number) => {
      switch (proposal.attributeType) {
        case 'correspondent':
          return paperless.deleteCorrespondent(sourceId);
        case 'document_type':
          return paperless.deleteDocumentType(sourceId);
        case 'tag':
          return paperless.deleteTag(sourceId);
        default:
          return Effect.void;
      }
    };

    const applyRename = (renameTargetId: number, rename: string) => {
      switch (proposal.attributeType) {
        case 'correspondent':
          return paperless.renameCorrespondent(renameTargetId, rename).pipe(Effect.asVoid);
        case 'document_type':
          return paperless.renameDocumentType(renameTargetId, rename).pipe(Effect.asVoid);
        case 'tag':
          return paperless.renameTag(renameTargetId, rename).pipe(Effect.asVoid);
        default:
          return Effect.void;
      }
    };

    if (proposal.action === 'merge' && targetId) {
      for (const sourceId of sourceIds) {
        yield* applyMerge(sourceId, targetId);
      }
      if (name) {
        yield* applyRename(targetId, name).pipe(Effect.catchAll(() => Effect.void));
      }
      return true;
    }

    if (proposal.action === 'delete') {
      for (const sourceId of sourceIds) {
        yield* applyDelete(sourceId);
      }
      return true;
    }

    if (proposal.action === 'rename' && targetId && name) {
      yield* applyRename(targetId, name);
      return true;
    }

    return false;
  });

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
	      nextTag: item.nextTag,
	      metadata: parseMetadata(item.metadata),
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

    const value = request.selected_value ?? request.value ?? item.suggestion;
    const metadata = parseMetadata(item.metadata);
    const isPiHumanDecision = item.type === 'human_decision' || metadata['kind'] === 'pi_human_decision';

    // Apply the change based on type
    switch (item.type) {
      case 'human_decision': {
        const answer = (request.action as 'create' | 'map' | 'edit' | 'skip' | 'reject' | undefined) ?? 'create';
        yield* applyHumanDecision(item.docId, item.id, item.metadata, value, answer);
        break;
      }
      case 'consolidation': {
        yield* applyConsolidationProposal(item.metadata, value);
        break;
      }
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
        yield* applyDocumentLink(item.docId, item.metadata);
        break;
      }
      case 'schema_merge':
      case 'schema_delete':
      case 'schema_cleanup':
        // These are handled separately
        break;
    }

	    // Move to next tag if specified
	    if (item.nextTag) {
	      if (typeof paperless.transitionDocumentTag === 'function') {
	        yield* paperless.transitionDocumentTag(item.docId, config.config.tags.review, item.nextTag).pipe(
	          Effect.catchAll(() => paperless.addTagToDocument(item.docId, item.nextTag!))
	        );
	      } else {
	        yield* paperless.addTagToDocument(item.docId, item.nextTag);
	      }
	    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    if (isPiHumanDecision && item.docId > 0) {
      const pipeline = yield* ProcessingPipelineService;
      yield* pipeline.processDocument({ docId: item.docId, resume: true }).pipe(Effect.catchAll(() => Effect.void));
    }

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

    const metadata = parseMetadata(item.metadata);
    const isPiHumanDecision = item.type === 'human_decision' || metadata['kind'] === 'pi_human_decision';

    if (isPiHumanDecision) {
      yield* applyHumanDecision(item.docId, item.id, item.metadata, item.suggestion, 'reject', request.feedback ?? null).pipe(
        Effect.catchAll(() => Effect.void)
      );
      if (request.feedback) {
        yield* tinybase.appendReviewFeedback(item.docId, {
          id: `feedback-${Date.now()}`,
          pendingId: item.id,
          feedback: request.feedback,
          category: request.category ?? null,
          createdAt: new Date().toISOString(),
        }).pipe(Effect.catchAll(() => Effect.void));
      }
      yield* tinybase.removePendingReview(id);
		      if (typeof paperless.transitionDocumentTag === 'function') {
		        yield* paperless.transitionDocumentTag(item.docId, config.config.tags.review, config.config.tags.metadata).pipe(
		          Effect.catchAll(() => Effect.void)
		        );
		      }
      const pipeline = yield* ProcessingPipelineService;
      yield* pipeline.processDocument({ docId: item.docId, resume: true }).pipe(Effect.catchAll(() => Effect.void));
      return { success: true };
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
            yield* applyDocumentLink(item.docId, item.metadata);
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

	    const metadata = parseMetadata(item.metadata);
	    const isPiHumanDecision = item.type === 'human_decision' || metadata['kind'] === 'pi_human_decision';

	    if (isPiHumanDecision) {
	      const feedback = request.rejection_reason ?? request.feedback ?? null;
	      yield* applyHumanDecision(item.docId, item.id, item.metadata, item.suggestion, 'reject', feedback).pipe(
	        Effect.catchAll(() => Effect.void)
	      );
	      if (feedback) {
	        yield* tinybase.appendReviewFeedback(item.docId, {
	          id: `feedback-${Date.now()}`,
	          pendingId: item.id,
	          feedback,
	          category: request.rejection_category ?? request.category ?? null,
	          createdAt: new Date().toISOString(),
	        }).pipe(Effect.catchAll(() => Effect.void));
	      }
	      yield* tinybase.removePendingReview(id);
	      if (typeof paperless.transitionDocumentTag === 'function') {
	        yield* paperless.transitionDocumentTag(item.docId, config.config.tags.review, config.config.tags.metadata).pipe(
	          Effect.catchAll(() => Effect.void)
	        );
	      }
	      const pipeline = yield* ProcessingPipelineService;
	      yield* pipeline.processDocument({ docId: item.docId, resume: true }).pipe(Effect.catchAll(() => Effect.void));
	      return { success: true, blocked: false };
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

    if (item.type === 'consolidation') {
      yield* applyConsolidationProposal(item.metadata, value);
    } else if (item.type === 'schema_merge' || item.type === 'schema_delete' || item.type === 'schema_cleanup') {
      const metadata = parseMetadata(item.metadata);
      const entityType = metadata['entityType'] as string | undefined;
      const sourceId = metadata['sourceId'] as number | undefined;
      const targetId = metadata['targetId'] as number | undefined;

      if (item.type === 'schema_merge' && sourceId && targetId) {
        if (entityType === 'correspondent') yield* paperless.mergeCorrespondents(sourceId, targetId);
        if (entityType === 'document_type') yield* paperless.mergeDocumentTypes(sourceId, targetId);
        if (entityType === 'tag') yield* paperless.mergeTags(sourceId, targetId);
      }
      if (item.type === 'schema_delete' && sourceId) {
        if (entityType === 'correspondent') yield* paperless.deleteCorrespondent(sourceId);
        if (entityType === 'document_type') yield* paperless.deleteDocumentType(sourceId);
        if (entityType === 'tag') yield* paperless.deleteTag(sourceId);
      }
    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true, final_name: value };
  });
