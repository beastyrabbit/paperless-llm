/**
 * API client for the Paperless Local LLM backend
 */

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options?: RequestInit
): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const error = await response.text();
      return { error: error || `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { data };
  } catch (error) {
    return { error: String(error) };
  }
}

// Settings API
export const settingsApi = {
  get: () => fetchApi<Settings>("/api/settings"),
  getOllamaStatus: () => fetchApi<OllamaStatus>("/api/settings/ollama/status"),
  update: (data: Partial<Settings>) =>
    fetchApi("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  testConnection: (service: string) =>
    fetchApi<ConnectionTest>(`/api/settings/test-connection/${service}`, {
      method: "POST",
    }),
  // AI Document Types
  getAiDocumentTypes: () =>
    fetchApi<AiDocumentTypesResponse>("/api/settings/ai-document-types"),
  updateAiDocumentTypes: (selectedTypeIds: number[]) =>
    fetchApi("/api/settings/ai-document-types", {
      method: "PATCH",
      body: JSON.stringify({ selected_type_ids: selectedTypeIds }),
    }),
  // Processing Logs
  getProcessingLogStats: () =>
    fetchApi<ProcessingLogStats>("/api/settings/processing-logs/stats"),
  clearAllProcessingLogs: () =>
    fetchApi<{ success: boolean; message: string }>("/api/settings/processing-logs", {
      method: "DELETE",
    }),
};

// Documents API
export const documentsApi = {
  getQueue: () => fetchApi<QueueStats>("/api/documents/queue"),
  getPending: (tag?: string, limit = 50) =>
    fetchApi<DocumentSummary[]>(
      `/api/documents/pending?${new URLSearchParams({
        ...(tag && { tag }),
        limit: String(limit),
      })}`
    ),
  get: (id: number) => fetchApi<DocumentDetail>(`/api/documents/${id}`),
  getContent: (id: number) =>
    fetchApi<{ id: number; content: string }>(`/api/documents/${id}/content`),
  getPdfUrl: (id: number) => `${API_BASE}/api/documents/${id}/pdf`,
};

// Processing API
export const processingApi = {
  start: (docId: number, step?: string) =>
    fetchApi(`/api/processing/${docId}/start`, {
      method: "POST",
      body: JSON.stringify({ step }),
    }),
  stream: (docId: number, options?: { step?: string; full?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.step) params.set("step", options.step);
    if (options?.full) params.set("full", "true");
    const query = params.toString();
    const url = `${API_BASE}/api/processing/${docId}/stream${query ? `?${query}` : ""}`;
    return new EventSource(url);
  },
  confirm: (docId: number, confirmed: boolean) =>
    fetchApi(`/api/processing/${docId}/confirm?confirmed=${confirmed}`, {
      method: "POST",
    }),
  getStatus: () => fetchApi<ProcessingStatus>("/api/processing/status"),
  getLogs: (docId: number) =>
    fetchApi<{ logs: ProcessingLogEntry[] }>(`/api/processing/${docId}/logs`),
  clearLogs: (docId: number) =>
    fetchApi<{ success: boolean }>(`/api/processing/${docId}/logs`, {
      method: "DELETE",
    }),
  // Auto Processing
  getAutoStatus: () => fetchApi<AutoProcessingStatus>("/api/processing/auto/status"),
  triggerAuto: () => fetchApi<AutoProcessingTriggerResponse>("/api/processing/auto/trigger", {
    method: "POST",
  }),
};

// Prompts API
export const promptsApi = {
  list: (lang?: string) =>
    fetchApi<PromptInfo[]>(`/api/prompts${lang ? `?lang=${lang}` : ""}`),
  listGroups: (lang?: string) =>
    fetchApi<PromptGroup[]>(`/api/prompts/groups${lang ? `?lang=${lang}` : ""}`),
  getPreviewData: () => fetchApi<PreviewData>("/api/prompts/preview-data"),
  get: (name: string, lang?: string) =>
    fetchApi<PromptInfo>(`/api/prompts/${name}${lang ? `?lang=${lang}` : ""}`),
  update: (name: string, content: string, lang?: string) =>
    fetchApi<PromptInfo>(`/api/prompts/${name}${lang ? `?lang=${lang}` : ""}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
  getLanguages: () => fetchApi<AvailableLanguagesResponse>("/api/prompts/languages"),
};

