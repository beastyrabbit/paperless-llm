/**
 * Pending reviews API definition.
 */
import { Schema } from 'effect';

// ===========================================================================
// Schemas
// ===========================================================================

export const PendingItemSchema = Schema.Struct({
  id: Schema.String,
  docId: Schema.Number,
  docTitle: Schema.String,
  type: Schema.Literal('correspondent', 'document_type', 'tag', 'title', 'documentlink', 'schema_merge', 'schema_delete'),
  suggestion: Schema.String,
  reasoning: Schema.String,
  alternatives: Schema.Array(Schema.String),
  attempts: Schema.Number,
  lastFeedback: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

export type PendingItem = Schema.Schema.Type<typeof PendingItemSchema>;

export const PendingCountsSchema = Schema.Struct({
  correspondent: Schema.Number,
  document_type: Schema.Number,
  tag: Schema.Number,
  title: Schema.Number,
  documentlink: Schema.Number,
  schema: Schema.Number,
  total: Schema.Number,
});

export type PendingCounts = Schema.Schema.Type<typeof PendingCountsSchema>;

export const ApproveRequestSchema = Schema.Struct({
  action: Schema.String.pipe(Schema.optional),
  value: Schema.String.pipe(Schema.optional),
});

export type ApproveRequest = Schema.Schema.Type<typeof ApproveRequestSchema>;

export const RejectRequestSchema = Schema.Struct({
  feedback: Schema.String.pipe(Schema.optional),
  category: Schema.String.pipe(Schema.optional),
  blockGlobally: Schema.Boolean.pipe(Schema.optional),
});

export type RejectRequest = Schema.Schema.Type<typeof RejectRequestSchema>;

export const SimilarGroupSchema = Schema.Struct({
  normalizedName: Schema.String,
  items: Schema.Array(Schema.Struct({
    id: Schema.String,
    suggestion: Schema.String,
    type: Schema.String,
    docId: Schema.Number,
    docTitle: Schema.String,
  })),
  count: Schema.Number,
});

export type SimilarGroup = Schema.Schema.Type<typeof SimilarGroupSchema>;

export const MergeRequestSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  targetValue: Schema.String,
});

export type MergeRequest = Schema.Schema.Type<typeof MergeRequestSchema>;

export const BulkActionRequestSchema = Schema.Struct({
  ids: Schema.Array(Schema.String),
  action: Schema.Literal('approve', 'reject'),
  targetValue: Schema.String.pipe(Schema.optional),
  feedback: Schema.String.pipe(Schema.optional),
  category: Schema.String.pipe(Schema.optional),
  blockGlobally: Schema.Boolean.pipe(Schema.optional),
});

export type BulkActionRequest = Schema.Schema.Type<typeof BulkActionRequestSchema>;
