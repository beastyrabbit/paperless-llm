/**
 * Pending reviews API handlers.
 */
import { Effect, pipe } from "effect";
import { ProcessingPipelineService } from "../../agents/ProcessingPipeline.js";
import { NotFoundError, ValidationError } from "../../errors/index.js";
import { ConfigService, PaperlessService, TinyBaseService } from "../../services/index.js";
import type {
  ApproveRequest,
  BulkActionRequest,
  MergeRequest,
  PendingItem,
  RejectRequest,
} from "./api.js";

// ===========================================================================
// Helper Functions
// ===========================================================================

const parseMetadata = (metadataJson: string | null): Record<string, unknown> => {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson) as unknown;
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
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
    const targetDocId = metadata["targetDocId"] as number | undefined;
    const fieldId = metadata["fieldId"] as number | undefined;

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
  answer: "create" | "map" | "edit" | "skip" | "reject",
  feedback?: string | null,
) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;
    const metadata = parseMetadata(metadataJson);
    const entityKind = metadata["entityKind"] as string | undefined;
    const question = metadata["question"] as string | undefined;

    yield* tinybase
      .appendHumanDecision(docId, {
        id: `decision-${Date.now()}`,
        pendingId,
        type: entityKind ?? "unknown",
        question: question ?? "Human decision",
        suggestion: value,
        answer,
        value: answer === "skip" || answer === "reject" ? null : value,
        feedback,
        decidedAt: new Date().toISOString(),
      })
      .pipe(Effect.catchAll(() => Effect.void));

    if (answer === "skip" || answer === "reject") {
      return;
    }

    const numericValue = Number(value);
    switch (entityKind) {
      case "correspondent": {
        const correspondentId = Number.isFinite(numericValue)
          ? numericValue
          : yield* paperless.getOrCreateCorrespondent(value);
        yield* paperless.updateDocument(docId, { correspondent: correspondentId });
        break;
      }
      case "document_type": {
        const documentTypeId = Number.isFinite(numericValue)
          ? numericValue
          : yield* paperless.getOrCreateDocumentType(value);
        yield* paperless.updateDocument(docId, { document_type: documentTypeId });
        break;
      }
      case "tag": {
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
    const proposal = metadata["proposal"] as
      | {
          action?: string;
          attributeType?: string;
          sourceIds?: number[];
          targetId?: number;
          proposedName?: string;
        }
      | undefined;

    if (!proposal) return false;

    const sourceIds = proposal.sourceIds ?? [];
    const targetId = proposal.targetId;
    const name = finalName ?? proposal.proposedName;

    const applyMerge = (sourceId: number, mergeTargetId: number) => {
      switch (proposal.attributeType) {
        case "correspondent":
          return paperless.mergeCorrespondents(sourceId, mergeTargetId).pipe(Effect.as(true));
        case "document_type":
          return paperless.mergeDocumentTypes(sourceId, mergeTargetId).pipe(Effect.as(true));
        case "tag":
          return paperless.mergeTags(sourceId, mergeTargetId).pipe(Effect.as(true));
        default:
          return Effect.succeed(false);
      }
    };

    const applyDelete = (sourceId: number) => {
      switch (proposal.attributeType) {
        case "correspondent":
          return paperless.deleteCorrespondent(sourceId).pipe(Effect.as(true));
        case "document_type":
          return paperless.deleteDocumentType(sourceId).pipe(Effect.as(true));
        case "tag":
          return paperless.deleteTag(sourceId).pipe(Effect.as(true));
        default:
          return Effect.succeed(false);
      }
    };

    const applyRename = (renameTargetId: number, rename: string) => {
      switch (proposal.attributeType) {
        case "correspondent":
          return paperless.renameCorrespondent(renameTargetId, rename).pipe(Effect.as(true));
        case "document_type":
          return paperless.renameDocumentType(renameTargetId, rename).pipe(Effect.as(true));
        case "tag":
          return paperless.renameTag(renameTargetId, rename).pipe(Effect.as(true));
        default:
          return Effect.succeed(false);
      }
    };

    if (proposal.action === "merge" && targetId) {
      if (sourceIds.length === 0) return false;
      for (const sourceId of sourceIds) {
        const applied = yield* applyMerge(sourceId, targetId);
        if (!applied) return false;
      }
      if (name) {
        yield* applyRename(targetId, name).pipe(Effect.catchAll(() => Effect.void));
      }
      return true;
    }

    if (proposal.action === "delete") {
      if (sourceIds.length === 0) return false;
      for (const sourceId of sourceIds) {
        const applied = yield* applyDelete(sourceId);
        if (!applied) return false;
      }
      return true;
    }

    if (proposal.action === "rename" && targetId && name) {
      return yield* applyRename(targetId, name);
    }

    return false;
  });