// Pending Reviews API
export const pendingApi = {
  list: (type?: PendingItemType) =>
    fetchApi<PendingItem[]>(`/api/pending${type ? `?type=${type}` : ""}`),
  getCounts: () => fetchApi<PendingCounts>("/api/pending/counts"),
  approve: (itemId: string, selectedValue?: string) =>
    fetchApi<PendingApproveResponse>(`/api/pending/${itemId}/approve`, {
      method: "POST",
      body: JSON.stringify({ selected_value: selectedValue }),
    }),
  reject: (itemId: string) =>
    fetchApi<{ success: boolean }>(`/api/pending/${itemId}/reject`, {
      method: "POST",
    }),
  rejectWithFeedback: (reviewId: string, request: RejectWithFeedbackRequest) =>
    fetchApi<RejectWithFeedbackResponse>(`/api/pending/${reviewId}/reject-with-feedback`, {
      method: "POST",
      body: JSON.stringify(request),
    }),
  searchEntities: () => fetchApi<SearchableEntities>("/api/pending/search-entities"),
  getBlocked: () => fetchApi<BlockedItemsResponse>("/api/pending/blocked"),
  unblock: (blockId: number) =>
    fetchApi<{ success: boolean; unblocked_id: number }>(`/api/pending/blocked/${blockId}`, {
      method: "DELETE",
    }),
  approveCleanup: (itemId: string, finalName?: string) =>
    fetchApi<SchemaCleanupApproveResponse>(`/api/pending/${itemId}/approve-cleanup`, {
      method: "POST",
      body: JSON.stringify({ final_name: finalName }),
    }),
  // Pending cleanup (merge similar suggestions)
  findSimilar: (threshold?: number) =>
    fetchApi<SimilarGroupsResponse>(
      `/api/pending/similar${threshold ? `?threshold=${threshold}` : ""}`
    ),
  mergeSuggestions: (itemIds: string[], finalName: string) =>
    fetchApi<MergePendingResponse>("/api/pending/merge", {
      method: "POST",
      body: JSON.stringify({ item_ids: itemIds, final_name: finalName }),
    }),
};

