/**
 * API client for the Paperless Local LLM backend
 */

import type {
  ApiValidationIssue,
  ApiResponse,
  Settings,
  ConnectionTest,
  OllamaModelsResponse,
  MistralModelsResponse,
  OpenAICodexModelsResponse,
  WorkflowTagsStatusResponse,
  WorkflowTagsCreateResponse,
  WorkflowTagColorFixResponse,
  AiTagsResponse,
  AiTagsUpdateResponse,
  QueueStats,
  DocumentSummary,
  DocumentDetail,
  ProcessingStatus,
  AutoProcessingStatus,
  AutoProcessingTriggerResponse,
  LockListResponse,
  LockPruneResponse,
  LockReleaseRequest,
  LockReleaseResponse,
  OllamaStatus,
  PendingItemType,
  PendingItem,
  SchemaCleanupApproveResponse,
  PendingCounts,
  SearchableEntities,
  SimilarGroupsResponse,
  MergePendingResponse,
  BlockedItemsResponse,
  PendingApproveResponse,
  TagMetadata,
  TagMetadataListItem,
  TagMetadataUpdate,
  TagMetadataBulkRequest,
  TagMetadataBulkResponse,
  TagTranslationsResponse,
  TagOptimizeRequest,
  TagOptimizeResponse,
  TagTranslateRequest,
  TagTranslateResponse,
  CustomFieldMetadata,
  CustomFieldMetadataUpdate,
  CustomFieldMetadataBulk,
  AiDocumentTypesResponse,
  AiDocumentTypesUpdateResponse,
  CustomFieldsSettingsResponse,
  CustomFieldsUpdateResponse,
  TranslateRequest,
  TranslateResponse,
  TranslationEntry,
  BlockedSuggestion,
  BlockSuggestionRequest,
  JobStatus,
  RejectWithFeedbackRequest,
  RejectWithFeedbackResponse,
  BootstrapAnalysisType,
  BootstrapProgress,
  BootstrapStartResponse,
  JobScheduleStatus,
  ScheduleUpdateRequest,
  ScheduleUpdateResponse,
  BulkOCRProgress,
  BulkOCRStartResponse,
  BulkIngestProgress,
  BulkIngestStartRequest,
  BulkIngestStartResponse,
  ProcessingLogEntry,
  ProcessingLogStats,
  CaseQuestionAnswerRequest,
  DocumentCase,
  CatalogRun,
  CatalogProposal,
  SearchResponse,
  ChatMessage,
  ChatResponse,
} from "@repo/api-contracts";

export type {
  ApiValidationIssue,
  ApiResponse,
  Settings,
  ConnectionTest,
  OllamaModel,
  OllamaModelsResponse,
  MistralModel,
  MistralModelsResponse,
  OpenAICodexModel,
  OpenAICodexModelsResponse,
  WorkflowTagStatus,
  WorkflowTagsStatusResponse,
  WorkflowTagsCreateResponse,
  WorkflowTagColorFixResponse,
  AiTag,
  AiTagsResponse,
  AiTagsUpdateResponse,
  QueueStats,
  DocumentSummary,
  DocumentDetail,
  ProcessingStatus,
  AutoProcessingStatus,
  AutoProcessingTriggerResponse,
  DurableLock,
  LockListResponse,
  LockPruneResponse,
  LockReleaseRequest,
  LockReleaseResponse,
  LockScope,
  OllamaRunningModel,
  OllamaStatus,
  PendingItemType,
  SchemaItemType,
  AllPendingItemType,
  PendingItem,
  EntityOption,
  SchemaCleanupType,
  SchemaEntityType,
  SchemaCleanupMetadata,
  SchemaCleanupApproveResponse,
  PendingCounts,
  SearchableEntities,
  SimilarGroup,
  SimilarGroupsResponse,
  MergePendingResponse,
  BlockedItem,
  BlockedItemsResponse,
  PendingApproveResponse,
  TagMetadata,
  TagMetadataListItem,
  TagMetadataUpdate,
  TagMetadataBulkRequest,
  TagMetadataBulkResponse,
  TagMetadataBulk,
  TagTranslationsResponse,
  TagOptimizeRequest,
  TagOptimizeResponse,
  TagTranslateRequest,
  TagTranslateResponse,
  CustomFieldMetadata,
  CustomFieldMetadataUpdate,
  CustomFieldMetadataBulk,
  DocumentTypeInfo,
  AiDocumentTypesResponse,
  AiDocumentTypesUpdateResponse,
  CustomFieldSetting,
  CustomFieldsSettingsResponse,
  CustomFieldsUpdateResponse,
  TranslateRequest,
  TranslateResponse,
  TranslationEntry,
  BlockType,
  RejectionCategory,
  BlockedSuggestion,
  BlockSuggestionRequest,
  JobStatusType,
  JobStatus,
  RejectBlockType,
  RejectWithFeedbackRequest,
  RejectWithFeedbackResponse,
  BootstrapAnalysisType,
  BootstrapStatusType,
  SuggestionsByType,
  BootstrapProgress,
  BootstrapStartResponse,
  ScheduleType,
  JobScheduleInfo,
  JobScheduleStatus,
  ScheduleUpdateRequest,
  ScheduleUpdateResponse,
  BulkOCRStatusType,
  BulkOCRProgress,
  BulkOCRStartResponse,
  BulkIngestStatusType,
  BulkIngestProgress,
  BulkIngestStartRequest,
  BulkIngestStartResponse,
  ProcessingLogEventType,
  ProcessingLogEntry,
  ProcessingLogStats,
  CaseMetadataEntityKind,
  CaseRequestedAction,
  CaseQuestionAnswerAction,
  CaseProposalCandidate,
  CaseMetadataPatch,
  CaseQuestionAnswerRequest,
  CaseQuestion,
  CaseAnswer,
  CaseFailureDetail,
  DocumentCase,
  CatalogRun,
  CatalogProposal,
  SearchResult,
  SearchResponse,
  ChatMessage,
  ChatResponse,
} from "@repo/api-contracts";

