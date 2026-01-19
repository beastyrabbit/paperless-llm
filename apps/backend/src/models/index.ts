/**
 * Application data models.
 */
import { Schema } from 'effect';

// ===========================================================================
// Document Models
// ===========================================================================

export const DocumentSchema = Schema.Struct({
  id: Schema.Number,
  title: Schema.String,
  content: Schema.NullOr(Schema.String),
  correspondent: Schema.NullOr(Schema.Number),
  correspondent_name: Schema.NullOr(Schema.String).pipe(Schema.optional),
  document_type: Schema.NullOr(Schema.Number),
  document_type_name: Schema.NullOr(Schema.String).pipe(Schema.optional),
  tags: Schema.Array(Schema.Number),
  tag_names: Schema.Array(Schema.String).pipe(Schema.optional),
  created: Schema.String,
  modified: Schema.String,
  added: Schema.String,
  archive_serial_number: Schema.NullOr(Schema.Number),
  original_file_name: Schema.NullOr(Schema.String),
  archived_file_name: Schema.NullOr(Schema.String),
  custom_fields: Schema.Array(Schema.Unknown).pipe(Schema.optional),
});

export type Document = Schema.Schema.Type<typeof DocumentSchema>;

export const CustomFieldValueSchema = Schema.Struct({
  field: Schema.Number,
  value: Schema.Unknown,
});

export type CustomFieldValue = Schema.Schema.Type<typeof CustomFieldValueSchema>;

export const DocumentUpdateSchema = Schema.Struct({
  title: Schema.String.pipe(Schema.optional),
  correspondent: Schema.NullOr(Schema.Number).pipe(Schema.optional),
  document_type: Schema.NullOr(Schema.Number).pipe(Schema.optional),
  tags: Schema.Array(Schema.Number).pipe(Schema.optional),
  archive_serial_number: Schema.NullOr(Schema.Number).pipe(Schema.optional),
  custom_fields: Schema.Array(CustomFieldValueSchema).pipe(Schema.optional),
});

export type DocumentUpdate = Schema.Schema.Type<typeof DocumentUpdateSchema>;

// ===========================================================================
// Entity Models (Correspondent, Tag, DocumentType)
// ===========================================================================

export const CorrespondentSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  slug: Schema.String,
  match: Schema.String.pipe(Schema.optional),
  matching_algorithm: Schema.Number.pipe(Schema.optional),
  is_insensitive: Schema.Boolean.pipe(Schema.optional),
  document_count: Schema.Number.pipe(Schema.optional),
});

export type Correspondent = Schema.Schema.Type<typeof CorrespondentSchema>;

export const TagSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  slug: Schema.String,
  color: Schema.String.pipe(Schema.optional),
  text_color: Schema.String.pipe(Schema.optional),
  match: Schema.String.pipe(Schema.optional),
  matching_algorithm: Schema.Number.pipe(Schema.optional),
  is_insensitive: Schema.Boolean.pipe(Schema.optional),
  is_inbox_tag: Schema.Boolean.pipe(Schema.optional),
  document_count: Schema.Number.pipe(Schema.optional),
});

export type Tag = Schema.Schema.Type<typeof TagSchema>;

export const DocumentTypeSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  slug: Schema.String,
  match: Schema.String.pipe(Schema.optional),
  matching_algorithm: Schema.Number.pipe(Schema.optional),
  is_insensitive: Schema.Boolean.pipe(Schema.optional),
  document_count: Schema.Number.pipe(Schema.optional),
});

export type DocumentType = Schema.Schema.Type<typeof DocumentTypeSchema>;

export const CustomFieldSchema = Schema.Struct({
  id: Schema.Number,
  name: Schema.String,
  data_type: Schema.String,
});

export type CustomField = Schema.Schema.Type<typeof CustomFieldSchema>;

// ===========================================================================
// Pending Review Models
// ===========================================================================

export const PendingReviewTypeSchema = Schema.Literal(
  'correspondent',
  'document_type',
  'tag',
  'title',
  'documentlink',
  'schema_merge',
  'schema_delete'
);

export type PendingReviewType = Schema.Schema.Type<typeof PendingReviewTypeSchema>;

export const PendingReviewSchema = Schema.Struct({
  id: Schema.String,
  docId: Schema.Number,
  docTitle: Schema.String,
  type: PendingReviewTypeSchema,
  suggestion: Schema.String,
  reasoning: Schema.String,
  alternatives: Schema.Array(Schema.String),
  attempts: Schema.Number,
  lastFeedback: Schema.NullOr(Schema.String),
  nextTag: Schema.NullOr(Schema.String),
  metadata: Schema.NullOr(Schema.String), // JSON string
  createdAt: Schema.String,
});

export type PendingReview = Schema.Schema.Type<typeof PendingReviewSchema>;

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

// ===========================================================================
// Blocked Suggestions Models
// ===========================================================================

export const BlockTypeSchema = Schema.Literal(
  'global',
  'correspondent',
  'document_type',
  'tag'
);

export type BlockType = Schema.Schema.Type<typeof BlockTypeSchema>;

export const RejectionCategorySchema = Schema.Literal(
  'wrong_suggestion',
  'low_quality',
  'duplicate',
  'not_applicable',
  'other'
);

export type RejectionCategory = Schema.Schema.Type<typeof RejectionCategorySchema>;

