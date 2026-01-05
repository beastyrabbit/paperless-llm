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
  stream: (docId: number, step?: string) => {
    const url = `${API_BASE}/api/processing/${docId}/stream${
      step ? `?step=${step}` : ""
    }`;
    return new EventSource(url);
  },
  confirm: (docId: number, confirmed: boolean) =>
    fetchApi(`/api/processing/${docId}/confirm?confirmed=${confirmed}`, {
      method: "POST",
    }),
  getStatus: () => fetchApi<ProcessingStatus>("/api/processing/status"),
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

export interface PendingItem {
  id: string;
  doc_id: number;
  doc_title: string;
  type: PendingItemType;
  suggestion: string;
  reasoning: string;
  alternatives: string[];
  attempts: number;
  last_feedback: string | null;
  created_at: string;
  metadata: Record<string, unknown>;
}

export interface PendingCounts {
  correspondent: number;
  document_type: number;
  tag: number;
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