export const API_BASE = "";

const readErrorResponse = async (
  response: Response,
): Promise<{ error: string; issues?: ApiValidationIssue[] }> => {
  const text = await response.text().catch(() => "");
  if (!text) return { error: `HTTP ${response.status}` };
  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
      issues?: ApiValidationIssue[];
    };
    return {
      error: payload.message ?? payload.error ?? text,
      issues: Array.isArray(payload.issues) ? payload.issues : undefined,
    };
  } catch {
    return { error: text };
  }
};

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const { error, issues } = await readErrorResponse(response);
      return { ok: false, error, status: response.status, issues };
    }

    const data = await response.json();
    return { ok: true, data, status: response.status };
  } catch (error) {
    return { ok: false, error: String(error), status: 0 };
  }
}

// Settings API
export const settingsApi = {
  get: () => fetchApi<Settings>("/api/settings"),
  getOllamaStatus: () => fetchApi<OllamaStatus>("/api/settings/ollama/status"),
  getOllamaModels: () => fetchApi<OllamaModelsResponse>("/api/settings/ollama/models"),
  getMistralModels: () => fetchApi<MistralModelsResponse>("/api/settings/mistral/models"),
  getOpenAICodexModels: () =>
    fetchApi<OpenAICodexModelsResponse>("/api/settings/openai-codex/models"),
  update: (data: Partial<Settings>) =>
    fetchApi("/api/settings", {
      method: "PATCH",
      body: JSON.stringify(data),
    }),
  testConnection: (service: string) =>
    fetchApi<ConnectionTest>(`/api/settings/test-connection/${service}`, {
      method: "POST",
    }),
  getWorkflowTagsStatus: () => fetchApi<WorkflowTagsStatusResponse>("/api/settings/tags/status"),
  createWorkflowTags: (tagNames: string[]) =>
    fetchApi<WorkflowTagsCreateResponse>("/api/settings/tags/create", {
      method: "POST",
      body: JSON.stringify({ tag_names: tagNames }),
    }),
  fixWorkflowTagColors: () =>
    fetchApi<WorkflowTagColorFixResponse>("/api/settings/tags/fix-colors", {
      method: "POST",
    }),
  // AI Document Types
  getAiDocumentTypes: () => fetchApi<AiDocumentTypesResponse>("/api/settings/ai-document-types"),
  updateAiDocumentTypes: (selectedTypeIds: number[]) =>
    fetchApi<AiDocumentTypesUpdateResponse>("/api/settings/ai-document-types", {
      method: "PATCH",
      body: JSON.stringify({ selected_type_ids: selectedTypeIds }),
    }),
  // Custom fields used by the processing pipeline
  getCustomFields: () => fetchApi<CustomFieldsSettingsResponse>("/api/settings/custom-fields"),
  updateCustomFields: (selectedFieldIds: number[]) =>
    fetchApi<CustomFieldsUpdateResponse>("/api/settings/custom-fields", {
      method: "PATCH",
      body: JSON.stringify({ selected_field_ids: selectedFieldIds }),
    }),
  // AI Tags
  getAiTags: () => fetchApi<AiTagsResponse>("/api/settings/ai-tags"),
  updateAiTags: (selectedTagIds: number[]) =>
    fetchApi<AiTagsUpdateResponse>("/api/settings/ai-tags", {
      method: "PATCH",
      body: JSON.stringify({ selected_tag_ids: selectedTagIds }),
    }),
  // Processing Logs
  getProcessingLogStats: () => fetchApi<ProcessingLogStats>("/api/settings/processing-logs/stats"),
  clearAllProcessingLogs: () =>
    fetchApi<{ success: boolean; message: string }>("/api/settings/processing-logs", {
      method: "DELETE",
    }),
};

