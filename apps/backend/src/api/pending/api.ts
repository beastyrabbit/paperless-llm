/**
 * Pending reviews API definition.
 */
import {
  ApprovePendingBodySchema,
  type ApprovePendingBody,
  BulkPendingBodySchema,
  type BulkPendingBody,
  MergePendingBodySchema,
  type MergePendingBody,
  RejectPendingBodySchema,
  type RejectPendingBody,
} from "@repo/api-contracts";
import { Schema } from "effect";

// ===========================================================================
// Schemas
// ===========================================================================

export const PendingItemSchema = Schema.Struct({
  id: Schema.String,
  docId: Schema.Number,
  docTitle: Schema.String,
  type: Schema.Literal(
    "correspondent",
    "document_type",
    "tag",
    "title",
    "documentlink",
    "human_decision",
    "consolidation",
    "schema_correspondent",
    "schema_document_type",
    "schema_tag",
    "schema_custom_field",
    "metadata_description",
    "schema_merge",
    "schema_delete",
    "schema_cleanup",
  ),
  suggestion: Schema.String,
  reasoning: Schema.String,
  alternatives: Schema.Array(Schema.String),
  attempts: Schema.Number,
  lastFeedback: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
  nextTag: Schema.NullOr(Schema.String).pipe(Schema.optional),
  metadata: Schema.Unknown.pipe(Schema.optional),
});

export type PendingItem = Schema.Schema.Type<typeof PendingItemSchema>;

export const PendingCountsSchema = Schema.Struct({
  correspondent: Schema.Number,
  document_type: Schema.Number,
  tag: Schema.Number,
  title: Schema.Number,
  human_decision: Schema.Number.pipe(Schema.optional),
  consolidation: Schema.Number.pipe(Schema.optional),
  schema_correspondent: Schema.Number.pipe(Schema.optional),
  schema_document_type: Schema.Number.pipe(Schema.optional),
  schema_tag: Schema.Number.pipe(Schema.optional),
  schema_custom_field: Schema.Number.pipe(Schema.optional),
  schema_merge: Schema.Number.pipe(Schema.optional),
  schema_delete: Schema.Number.pipe(Schema.optional),
  schema_cleanup: Schema.Number.pipe(Schema.optional),
  metadata_description: Schema.Number.pipe(Schema.optional),
  schema: Schema.Number,
  total: Schema.Number,
});

export type PendingCounts = Schema.Schema.Type<typeof PendingCountsSchema>;

export const ApproveRequestSchema = ApprovePendingBodySchema;
export type ApproveRequest = ApprovePendingBody;

export const RejectRequestSchema = RejectPendingBodySchema;
export type RejectRequest = RejectPendingBody;

export const SimilarGroupSchema = Schema.Struct({
  normalizedName: Schema.String,
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      suggestion: Schema.String,
      type: Schema.String,
      docId: Schema.Number,
      docTitle: Schema.String,
    }),
  ),
  count: Schema.Number,
});

export type SimilarGroup = Schema.Schema.Type<typeof SimilarGroupSchema>;

export const MergeRequestSchema = MergePendingBodySchema;
export type MergeRequest = MergePendingBody;

export const BulkActionRequestSchema = BulkPendingBodySchema;
export type BulkActionRequest = BulkPendingBody;