export const BlockedSuggestionSchema = Schema.Struct({
  id: Schema.Number,
  suggestionName: Schema.String,
  normalizedName: Schema.String,
  blockType: BlockTypeSchema,
  rejectionReason: Schema.NullOr(Schema.String),
  rejectionCategory: Schema.NullOr(RejectionCategorySchema),
  docId: Schema.NullOr(Schema.Number),
  createdAt: Schema.String,
});

export type BlockedSuggestion = Schema.Schema.Type<typeof BlockedSuggestionSchema>;

// ===========================================================================
// Tag & Custom Field Metadata Models
// ===========================================================================

export const TagMetadataSchema = Schema.Struct({
  id: Schema.Number,
  paperlessTagId: Schema.Number,
  tagName: Schema.String,
  description: Schema.NullOr(Schema.String),
  category: Schema.NullOr(Schema.String),
  excludeFromAi: Schema.Boolean,
});

export type TagMetadata = Schema.Schema.Type<typeof TagMetadataSchema>;

export const CustomFieldMetadataSchema = Schema.Struct({
  id: Schema.Number,
  paperlessFieldId: Schema.Number,
  fieldName: Schema.String,
  description: Schema.NullOr(Schema.String),
  extractionHints: Schema.NullOr(Schema.String),
  valueFormat: Schema.NullOr(Schema.String),
  exampleValues: Schema.NullOr(Schema.String), // JSON array
});

export type CustomFieldMetadata = Schema.Schema.Type<typeof CustomFieldMetadataSchema>;

// ===========================================================================
// Translation Models
// ===========================================================================

export const TranslationSchema = Schema.Struct({
  key: Schema.String, // composite key
  sourceLang: Schema.String,
  targetLang: Schema.String,
  sourceText: Schema.String,
  translatedText: Schema.String,
  modelUsed: Schema.NullOr(Schema.String),
  createdAt: Schema.String,
});

export type Translation = Schema.Schema.Type<typeof TranslationSchema>;

// ===========================================================================
// Job Status Models
// ===========================================================================

export const JobStatusValueSchema = Schema.Literal(
  'idle',
  'running',
  'completed',
  'failed',
  'cancelled'
);

export type JobStatusValue = Schema.Schema.Type<typeof JobStatusValueSchema>;

export const JobStatusSchema = Schema.Struct({
  name: Schema.String,
  status: JobStatusValueSchema,
  lastRun: Schema.NullOr(Schema.String),
  lastResult: Schema.NullOr(Schema.String), // JSON
  nextRun: Schema.NullOr(Schema.String),
  enabled: Schema.Boolean,
  schedule: Schema.NullOr(Schema.String),
  cron: Schema.NullOr(Schema.String),
});

export type JobStatus = Schema.Schema.Type<typeof JobStatusSchema>;

// ===========================================================================
// Queue Stats Models
// ===========================================================================

export const QueueStatsSchema = Schema.Struct({
  pending: Schema.Number,
  ocrDone: Schema.Number,
  titleDone: Schema.Number,
  correspondentDone: Schema.Number,
  documentTypeDone: Schema.Number,
  tagsDone: Schema.Number,
  processed: Schema.Number,
  failed: Schema.Number,
  manualReview: Schema.Number,
  total: Schema.Number,
});

export type QueueStats = Schema.Schema.Type<typeof QueueStatsSchema>;

// ===========================================================================
// Agent Result Models
// ===========================================================================

export const AgentResultSchema = Schema.Struct({
  success: Schema.Boolean,
  value: Schema.NullOr(Schema.String),
  reasoning: Schema.NullOr(Schema.String),
  confidence: Schema.Number,
  alternatives: Schema.Array(Schema.String),
  attempts: Schema.Number,
  needsReview: Schema.Boolean,
});

export type AgentResult = Schema.Schema.Type<typeof AgentResultSchema>;

export const StreamEventSchema = Schema.Struct({
  type: Schema.Literal('start', 'thinking', 'result', 'error', 'complete'),
  step: Schema.String,
  data: Schema.NullOr(Schema.Unknown),
  timestamp: Schema.String,
});

export type StreamEvent = Schema.Schema.Type<typeof StreamEventSchema>;

// ===========================================================================
// Document OCR Content Models
// ===========================================================================

export const DocumentOcrContentSourceSchema = Schema.Literal(
  'mistral',
  'paperless',
  'manual'
);

export type DocumentOcrContentSource = Schema.Schema.Type<typeof DocumentOcrContentSourceSchema>;

export const DocumentOcrContentSchema = Schema.Struct({
  docId: Schema.Number,
  content: Schema.String,
  pages: Schema.Number,
  source: DocumentOcrContentSourceSchema,
  createdAt: Schema.String,
  updatedAt: Schema.String,
});

export type DocumentOcrContent = Schema.Schema.Type<typeof DocumentOcrContentSchema>;

// ===========================================================================
// Document Link Models
// ===========================================================================

export const DocumentLinkSuggestionSchema = Schema.Struct({
  targetDocId: Schema.Number,
  targetDocTitle: Schema.String,
  confidence: Schema.Number, // 0-1 scale
  reasoning: Schema.String,
  referenceType: Schema.Literal('explicit', 'semantic', 'shared_context'),
  referenceText: Schema.NullOr(Schema.String), // The text that triggered the link suggestion
});

export type DocumentLinkSuggestion = Schema.Schema.Type<typeof DocumentLinkSuggestionSchema>;
