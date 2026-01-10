/**
 * TypeScript types for the Paperless Local LLM API
 */

// Settings Types
export interface Settings {
  paperless_url: string;
  paperless_connected: boolean;
  ollama_url: string;
  ollama_model_large: string;
  ollama_model_small: string;
  ollama_model_translation: string;
  qdrant_url: string;
  qdrant_collection: string;
  auto_processing_enabled: boolean;
  auto_processing_interval_minutes: number;
  prompt_language: string;
  pipeline_ocr: boolean;
  pipeline_correspondent: boolean;
  pipeline_document_type: boolean;
  pipeline_title: boolean;
  pipeline_tags: boolean;
  pipeline_custom_fields: boolean;
  tags: {
    pending: string;
    ocr_done: string;
    correspondent_done: string;
    document_type_done: string;
    title_done: string;
    tags_done: string;
    custom_fields_done: string;
    processed: string;
  };
}

export interface ConnectionTest {
  status: "connected" | "error";
  service: string;
  detail?: string;
  models?: number;
}

// Document Types
export interface QueueStats {
  pending: number;
  ocr_done: number;
  correspondent_done: number;
  document_type_done: number;
  title_done: number;
  tags_done: number;
  processed: number;
  total_in_pipeline: number;
}

export interface DocumentSummary {
  id: number;
  title: string;
  correspondent: string | null;
  created: string;
  tags: string[];
  processing_status: string | null;
}

export interface DocumentDetail {
  id: number;
  title: string;
  correspondent: string | null;
  correspondent_id: number | null;
  created: string;
  modified: string;
  added: string;
  tags: Array<{ id: number; name: string }>;
  custom_fields: Array<{ field: number; value: unknown }>;
  content: string | null;
  original_file_name: string | null;
  archive_serial_number: number | null;
}

// Processing Types
export interface ProcessingStatus {
  auto_processing: boolean;
  interval_minutes: number;
  currently_processing: number | null;
  queue_position: number;
}

// Prompts Types
export interface PromptInfo {
  name: string;
  filename: string;
  content: string;
  variables: string[];
  description: string | null;
}

export interface PromptGroup {
  name: string;
  main: PromptInfo;
  confirmation: PromptInfo | null;
}

export interface PreviewData {
  document_content: string;
  existing_correspondents: string;
  existing_types: string;
  existing_tags: string;
  similar_docs: string;
  similar_titles: string;
  feedback: string;
  analysis_result: string;
  document_excerpt: string;
}

export interface LanguageInfo {
  code: string;
  name: string;
  prompt_count: number;
  is_complete: boolean;
}

export interface AvailableLanguagesResponse {
  languages: LanguageInfo[];
  default: string;
  current: string;
}

// Pending Reviews Types
export type PendingItemType = "correspondent" | "document_type" | "tag";
export type SchemaItemType =
  | "schema_correspondent"
  | "schema_document_type"
  | "schema_tag"
  | "schema_custom_field"
  | "schema_cleanup";
export type AllPendingItemType = PendingItemType | SchemaItemType;

export interface PendingItem {
  id: string;
  doc_id: number;
  doc_title: string;
  type: AllPendingItemType;
  suggestion: string;
  reasoning: string;
  alternatives: string[];
  attempts: number;
  last_feedback: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
  next_tag?: string;
}

// Schema cleanup specific types
export type SchemaCleanupType = "merge" | "delete";
export type SchemaEntityType = "correspondent" | "document_type" | "tag";

export interface SchemaCleanupMetadata {
  cleanup_type: SchemaCleanupType;
  entity_type: SchemaEntityType;
  // For merges
  source_id?: number;
  target_id?: number;
  source_name?: string;
  target_name?: string;
  doc_count_source?: number;
  doc_count_target?: number;
  // For deletes
  entity_id?: number;
  entity_name?: string;
}

export interface SchemaCleanupApproveResponse {
  id: string;
  type: "schema_cleanup";
  cleanup_type: SchemaCleanupType;
  entity_type: SchemaEntityType;
  success: boolean;
  removed: boolean;
  merge_result?: {
    entity_type: string;
    source_id: number;
    target_id: number;
    documents_transferred: number;
    source_deleted: boolean;
    target_renamed: boolean;
  };
  delete_result?: {
    entity_type: string;
    entity_id: number;
    deleted: boolean;
    document_count: number;
    error?: string;
  };
}

export interface PendingCounts {
  correspondent: number;
  document_type: number;
  tag: number;
  total: number;
  // Schema suggestion counts (from bootstrap analysis)
  schema_correspondent: number;
  schema_document_type: number;
  schema_tag: number;
  schema_custom_field: number;
  schema_cleanup: number;
  metadata_description: number;
}

export interface SearchableEntities {
  correspondents: string[];
  document_types: string[];
  tags: string[];
}

// Pending cleanup (similar suggestions) types
export interface SimilarGroup {
  suggestions: string[];
  item_ids: string[];
  item_type: string;
  doc_ids: number[];
  recommended_name: string;
}

export interface SimilarGroupsResponse {
  groups: SimilarGroup[];
  total_mergeable: number;
}

export interface MergePendingResponse {
  merged_count: number;
  final_name: string;
  updated_item_ids: string[];
}

export interface BlockedItem {
  id: number;
  suggestion_name: string;
  normalized_name: string;
  block_type: "global" | "correspondent" | "document_type" | "tag";
  rejection_reason: string | null;
  rejection_category: string | null;
  doc_id: number | null;
  created_at: string | null;
}

export interface BlockedItemsResponse {
  global_blocks: BlockedItem[];
  correspondent_blocks: BlockedItem[];
  document_type_blocks: BlockedItem[];
  tag_blocks: BlockedItem[];
  total: number;
}