const getMetadataString = (
  metadata: Record<string, unknown>,
  keys: string[],
): string | undefined => {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim().length > 0) return value.trim();
  }
  return undefined;
};

const getMetadataNumber = (
  metadata: Record<string, unknown>,
  keys: string[],
): number | undefined => {
  for (const key of keys) {
    const value = metadata[key];
    const parsed =
      typeof value === "number" ? value : typeof value === "string" ? Number(value) : NaN;
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

const applySchemaCleanupMetadata = (
  itemType: string,
  metadata: Record<string, unknown>,
  finalName?: string,
) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    const entityType = getMetadataString(metadata, [
      "entityType",
      "entity_type",
      "attributeType",
      "attribute_type",
    ]);
    const action =
      itemType === "schema_merge"
        ? "merge"
        : itemType === "schema_delete"
          ? "delete"
          : getMetadataString(metadata, ["cleanup_type", "cleanupType", "action"]);
    const sourceId = getMetadataNumber(metadata, [
      "sourceId",
      "source_id",
      "entityId",
      "entity_id",
      "id",
    ]);
    const targetId = getMetadataNumber(metadata, ["targetId", "target_id"]);
    const name =
      finalName ??
      getMetadataString(metadata, [
        "proposedName",
        "proposed_name",
        "targetName",
        "target_name",
        "name",
      ]);

    if (!entityType || !action) return false;
    if (entityType === "custom_field") return false;

    if (action === "merge" && sourceId && targetId) {
      if (entityType === "correspondent") yield* paperless.mergeCorrespondents(sourceId, targetId);
      else if (entityType === "document_type")
        yield* paperless.mergeDocumentTypes(sourceId, targetId);
      else if (entityType === "tag") yield* paperless.mergeTags(sourceId, targetId);
      else return false;
      return true;
    }

    if (action === "delete" && sourceId) {
      if (entityType === "correspondent") yield* paperless.deleteCorrespondent(sourceId);
      else if (entityType === "document_type") yield* paperless.deleteDocumentType(sourceId);
      else if (entityType === "tag") yield* paperless.deleteTag(sourceId);
      else return false;
      return true;
    }

    const renameTargetId = targetId ?? sourceId;
    if (action === "rename" && renameTargetId && name) {
      if (entityType === "correspondent")
        yield* paperless.renameCorrespondent(renameTargetId, name);
      else if (entityType === "document_type")
        yield* paperless.renameDocumentType(renameTargetId, name);
      else if (entityType === "tag") yield* paperless.renameTag(renameTargetId, name);
      else return false;
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

    return items.map(
      (item): PendingItem => ({
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
      }),
    );
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
          resource: "pending",
          id,
        }),
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
          resource: "pending",
          id,
        }),
      );
    }

    const value = request.selected_value ?? request.value ?? item.suggestion;
    const metadata = parseMetadata(item.metadata);
    const isPiHumanDecision =
      item.type === "human_decision" || metadata["kind"] === "pi_human_decision";

    // Apply the change based on type
    switch (item.type) {
      case "human_decision": {
        const answer =
          (request.action as "create" | "map" | "edit" | "skip" | "reject" | undefined) ?? "create";
        yield* applyHumanDecision(item.docId, item.id, item.metadata, value, answer);
        break;
      }
      case "consolidation": {
        const applied = yield* applyConsolidationProposal(item.metadata, value);
        if (!applied) {
          return yield* Effect.fail(
            new ValidationError({
              message: `Consolidation proposal '${id}' did not contain an applicable action.`,
              field: "metadata",
            }),
          );
        }
        break;
      }
      case "correspondent": {
        const corrId = yield* paperless.getOrCreateCorrespondent(value);
        yield* paperless.updateDocument(item.docId, { correspondent: corrId });
        break;
      }
      case "document_type": {
        const typeId = yield* paperless.getOrCreateDocumentType(value);
        yield* paperless.updateDocument(item.docId, { document_type: typeId });
        break;
      }
      case "tag": {
        yield* paperless.addTagToDocument(item.docId, value);
        break;
      }
      case "title": {
        yield* paperless.updateDocument(item.docId, { title: value });
        break;
      }
      case "documentlink": {
        yield* applyDocumentLink(item.docId, item.metadata);
        break;
      }
      case "schema_merge":
      case "schema_delete":
      case "schema_cleanup":
        // These are handled separately
        break;
    }

    // Move to next tag if specified
    if (item.nextTag) {
      if (typeof paperless.transitionDocumentTag === "function") {
        yield* paperless
          .transitionDocumentTag(item.docId, config.config.tags.review, item.nextTag)
          .pipe(Effect.catchAll(() => paperless.addTagToDocument(item.docId, item.nextTag!)));
      } else {
        yield* paperless.addTagToDocument(item.docId, item.nextTag);
      }
    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    if (isPiHumanDecision && item.docId > 0) {
      const pipeline = yield* ProcessingPipelineService;
      yield* pipeline
        .processDocument({ docId: item.docId, resume: true })
        .pipe(Effect.catchAll(() => Effect.void));
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
          resource: "pending",
          id,
        }),
      );
    }

    const metadata = parseMetadata(item.metadata);
    const isPiHumanDecision =
      item.type === "human_decision" || metadata["kind"] === "pi_human_decision";

    if (isPiHumanDecision) {
      yield* applyHumanDecision(
        item.docId,
        item.id,
        item.metadata,
        item.suggestion,
        "reject",
        request.feedback ?? null,
      ).pipe(Effect.catchAll(() => Effect.void));
      if (request.feedback) {
        yield* tinybase
          .appendReviewFeedback(item.docId, {
            id: `feedback-${Date.now()}`,
            pendingId: item.id,
            feedback: request.feedback,
            category: request.category ?? null,
            createdAt: new Date().toISOString(),
          })
          .pipe(Effect.catchAll(() => Effect.void));
      }
      yield* tinybase.removePendingReview(id);
      if (typeof paperless.transitionDocumentTag === "function") {
        yield* paperless
          .transitionDocumentTag(item.docId, config.config.tags.review, config.config.tags.metadata)
          .pipe(Effect.catchAll(() => Effect.void));
      }
      const pipeline = yield* ProcessingPipelineService;
      yield* pipeline
        .processDocument({ docId: item.docId, resume: true })
        .pipe(Effect.catchAll(() => Effect.void));
      return { success: true };
    }

    // Block globally if requested
    if (request.blockGlobally) {
      const blockType = request.category === "wrong_suggestion" ? "global" : toBlockType(item.type);
      if (blockType) {
        yield* tinybase.addBlockedSuggestion({
          suggestionName: item.suggestion,
          blockType,
          rejectionReason: request.feedback ?? null,
          rejectionCategory: (request.category as any) ?? null,
          docId: item.docId,
        });
      }
    }

    // Move document-backed pending items to manual review. Catalog cleanup items
    // use docId 0 and should be dismissible without touching Paperless documents.
    if (item.docId > 0) {
      yield* paperless.addTagToDocument(item.docId, config.config.tags.manualReview);
    }

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