// Documents API
export const documentsApi = {
  getQueue: () => fetchApi<QueueStats>("/api/documents/queue"),
  getPending: (tag?: string, limit = 50, options?: RequestInit) =>
    fetchApi<DocumentSummary[]>(
      `/api/documents/pending?${new URLSearchParams({
        ...(tag && { tag }),
        limit: String(limit),
      })}`,
      options,
    ),
  get: (id: number, options?: RequestInit) =>
    fetchApi<DocumentDetail>(`/api/documents/${id}`, options),
  getContent: (id: number) =>
    fetchApi<{ id: number; content: string }>(`/api/documents/${id}/content`),
  getPdfUrl: (id: number) => `${API_BASE}/api/documents/${id}/pdf`,
};

// Processing API
export const processingApi = {
  start: (docId: number, step?: string, dryRun?: boolean) =>
    fetchApi(`/api/processing/${docId}/start`, {
      method: "POST",
      body: JSON.stringify({ step, dryRun }),
    }),
  stream: (docId: number, options?: { step?: string; full?: boolean; dryRun?: boolean }) => {
    const params = new URLSearchParams();
    if (options?.step) params.set("step", options.step);
    if (options?.full) params.set("full", "true");
    if (options?.dryRun) params.set("dryRun", "true");
    const query = params.toString();
    const url = `${API_BASE}/api/processing/${docId}/stream${query ? `?${query}` : ""}`;
    return new EventSource(url);
  },
  confirm: (docId: number, confirmed: boolean) =>
    fetchApi(`/api/processing/${docId}/confirm?confirmed=${confirmed}`, {
      method: "POST",
    }),
  cancel: (docId: number, options: { runId?: string | null; reason?: string } = {}) =>
    fetchApi<{
      status: "cancelling" | "cancelled_orphaned_run" | "no_active_run" | "run_mismatch";
      doc_id: number;
      run_id?: string;
      lock_released?: boolean;
      lock_run_id?: string | null;
      active_run_id?: string;
      requested_run_id?: string;
    }>(`/api/processing/${docId}/cancel`, {
      method: "POST",
      body: JSON.stringify({ runId: options.runId ?? undefined, reason: options.reason }),
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
  triggerAuto: () =>
    fetchApi<AutoProcessingTriggerResponse>("/api/processing/auto/trigger", {
      method: "POST",
    }),
  listLocks: () => fetchApi<LockListResponse>("/api/processing/locks"),
  pruneLocks: () =>
    fetchApi<LockPruneResponse>("/api/processing/locks/prune", {
      method: "POST",
    }),
  releaseLock: (docId: number, body: LockReleaseRequest = { force: true }) =>
    fetchApi<LockReleaseResponse>(`/api/processing/${docId}/release-lock`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
};

// Document Cases API
export const casesApi = {
  list: (status?: "queued" | "needs_input" | "running" | "failed" | "done" | "open") =>
    fetchApi<{ cases: DocumentCase[] }>(`/api/cases${status ? `?status=${status}` : ""}`),
  getForDocument: (docId: number) => fetchApi<DocumentCase>(`/api/cases/document/${docId}`),
  run: (docId: number, options?: { resume?: boolean; rerun?: boolean; dryRun?: boolean }) =>
    fetchApi<{ case: DocumentCase | null; result: unknown }>(`/api/cases/document/${docId}/run`, {
      method: "POST",
      body: JSON.stringify(options ?? {}),
    }),
  answerQuestion: (questionId: string, body: CaseQuestionAnswerRequest) =>
    fetchApi<DocumentCase>(`/api/cases/questions/${questionId}/answer`, {
      method: "POST",
      body: JSON.stringify(body),
    }),
  getLogs: (docId: number) =>
    fetchApi<{ logs: ProcessingLogEntry[] }>(`/api/cases/document/${docId}/logs`),
  stream: (docId: number) => new EventSource(`${API_BASE}/api/cases/document/${docId}/stream`),
};

// Catalog Agent API
export const catalogApi = {
  startRun: (runtime: "pi_agent" | "local" | "openai_cli" = "pi_agent") =>
    fetchApi<CatalogRun>("/api/catalog/runs", {
      method: "POST",
      body: JSON.stringify({ runtime }),
    }),
  listRuns: () => fetchApi<{ runs: CatalogRun[] }>("/api/catalog/runs"),
  listProposals: (runId?: string) =>
    fetchApi<{ proposals: CatalogProposal[] }>(
      `/api/catalog/proposals${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`,
    ),
  decideProposal: (proposalId: string, decision: "approved" | "rejected") =>
    fetchApi<CatalogProposal>(`/api/catalog/proposals/${proposalId}/decision`, {
      method: "POST",
      body: JSON.stringify({ decision }),
    }),
  applyProposal: (proposalId: string) =>
    fetchApi<CatalogProposal>(`/api/catalog/proposals/${proposalId}/apply`, {
      method: "POST",
    }),
  getLogs: (runId?: string) =>
    fetchApi<{ logs: ProcessingLogEntry[] }>(
      `/api/catalog/logs${runId ? `?run_id=${encodeURIComponent(runId)}` : ""}`,
    ),
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
      `/api/pending/similar${threshold ? `?threshold=${threshold}` : ""}`,
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
  listTags: () => fetchApi<TagMetadataListItem[]>("/api/metadata/tags"),
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
  bulkUpdateTags: (items: TagMetadataBulkRequest[]) =>
    fetchApi<TagMetadataBulkResponse[]>("/api/metadata/tags/bulk", {
      method: "POST",
      body: JSON.stringify(items),
    }),
  getTagTranslations: (tagId: number) =>
    fetchApi<TagTranslationsResponse>(`/api/metadata/tags/${tagId}/translations`),
  optimizeTagDescription: (tagId: number, data: TagOptimizeRequest) =>
    fetchApi<TagOptimizeResponse>(`/api/metadata/tags/${tagId}/optimize-description`, {
      method: "POST",
      body: JSON.stringify(data),
    }),
  translateTagDescription: (tagId: number, data: TagTranslateRequest) =>
    fetchApi<TagTranslateResponse>(`/api/metadata/tags/${tagId}/translate-description`, {
      method: "POST",
      body: JSON.stringify(data),
    }),

  // Custom Fields
  listCustomFields: () => fetchApi<CustomFieldMetadata[]>("/api/metadata/custom-fields"),
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
      `/api/schema/blocked${blockType ? `?block_type=${blockType}` : ""}`,
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
      `/api/schema/blocked/check?name=${encodeURIComponent(name)}&block_type=${blockType}`,
    ),
};

// Jobs API
export const jobsApi = {
  getStatus: () => fetchApi<Record<string, JobStatus>>("/api/jobs/status"),
  getJobStatus: (jobName: string) => fetchApi<JobStatus>(`/api/jobs/status/${jobName}`),
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
  getBootstrapStatus: () => fetchApi<BootstrapProgress>("/api/jobs/bootstrap/status"),
  cancelBootstrap: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bootstrap/cancel", {
      method: "POST",
    }),
  skipBootstrapDocument: (count: number = 1) =>
    fetchApi<{ message: string; status: string; count?: number }>("/api/jobs/bootstrap/skip", {
      method: "POST",
      body: JSON.stringify({ count }),
    }),
  // Job Schedules
  getSchedules: () => fetchApi<JobScheduleStatus>("/api/jobs/schedule"),
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
  getBulkOCRStatus: () => fetchApi<BulkOCRProgress>("/api/jobs/bulk-ocr/status"),
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
  getBulkIngestStatus: () => fetchApi<BulkIngestProgress>("/api/jobs/bulk-ingest/status"),
  cancelBulkIngest: () =>
    fetchApi<{ message: string; status: string }>("/api/jobs/bulk-ingest/cancel", {
      method: "POST",
    }),
};

// Search API
export const searchApi = {
  search: (query: string, limit = 10) =>
    fetchApi<SearchResponse>(
      `/api/search?${new URLSearchParams({ q: query, limit: String(limit) })}`,
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
  getTranslations: (targetLang: string, contentType?: string) =>
    fetchApi<{ translations: TranslationEntry[] }>(
      `/api/translation/translations/${targetLang}${contentType ? `?content_type=${contentType}` : ""}`,
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
