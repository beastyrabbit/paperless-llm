export interface Settings {
  paperless_url: string;
  paperless_external_url: string;
  paperless_connected: boolean;
  ollama_url: string;
  ollama_model: string;
  ollama_embedding_model: string;
  openai_cli_enabled: boolean;
  openai_cli_command: string;
  openai_cli_model: string;
  openai_cli_reasoning_effort: "off" | "minimal" | "low" | "medium" | "high" | "xhigh";
  openai_cli_fast_mode: boolean;
  openai_cli_scope: "chat" | "full_pipeline" | "catalog" | "all";
  mistral_api_key?: string | null;
  mistral_api_key_configured?: boolean;
  qdrant_url: string;
  qdrant_collection: string;
  auto_processing_enabled: boolean;
  auto_processing_interval_minutes: number;
  auto_processing_include_untagged: boolean;
  confirmation_enabled: boolean;
  confirmation_max_retries: number;
  confirmation_min_confidence: number;
  language: string;
  tag_language_aliases_de: string;
  debug_log_level: string;
  debug_log_prompts: boolean;
  debug_log_responses: boolean;
  debug_save_processing_history: boolean;
  pipeline_custom_fields: boolean;
  pipeline_document_type: boolean;
  pipeline_document_links: boolean;
  tags: {
    todo: string;
    ocr: string;
    metadata: string;
    review: string;
    index: string;
    done: string;
    failed: string;
    pending: string;
    ocr_done: string;
    summary_done: string;
    schema_review: string;
    correspondent_done: string;
    document_type_done: string;
    title_done: string;
    tags_done: string;
    processed: string;
    manual_review: string;
  };
}

export interface ConnectionTest {
  status: "success" | "warning" | "connected" | "error";
  service?: string;
  message?: string;
  detail?: string;
  details?: unknown;
  models?: number;
}

export type HealthDependencyStatus = "up" | "down";
export type OverallHealth = "healthy" | "unhealthy";

export interface HealthDependency {
  status: HealthDependencyStatus;
  required: true;
  durationMs: number;
  message?: string;
}

export interface HealthResponse {
  status: 200 | 503;
  health: OverallHealth;
  timestamp: string;
  durationMs: number;
  services: {
    paperless: HealthDependency;
    ollama: HealthDependency;
    qdrant: HealthDependency;
    mistral: HealthDependency;
  };
}

export interface OllamaModel {
  name: string;
  size?: string;
  modified_at?: string;
}

export interface OllamaModelsResponse {
  models: OllamaModel[];
}

export interface MistralModel {
  id: string;
  name?: string;
  object?: string;
  created?: number;
  owned_by?: string;
}

export interface MistralModelsResponse {
  models: MistralModel[];
}

export interface OpenAICodexModel {
  id: string;
  name: string;
  provider: string;
}

export interface OpenAICodexModelsResponse {
  models: OpenAICodexModel[];
}

export interface WorkflowTagStatus {
  key: string;
  name: string;
  exists: boolean;
  tag_id: number | null;
  actual_color: string | null;
  color_matches: boolean | null;
}

export interface WorkflowTagsStatusResponse {
  tags: WorkflowTagStatus[];
  expected_color: string;
  all_exist: boolean;
  missing_count: number;
  all_colors_match: boolean;
  color_mismatch_count: number;
}

export interface WorkflowTagsCreateResponse {
  created: string[];
  failed: string[];
  details: Array<{ name: string; id: number }>;
}

export interface WorkflowTagColorFixResponse {
  updated: string[];
  failed: string[];
  color: string;
}

export interface AiTag {
  id: number;
  name: string;
  color: string | null;
  text_color?: string | null;
  is_inbox_tag?: boolean;
  matching_algorithm?: number;
  document_count: number;
}

export interface AiTagsResponse {
  tags: AiTag[];
  selected_tag_ids: number[];
}

export interface AiTagsUpdateResponse {
  success: boolean;
  selected_tag_ids: number[];
}