const toBlockType = (itemType: string): "correspondent" | "document_type" | "tag" | null => {
  if (itemType === "correspondent" || itemType === "document_type" || itemType === "tag") {
    return itemType;
  }
  return null;
};

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

  const mergeable = Array.from(groups.values()).filter((g) => g.count > 1);
  return {
    groups: mergeable.map((group) => ({
      suggestions: group.items.map((item) => item.suggestion),
      item_ids: group.items.map((item) => item.id),
      item_type: group.items[0]?.type ?? "unknown",
      doc_ids: group.items.map((item) => item.docId),
      recommended_name: group.items[0]?.suggestion ?? group.normalizedName,
    })),
    total_mergeable: mergeable.length,
  };
});

// ===========================================================================
// Merge Similar Items
// ===========================================================================

export const mergeSimilarItems = (request: MergeRequest) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const paperless = yield* PaperlessService;

    let merged = 0;
    const ids = request.ids ?? request.item_ids ?? [];
    const targetValue = request.targetValue ?? request.final_name;
    if (ids.length === 0 || !targetValue?.trim()) {
      return yield* Effect.fail(
        new ValidationError({
          message: "Merge request requires item IDs and a final name.",
          field: "merge",
        }),
      );
    }
    const updatedItemIds: string[] = [];

    for (const id of ids) {
      const item = yield* tinybase.getPendingReview(id);
      if (!item) continue;

      // Apply the target value
      switch (item.type) {
        case "correspondent": {
          const corrId = yield* paperless.getOrCreateCorrespondent(targetValue);
          yield* paperless.updateDocument(item.docId, { correspondent: corrId });
          break;
        }
        case "document_type": {
          const typeId = yield* paperless.getOrCreateDocumentType(targetValue);
          yield* paperless.updateDocument(item.docId, { document_type: typeId });
          break;
        }
        case "tag": {
          yield* paperless.addTagToDocument(item.docId, targetValue);
          break;
        }
        case "title": {
          yield* paperless.updateDocument(item.docId, { title: targetValue });
          break;
        }
      }

      // Move to next tag if specified
      if (item.nextTag) {
        yield* paperless.addTagToDocument(item.docId, item.nextTag);
      }

      // Remove the pending item
      yield* tinybase.removePendingReview(id);
      updatedItemIds.push(id);
      merged++;
    }

    return {
      merged,
      merged_count: merged,
      final_name: targetValue,
      updated_item_ids: updatedItemIds,
    };
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

      if (request.action === "approve") {
        const value = request.targetValue ?? item.suggestion;

        switch (item.type) {
          case "correspondent": {
            const corrId = yield* paperless.getOrCreateCorrespondent(value);
            yield* paperless.updateDocument(item.docId, { correspondent: corrId });
            break;
          }
          case "document_type": {
            const typeId = yield* paperless.getOrCreateDocumentType(value);
            yield* paperless.updateDocument(item.docId, { document_type: typeId });
            break;
          }
          case "tag": {
            yield* paperless.addTagToDocument(item.docId, value);
            break;
          }
          case "title": {
            yield* paperless.updateDocument(item.docId, { title: value });
            break;
          }
          case "documentlink": {
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
            blockType: "global",
            rejectionReason: request.feedback ?? null,
            rejectionCategory: (request.category as any) ?? null,
            docId: item.docId,
          });
        }

        if (item.docId > 0) {
          yield* paperless.addTagToDocument(item.docId, config.config.tags.manualReview);
        }
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
          resource: "pending",
          id,
        }),
      );
    }

    const metadata = parseMetadata(item.metadata);
    const isPiHumanDecision =
      item.type === "human_decision" || metadata["kind"] === "pi_human_decision";

    if (isPiHumanDecision) {
      const feedback = request.rejection_reason ?? request.feedback ?? null;
      yield* applyHumanDecision(
        item.docId,
        item.id,
        item.metadata,
        item.suggestion,
        "reject",
        feedback,
      ).pipe(Effect.catchAll(() => Effect.void));
      if (feedback) {
        yield* tinybase
          .appendReviewFeedback(item.docId, {
            id: `feedback-${Date.now()}`,
            pendingId: item.id,
            feedback,
            category: request.rejection_category ?? request.category ?? null,
            createdAt: new Date().toISOString(),
          })
          .pipe(Effect.catchAll(() => Effect.void));
      }
      yield* tinybase.removePendingReview(id);
      if (typeof paperless.transitionDocumentTag === "function") {
        yield* paperless
          .transitionDocumentTag(item.docId, config.config.tags.review, config.config.tags.metadata)
          .pipe(Effect.catchAll(() => Effect.void));
      }
      const pipeline = yield* ProcessingPipelineService;
      yield* pipeline
        .processDocument({ docId: item.docId, resume: true })
        .pipe(Effect.catchAll(() => Effect.void));
      return { success: true, blocked: false };
    }

    // Add feedback to blocked suggestions if block_type is provided
    // Support both field naming conventions (feedback/category and rejection_reason/rejection_category)
    const requestedBlockType = request.block_type;
    if (requestedBlockType && requestedBlockType !== "none") {
      const blockType =
        requestedBlockType === "per_type"
          ? toBlockType(item.type)
          : (toBlockType(requestedBlockType) ??
            (requestedBlockType === "global" ? "global" : null));
      if (blockType) {
        yield* tinybase.addBlockedSuggestion({
          suggestionName: item.suggestion,
          blockType,
          rejectionReason: request.rejection_reason ?? request.feedback ?? null,
          rejectionCategory: ((request.rejection_category ?? request.category) as any) ?? null,
          docId: item.docId,
        });
      }
    }

    // Move document-backed pending items to manual review.
    if (item.docId > 0) {
      yield* paperless.addTagToDocument(item.docId, config.config.tags.manualReview);
    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true, blocked: !!requestedBlockType && requestedBlockType !== "none" };
  });