export interface PendingApproveResponse {
  success: boolean;
  created_entity?: string;
  entity_id?: number;
}

// Metadata Types
export interface TagMetadata {
  id: number | null;
  paperless_tag_id: number;
  tag_name: string;
  description: string | null;
  category: string | null;
  exclude_from_ai: boolean;
}

export interface TagMetadataUpdate {
  tag_name: string;
  description?: string | null;
  category?: string | null;
  exclude_from_ai?: boolean;
}

export interface TagMetadataBulk extends TagMetadataUpdate {
  paperless_tag_id: number;
}

export interface CustomFieldMetadata {
  id: number | null;
  paperless_field_id: number;
  field_name: string;
  description: string | null;
  extraction_hints: string | null;
  value_format: string | null;
  example_values: string[];
}

export interface CustomFieldMetadataUpdate {
  field_name: string;
  description?: string | null;
  extraction_hints?: string | null;
  value_format?: string | null;
  example_values?: string[] | null;
}

export interface CustomFieldMetadataBulk extends CustomFieldMetadataUpdate {
  paperless_field_id: number;
}

// Document Types Types
export interface DocumentTypeInfo {
  id: number;
  name: string;
  document_count: number;
}

export interface AiDocumentTypesResponse {
  document_types: DocumentTypeInfo[];
  selected_type_ids: number[];
}

// Translation Types
export interface TranslateRequest {
  text: string;
  source_lang: string;
  target_lang: string;
  content_type?: string;
  content_key?: string;
  use_cache?: boolean;
}

export interface TranslateResponse {
  translated_text: string;
  cached: boolean;
  model: string | null;
}

export interface TranslatePromptsResponse {
  success: boolean;
  total: number;
  successful: number;
  failed: number;
  results: Array<{
    success: boolean;
    prompt_name?: string;
    source_lang?: string;
    target_lang?: string;
    cached?: boolean;
    model?: string;
    error?: string;
  }>;
}

export interface TranslationEntry {
  source_lang: string;
  target_lang: string;
  content_type: string;
  content_key: string;
  source_text: string;
  translated_text: string;
  model_used: string | null;
  created_at: string;
}

// Blocked Suggestions Types
export type BlockType = "global" | "correspondent" | "document_type" | "tag";
export type RejectionCategory =
  | "duplicate"
  | "too_generic"
  | "irrelevant"
  | "wrong_format"
  | "other";

export interface BlockedSuggestion {
  id: number;
  suggestion_name: string;
  normalized_name: string;
  block_type: BlockType;
  rejection_reason: string | null;
  rejection_category: RejectionCategory | null;
  doc_id: number | null;
  created_at: string;
}

export interface BlockSuggestionRequest {
  suggestion_name: string;
  block_type: BlockType;
  rejection_reason?: string | null;
  rejection_category?: RejectionCategory | null;
  doc_id?: number | null;
}

// Jobs Types
export type JobStatusType = "idle" | "running" | "completed" | "failed";

export interface JobStatus {
  job_name: string;
  status: JobStatusType;
  last_run: string | null;
  last_result: Record<string, unknown> | null;
}

// Reject with Feedback Types
export type RejectBlockType = "none" | "global" | "per_type";

export interface RejectWithFeedbackRequest {
  block_type: RejectBlockType;
  rejection_reason?: string | null;
  rejection_category?: RejectionCategory | null;
}

export interface RejectWithFeedbackResponse {
  success: boolean;
  blocked: boolean;
  block_type: string | null;
}

// Bootstrap Analysis Types
export type BootstrapAnalysisType =
  | "all"
  | "correspondents"
  | "document_types"
  | "tags";
export type BootstrapStatusType =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface SuggestionsByType {
  correspondents: number;
  document_types: number;
  tags: number;
}

export interface BootstrapProgress {
  status: BootstrapStatusType;
  total: number;
  processed: number;
  skipped: number;
  current_doc_id: number | null;
  current_doc_title: string | null;
  suggestions_found: number;
  suggestions_by_type: SuggestionsByType;
  errors: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
  avg_seconds_per_doc: number | null;
  estimated_remaining_seconds: number | null;
}

export interface BootstrapStartResponse {
  message: string;
  analysis_type: BootstrapAnalysisType;
  status: string;
}

// Job Schedule Types
export type ScheduleType = "daily" | "weekly" | "monthly" | "cron";

export interface JobScheduleInfo {
  enabled: boolean;
  schedule: ScheduleType;
  cron: string;
  next_run: string | null;
  last_run: string | null;
  last_result: Record<string, unknown> | null;
}

export interface JobScheduleStatus {
  running: boolean;
  jobs: {
    schema_cleanup: JobScheduleInfo;
    metadata_enhancement: JobScheduleInfo;
  };
}

export interface ScheduleUpdateRequest {
  job_name: "schema_cleanup" | "metadata_enhancement";
  enabled: boolean;
  schedule: ScheduleType;
  cron?: string | null;
}

export interface ScheduleUpdateResponse {
  message: string;
  job_name: string;
  enabled: boolean;
  schedule: string;
  cron: string;
  next_run: string | null;
}

// Bulk OCR Types
export type BulkOCRStatusType =
  | "idle"
  | "running"
  | "completed"
  | "cancelled"
  | "failed";

export interface BulkOCRProgress {
  status: BulkOCRStatusType;
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  current_doc_id: number | null;
  current_doc_title: string | null;
  docs_per_second: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface BulkOCRStartResponse {
  message: string;
  docs_per_second: number;
  skip_existing: boolean;
  status: string;
}