export interface QueueStats {
  todo?: number;
  ocr?: number;
  metadata?: number;
  review?: number;
  index?: number;
  done?: number;
  pending: number;
  ocr_done: number;
  correspondent_done: number;
  document_type_done: number;
  title_done: number;
  tags_done: number;
  processed: number;
  total_in_pipeline: number;
  total_documents?: number;
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
  document_type: string | null;
  document_type_id: number | null;
  created: string;
  modified: string;
  added: string;
  tags: Array<{ id: number; name: string }>;
  processing_status: string | null;
  custom_fields: Array<{ field: number; value: unknown }>;
  content: string | null;
  original_file_name: string | null;
  archive_serial_number: number | null;
}

export interface ProcessingStatus {
  is_processing: boolean;
  current_doc_id: number | null;
  current_step: string | null;
  queue_length: number;
  processed_today: number;
  errors_today: number;
  auto_processing: boolean;
  auto_processing_running: boolean;
  include_untagged: boolean;
}

export interface AutoProcessingStatus {
  running: boolean;
  enabled: boolean;
  interval_minutes: number;
  include_untagged: boolean;
  queue_length: number;
  last_check_at: string | null;
  currently_processing_doc_id: number | null;
  currently_processing_doc_title: string | null;
  current_step: string | null;
  processed_since_start: number;
  errors_since_start: number;
}

export interface AutoProcessingTriggerResponse {
  message: string;
  running: boolean;
  enabled: boolean;
  currently_processing_doc_id: number | null;
}

export type LockScope = "document" | "catalog";

export interface DurableLock {
  id: string;
  scope: LockScope;
  resourceId: string;
  owner: string;
  runId: string;
  acquiredAt: string;
  heartbeatAt: string;
  expiresAt: string;
  metadata: Record<string, unknown>;
}

export interface LockReleaseRequest {
  runId?: string;
  force?: boolean;
}

export interface LockReleaseResponse {
  success: boolean;
  doc_id: number;
  released: boolean;
  previous_lock: DurableLock | null;
  message: string;
}

export interface LockListResponse {
  locks: DurableLock[];
}

export interface LockPruneResponse {
  success: boolean;
  pruned: number;
  message: string;
}

export interface OllamaRunningModel {
  name: string;
  model: string;
  size: number;
  size_vram: number;
  expires_at: string;
  parameter_size: string | null;
  quantization: string | null;
}

export interface OllamaStatus {
  running: boolean;
  models: OllamaRunningModel[];
}

// Pending Reviews Types
export type PendingItemType =
  | "correspondent"
  | "document_type"
  | "tag"
  | "human_decision"
  | "consolidation";
export type SchemaItemType =
  | "schema_correspondent"
  | "schema_document_type"
  | "schema_tag"
  | "schema_custom_field"
  | "schema_merge"
  | "schema_delete"
  | "schema_cleanup";
export type AllPendingItemType = PendingItemType | SchemaItemType;

export interface PendingItem {
  id: string;
  docId: number;
  docTitle: string;
  type: AllPendingItemType;
  suggestion: string;
  reasoning: string;
  alternatives: string[];
  attempts: number;
  last_feedback?: string | null;
  lastFeedback?: string | null;
  createdAt?: string;
  created_at?: string;
  metadata: Record<string, unknown>;
  nextTag?: string | null;
  next_tag?: string;
}

export interface EntityOption {
  id: number;
  name: string;
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
  title?: number;
  human_decision?: number;
  consolidation?: number;
  schema?: number;
  total: number;
  // Schema suggestion counts (from bootstrap analysis)
  schema_correspondent: number;
  schema_document_type: number;
  schema_tag: number;
  schema_custom_field: number;
  schema_merge?: number;
  schema_delete?: number;
  schema_cleanup: number;
  metadata_description: number;
}