// ===========================================================================
// Search Entities
// ===========================================================================

export const getSearchEntities = pipe(
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;

    const [correspondents, tags, documentTypes] = yield* Effect.all([
      pipe(
        paperless.getCorrespondents(),
        Effect.catchAll(() => Effect.succeed([])),
      ),
      pipe(
        paperless.getTags(),
        Effect.catchAll(() => Effect.succeed([])),
      ),
      pipe(
        paperless.getDocumentTypes(),
        Effect.catchAll(() => Effect.succeed([])),
      ),
    ]);

    return {
      correspondents: correspondents.map((c) => ({ id: c.id, name: c.name })),
      tags: tags.map((t) => ({ id: t.id, name: t.name })),
      document_types: documentTypes.map((dt) => ({ id: dt.id, name: dt.name })),
    };
  }),
  // Return empty arrays if PaperlessService is not configured
  Effect.catchAll(() =>
    Effect.succeed({
      correspondents: [],
      tags: [],
      document_types: [],
    }),
  ),
);

// ===========================================================================
// Blocked Items
// ===========================================================================

export const getBlocked = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  const blocked = yield* tinybase.getBlockedSuggestions();

  const toApiItem = (b: (typeof blocked)[number]) => ({
    id: b.id,
    suggestion_name: b.suggestionName,
    normalized_name: b.normalizedName,
    block_type: b.blockType,
    rejection_reason: b.rejectionReason,
    rejection_category: b.rejectionCategory,
    doc_id: b.docId,
    created_at: b.createdAt,
  });

  return {
    items: blocked.map(toApiItem),
    global_blocks: blocked.filter((b) => b.blockType === "global").map(toApiItem),
    correspondent_blocks: blocked.filter((b) => b.blockType === "correspondent").map(toApiItem),
    document_type_blocks: blocked.filter((b) => b.blockType === "document_type").map(toApiItem),
    tag_blocks: blocked.filter((b) => b.blockType === "tag").map(toApiItem),
    total: blocked.length,
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
      rejectionCategory: (request.rejection_category as any) ?? null,
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

    const item = yield* tinybase.getPendingReview(id);
    if (!item) {
      return yield* Effect.fail(
        new NotFoundError({
          message: `Pending item '${id}' not found`,
          resource: "pending",
          id,
        }),
      );
    }

    const value = finalName ?? item.suggestion;

    if (item.type === "consolidation") {
      const applied = yield* applyConsolidationProposal(item.metadata, value);
      if (!applied) {
        return yield* Effect.fail(
          new ValidationError({
            message: `Consolidation proposal '${id}' did not contain an applicable action.`,
            field: "metadata",
          }),
        );
      }
    } else if (
      item.type === "schema_merge" ||
      item.type === "schema_delete" ||
      item.type === "schema_cleanup"
    ) {
      const metadata = parseMetadata(item.metadata);
      const applied = yield* applySchemaCleanupMetadata(item.type, metadata, value);
      if (!applied) {
        return yield* Effect.fail(
          new ValidationError({
            message: `Schema cleanup item '${id}' did not contain an applicable action.`,
            field: "metadata",
          }),
        );
      }
    }

    // Remove the pending item
    yield* tinybase.removePendingReview(id);

    return { success: true, final_name: value };
  });
