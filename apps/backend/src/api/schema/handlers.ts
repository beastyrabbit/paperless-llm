/**
 * Schema API handlers.
 *
 * Handlers for blocked suggestion management.
 */
import { Effect } from "effect";
import type { BlockType, RejectionCategory } from "../../models/index.js";
import { TinyBaseService } from "../../services/index.js";

// ===========================================================================
// Blocked Suggestions
// ===========================================================================

const isBlockType = (value: string | undefined): value is BlockType =>
  value === "global" || value === "correspondent" || value === "document_type" || value === "tag";

const isRejectionCategory = (value: string | null | undefined): value is RejectionCategory =>
  value === "wrong_suggestion" ||
  value === "low_quality" ||
  value === "duplicate" ||
  value === "not_applicable" ||
  value === "too_generic" ||
  value === "irrelevant" ||
  value === "wrong_format" ||
  value === "other";

const toApiBlockedSuggestion = (item: {
  id: number;
  suggestionName: string;
  normalizedName: string;
  blockType: BlockType;
  rejectionReason: string | null;
  rejectionCategory: string | null;
  docId: number | null;
  createdAt: string;
}) => ({
  id: item.id,
  suggestion_name: item.suggestionName,
  normalized_name: item.normalizedName,
  block_type: item.blockType,
  rejection_reason: item.rejectionReason,
  rejection_category: item.rejectionCategory,
  doc_id: item.docId,
  created_at: item.createdAt,
});

export const getBlocked = (blockType?: string) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const blocked = yield* tinybase.getBlockedSuggestions(
      isBlockType(blockType) ? blockType : undefined,
    );
    return blocked.map(toApiBlockedSuggestion);
  });

export const blockSuggestion = (data: {
  name?: string;
  suggestion_name?: string;
  block_type: string;
  reason?: string;
  rejection_reason?: string | null;
  rejection_category?: string | null;
  doc_id?: number | null;
}) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const suggestionName = data.suggestion_name ?? data.name ?? "";
    const blockType = isBlockType(data.block_type) ? data.block_type : "global";
    const rejectionCategory = isRejectionCategory(data.rejection_category)
      ? data.rejection_category
      : null;
    const id = yield* tinybase.addBlockedSuggestion({
      suggestionName,
      blockType,
      rejectionReason: data.rejection_reason ?? data.reason ?? null,
      rejectionCategory,
      docId: data.doc_id ?? null,
    });
    const blocked = yield* tinybase.getBlockedSuggestions();
    const created = blocked.find((item) => item.id === id);
    return created
      ? toApiBlockedSuggestion(created)
      : {
          id,
          suggestion_name: suggestionName,
          normalized_name: suggestionName.toLowerCase().trim(),
          block_type: blockType,
          rejection_reason: data.rejection_reason ?? data.reason ?? null,
          rejection_category: rejectionCategory,
          doc_id: data.doc_id ?? null,
          created_at: new Date().toISOString(),
        };
  });

export const unblock = (id: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    yield* tinybase.removeBlockedSuggestion(id);
  });

export const checkBlocked = (name: string, blockType: string) =>
  Effect.gen(function* () {
    if (!name || !isBlockType(blockType)) return { is_blocked: false };
    const tinybase = yield* TinyBaseService;
    const is_blocked = yield* tinybase.isBlocked(name, blockType);
    return { is_blocked };
  });
