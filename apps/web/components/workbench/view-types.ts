/**
 * Production view-model types for the analysis workbench.
 *
 * These live outside the fixtures module so production code never imports from
 * fixtures (even type-only). The queue item types are derived from the frozen
 * `@repo/api-contracts` page shapes; the diff/label types describe the live
 * Paperless values the workbench renders against a proposal.
 */
import type {
  AnalysisFailureQueuePage,
  AnalysisReviewQueuePage,
  DocumentId,
} from "@repo/api-contracts";

// The contract exports the queue *page* types and item *schemas*; derive the
// per-item types via indexed access so they stay pinned to the contract.
export type AnalysisReviewQueueItem = AnalysisReviewQueuePage["items"][number];
export type AnalysisFailureQueueItem = AnalysisFailureQueuePage["items"][number];

/**
 * Live id→name lookups resolved from Paperless at runtime (current document
 * detail + custom-field metadata). The analysis contract carries only ids; the
 * renderer falls back to a `#id` chip when a name is not yet known.
 */
export interface EntityLabels {
  readonly tags: Readonly<Record<number, string>>;
  readonly correspondents: Readonly<Record<number, string>>;
  readonly documentTypes: Readonly<Record<number, string>>;
  readonly customFields: Readonly<Record<number, string>>;
}

/**
 * The document's current Paperless metadata (the "before" side of the diff),
 * adapted from the live document detail endpoint.
 */
export interface DocumentBaseline {
  readonly documentId: DocumentId;
  readonly title: string;
  readonly correspondentId: number | null;
  readonly documentTypeId: number | null;
  readonly ordinaryTagIds: readonly number[];
  readonly customFields: readonly { readonly customFieldId: number; readonly value: string }[];
}