export interface SearchableEntities {
  correspondents: EntityOption[];
  document_types: EntityOption[];
  tags: EntityOption[];
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
export interface TagMetadataListItem {
  paperless_tag_id: number;
  description: string;
}

export interface TagMetadata {
  id: number;
  paperless_tag_id: number;
  tag_name?: string | null;
  description: string | null;
}

export interface TagMetadataUpdate {
  tag_name?: string;
  description?: string;
}

export interface TagMetadataBulkRequest extends TagMetadataUpdate {
  id: number;
}

export interface TagMetadataBulkResponse {
  id: number;
  description: string | null;
}

export type TagMetadataBulk = TagMetadataBulkRequest;

export interface TagTranslationsResponse {
  tag_id: number;
  translations: Record<string, string>;
  translated_langs: string[];
}

export interface TagOptimizeRequest {
  description: string;
  tag_name: string;
}

export interface TagOptimizeResponse {
  tag_id: number;
  optimized: string;
}

export interface TagTranslateRequest {
  description: string;
  source_lang: string;
}

export interface TagTranslateResponse {
  tag_id: number;
  translations: Array<{ lang: string; text: string }>;
}

export interface CustomFieldMetadata {
  id: number | null;
  name: string;
  data_type: string;
  extra_data: unknown;
}

export interface CustomFieldMetadataUpdate {
  name?: string;
  extra_data?: unknown;
}

export interface CustomFieldMetadataBulk extends CustomFieldMetadataUpdate {
  id: number;
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

export interface AiDocumentTypesUpdateResponse {
  success: boolean;
  selected_type_ids: number[];
}

export interface CustomFieldSetting {
  id: number;
  name: string;
  data_type: string;
  extra_data?: Record<string, unknown> | null;
}

export interface CustomFieldsSettingsResponse {
  fields: CustomFieldSetting[];
  selected_fields: number[];
}

export interface CustomFieldsUpdateResponse {
  success: boolean;
  selected_fields: number[];
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
export type BootstrapAnalysisType = "all" | "correspondents" | "document_types" | "tags";
export type BootstrapStatusType = "idle" | "running" | "completed" | "cancelled" | "failed";

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
  // Enhanced progress tracking
  total_documents: number | null; // Total docs in Paperless (for "covering X documents")
  current_entity_count: number | null; // Count of entities in current phase (e.g., 47 correspondents)
  avg_seconds_per_category: number | null; // For time estimation
  estimated_remaining_seconds: number | null; // ETA calculation
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
export type BulkOCRStatusType = "idle" | "running" | "completed" | "cancelled" | "failed";

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

// Bulk Ingest Types (OCR + Vector DB)
export type BulkIngestStatusType = "idle" | "running" | "completed" | "cancelled" | "error";

export interface BulkIngestProgress {
  status: BulkIngestStatusType;
  total: number;
  processed: number;
  skipped: number;
  errors: number;
  ocr_processed: number;
  vector_indexed: number;
  current_doc_id: number | null;
  current_doc_title: string | null;
  current_phase: "ocr" | "embedding" | "indexing" | null;
  docs_per_second: number;
  started_at: string | null;
  completed_at: string | null;
  error_message: string | null;
}

export interface BulkIngestStartRequest {
  docs_per_second?: number;
  skip_existing_ocr?: boolean;
  run_ocr?: boolean;
  transition_tag?: boolean;
  source_tag?: string;
  target_tag?: string;
}

export interface BulkIngestStartResponse {
  message: string;
  docs_per_second: number;
  run_ocr: boolean;
  status: string;
}

// Processing Logs Types
export type ProcessingLogEventType =
  | "context"
  | "prompt"
  | "response"
  | "thinking"
  | "run_started"
  | "run_completed"
  | "run_cancelled"
  | "run_failed"
  | "lock_acquired"
  | "lock_released"
  | "lock_stale"
  | "agent_message"
  | "tool_call"
  | "tool_result"
  | "question_requested"
  | "question_answered"
  | "stage_started"
  | "stage_completed"
  | "stage_failed"
  | "catalog_proposal_created"
  | "catalog_proposal_applied"
  | "catalog_proposal_rejected"
  | "confirming"
  | "retry"
  | "result"
  | "error"
  | "state_transition";

export interface ProcessingLogEntry {
  id: string;
  docId: number;
  timestamp: string;
  step: string;
  eventType: ProcessingLogEventType;
  data: Record<string, unknown>;
  parentId?: string;
}

export interface ProcessingLogStats {
  totalLogs: number;
  oldestLog: string | null;
  newestLog: string | null;
}

// Document Case Types
export type CaseMetadataEntityKind = "tag" | "correspondent" | "document_type" | "custom_field";
export type CaseRequestedAction = "create" | "map" | "edit" | "skip" | "reject";
export type CaseQuestionAnswerAction =
  | "apply"
  | "reject"
  | "skip"
  | "use_another"
  | "edit_metadata";

export interface CaseProposalCandidate {
  id: number | null;
  name: string;
  exists: boolean;
}

export interface CaseMetadataPatch {
  title?: string;
  correspondentId?: number | null;
  correspondentName?: string | null;
  documentTypeId?: number | null;
  documentTypeName?: string | null;
  tagIds?: number[];
  tagNames?: string[];
}

export interface CaseQuestionAnswerRequest {
  answer: CaseQuestionAnswerAction;
  guidance?: string | null;
  selectedEntityId?: number | null;
  selectedEntityName?: string | null;
  metadataPatch?: CaseMetadataPatch | null;
}

export interface CaseQuestion {
  id: string;
  caseId: string;
  docId: number;
  kind: "metadata_proposal";
  entityKind: CaseMetadataEntityKind;
  candidate: CaseProposalCandidate;
  alternatives: CaseProposalCandidate[];
  requestedAction: CaseRequestedAction;
  evidence: string | null;
  status: "open" | "answered" | "cancelled";
  source: string;
  metadata: Record<string, unknown>;
  createdAt: string;
  answeredAt: string | null;
}

export interface CaseAnswer {
  id: string;
  caseId: string;
  questionId: string;
  docId: number;
  answer: CaseQuestionAnswerAction;
  guidance: string | null;
  selectedCandidate: CaseProposalCandidate | null;
  metadataPatch: CaseMetadataPatch | null;
  createdAt: string;
}

export interface CaseFailureDetail {
  message: string;
  kind: "timeout" | "transient" | "permanent" | "unknown";
  step: string;
  retryable: boolean;
  runId: string | null;
  failedAt: string;
}

export interface DocumentCase {
  id: string;
  docId: number;
  docTitle: string;
  phase: "new" | "ocr" | "metadata" | "index" | "done" | "failed";
  automationStatus: "idle" | "queued" | "running" | "needs_input" | "ready" | "done" | "failed";
  activeRunId: string | null;
  lastRunId: string | null;
  lastFailure: CaseFailureDetail | null;
  questions: CaseQuestion[];
  answers: CaseAnswer[];
  finalDecisions: Record<string, unknown>;
  runSummaries: unknown[];
  memory: Record<string, unknown>;
  transcript: Array<{
    id: string;
    role: "agent" | "user" | "system";
    content: string;
    createdAt: string;
    metadata?: Record<string, unknown>;
  }>;
  createdAt: string;
  updatedAt: string;
}

// Catalog Agent Types
export interface CatalogRun {
  id: string;
  status: "running" | "completed" | "failed";
  runtime: "pi_agent" | "local" | "openai_cli";
  summary: string;
  proposalIds: string[];
  startedAt: string;
  updatedAt: string;
  completedAt: string | null;
  error: string | null;
}

export interface CatalogProposal {
  id: string;
  runId: string;
  type: "merge" | "rename" | "delete" | "delete_unused" | "keep_separate" | "needs_decision";
  entityKind: "tag" | "correspondent" | "document_type" | "custom_field";
  entityId: number | null;
  entityName: string;
  targetEntityId: number | null;
  targetEntityName: string | null;
  reason: string;
  confidence: number;
  usageCount: number;
  customFieldMode: "append" | "update" | "replace" | null;
  payload: Record<string, unknown>;
  status: "proposed" | "approved" | "rejected" | "applied";
  createdAt: string;
  updatedAt: string;
}

// Search Types
export interface SearchResult {
  docId: number;
  score: number;
  title: string;
  tags: string[];
  correspondent?: string;
  documentType?: string;
}

export interface SearchResponse {
  results: SearchResult[];
  query: string;
  total: number;
}

// Chat Types
export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

export interface ChatResponse {
  message: string;
  sources: SearchResult[];
}