// Metadata API
export const metadataApi = {
  // Tags
  listTags: () => fetchApi<TagMetadata[]>("/api/metadata/tags"),
  getTag: (tagId: number) => fetchApi<TagMetadata>(`/api/metadata/tags/${tagId}`),
  updateTag: (tagId: number, data: TagMetadataUpdate) =>
    fetchApi<TagMetadata>(`/api/metadata/tags/${tagId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteTag: (tagId: number) =>
    fetchApi<{ deleted: boolean }>(`/api/metadata/tags/${tagId}`, {
      method: "DELETE",
    }),
  bulkUpdateTags: (items: TagMetadataBulk[]) =>
    fetchApi<TagMetadata[]>("/api/metadata/tags/bulk", {
      method: "POST",
      body: JSON.stringify(items),
    }),

  // Custom Fields
  listCustomFields: () =>
    fetchApi<CustomFieldMetadata[]>("/api/metadata/custom-fields"),
  getCustomField: (fieldId: number) =>
    fetchApi<CustomFieldMetadata>(`/api/metadata/custom-fields/${fieldId}`),
  updateCustomField: (fieldId: number, data: CustomFieldMetadataUpdate) =>
    fetchApi<CustomFieldMetadata>(`/api/metadata/custom-fields/${fieldId}`, {
      method: "PUT",
      body: JSON.stringify(data),
    }),
  deleteCustomField: (fieldId: number) =>
    fetchApi<{ deleted: boolean }>(`/api/metadata/custom-fields/${fieldId}`, {
      method: "DELETE",
    }),
  bulkUpdateCustomFields: (items: CustomFieldMetadataBulk[]) =>
    fetchApi<CustomFieldMetadata[]>("/api/metadata/custom-fields/bulk", {
      method: "POST",
      body: JSON.stringify(items),
    }),
};

// Schema API (Blocked Suggestions)
export const schemaApi = {
  getBlocked: (blockType?: string) =>
    fetchApi<BlockedSuggestion[]>(
      `/api/schema/blocked${blockType ? `?block_type=${blockType}` : ""}`
    ),
  block: (request: BlockSuggestionRequest) =>
    fetchApi<BlockedSuggestion>("/api/schema/blocked", {
      method: "POST",
      body: JSON.stringify(request),
    }),
  unblock: (id: number) =>
    fetchApi<void>(`/api/schema/blocked/${id}`, {
      method: "DELETE",
    }),
  checkBlocked: (name: string, blockType: string) =>
    fetchApi<{ is_blocked: boolean }>(
      `/api/schema/blocked/check?name=${encodeURIComponent(name)}&block_type=${blockType}`
    ),
};

// Jobs API
export const jobsApi = {
  getStatus: () => fetchApi<Record<string, JobStatus>>("/api/jobs/status"),
  getJobStatus: (jobName: string) =>
    fetchApi<JobStatus>(`/api/jobs/status/${jobName}`),
  triggerMetadataEnhancement: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/metadata-enhancement/run", {
      method: "POST",
    }),
  triggerSchemaCleanup: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/schema-cleanup/run", {
      method: "POST",
    }),
  // Bootstrap Analysis
  startBootstrap: (analysisType: BootstrapAnalysisType) =>
    fetchApi<BootstrapStartResponse>("/api/jobs/bootstrap/start", {
      method: "POST",
      body: JSON.stringify({ analysis_type: analysisType }),
    }),
  getBootstrapStatus: () =>
    fetchApi<BootstrapProgress>("/api/jobs/bootstrap/status"),
  cancelBootstrap: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bootstrap/cancel", {
      method: "POST",
    }),
  skipBootstrapDocument: (count: number = 1) =>
    fetchApi<{ message: string; status: string; count?: number }>(
      `/api/jobs/bootstrap/skip?count=${count}`,
      {
        method: "POST",
      }
    ),
  // Job Schedules
  getSchedules: () =>
    fetchApi<JobScheduleStatus>("/api/jobs/schedule"),
  updateSchedule: (request: ScheduleUpdateRequest) =>
    fetchApi<ScheduleUpdateResponse>("/api/jobs/schedule", {
      method: "PATCH",
      body: JSON.stringify(request),
    }),
  // Bulk OCR
  startBulkOCR: (docsPerSecond: number, skipExisting: boolean) =>
    fetchApi<BulkOCRStartResponse>("/api/jobs/bulk-ocr/start", {
      method: "POST",
      body: JSON.stringify({ docs_per_second: docsPerSecond, skip_existing: skipExisting }),
    }),
  getBulkOCRStatus: () =>
    fetchApi<BulkOCRProgress>("/api/jobs/bulk-ocr/status"),
  cancelBulkOCR: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bulk-ocr/cancel", {
      method: "POST",
    }),
  // Bulk Ingest (OCR + Vector DB)
  startBulkIngest: (request: BulkIngestStartRequest) =>
    fetchApi<BulkIngestStartResponse>("/api/jobs/bulk-ingest/start", {
      method: "POST",
      body: JSON.stringify(request),
    }),
  getBulkIngestStatus: () =>
    fetchApi<BulkIngestProgress>("/api/jobs/bulk-ingest/status"),
  cancelBulkIngest: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bulk-ingest/cancel", {
      method: "POST",
    }),
};

// Search API
export const searchApi = {
  search: (query: string, limit = 10) =>
    fetchApi<SearchResponse>(
      `/api/search?${new URLSearchParams({ q: query, limit: String(limit) })}`
    ),
};

// Chat API
export const chatApi = {
  send: (messages: ChatMessage[]) =>
    fetchApi<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
};

// Translation API
export const translationApi = {
  translate: (data: TranslateRequest) =>
    fetchApi<TranslateResponse>("/api/translation/translate", {
      method: "POST",
      body: JSON.stringify(data),
    }),
  translatePrompts: (sourceLang: string, targetLang: string) =>
    fetchApi<TranslatePromptsResponse>("/api/translation/translate/prompts", {
      method: "POST",
      body: JSON.stringify({ source_lang: sourceLang, target_lang: targetLang }),
    }),
  getTranslations: (targetLang: string, contentType?: string) =>
    fetchApi<{ translations: TranslationEntry[] }>(
      `/api/translation/translations/${targetLang}${contentType ? `?content_type=${contentType}` : ""}`
    ),
  clearCache: (targetLang?: string, contentType?: string) =>
    fetchApi<{ success: boolean }>("/api/translation/cache/clear", {
      method: "POST",
      body: JSON.stringify({ target_lang: targetLang, content_type: contentType }),
    }),
  getLanguages: () =>
    fetchApi<{ languages: { code: string; name: string }[] }>("/api/translation/languages"),
};

// Types
export interface Settings {
  paperless_url: string;
  paperless_external_url: string;
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
  document_type: string | null;
  document_type_id: number | null;
  created: string;
  modified: string;
  added: string;
  tags: Array<{ id: number; name: string }>;
  custom_fields: Array<{ field: number; value: unknown }>;
  content: string | null;
  original_file_name: string | null;
  archive_serial_number: number | null;
}

export interface ProcessingStatus {
  auto_processing: boolean;
  interval_minutes: number;
  currently_processing: number | null;
  queue_position: number;
}

export interface AutoProcessingStatus {
  running: boolean;
  enabled: boolean;
  interval_minutes: number;
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

export interface PromptInfo {
  name: string;
  filename: string;
  content: string;
  variables: string[];
  description: string | null;
}

export interface PromptGroup {
  name: string;
  category: 'document' | 'system';
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
export type SchemaItemType = "schema_correspondent" | "schema_document_type" | "schema_tag" | "schema_custom_field" | "schema_cleanup";
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
  documentlink: number;
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
  total_documents: number | null;           // Total docs in Paperless (for "covering X documents")
  current_entity_count: number | null;      // Count of entities in current phase (e.g., 47 correspondents)
  avg_seconds_per_category: number | null;  // For time estimation
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
  | "tool_call"
  | "tool_result"
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
