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
  list: () => fetchApi<PromptInfo[]>("/api/prompts"),
  listGroups: () => fetchApi<PromptGroup[]>("/api/prompts/groups"),
  getPreviewData: () => fetchApi<PreviewData>("/api/prompts/preview-data"),
  get: (name: string) => fetchApi<PromptInfo>(`/api/prompts/${name}`),
  update: (name: string, content: string) =>
    fetchApi<PromptInfo>(`/api/prompts/${name}`, {
      method: "PUT",
      body: JSON.stringify({ content }),
    }),
};

// Types
export interface Settings {
  paperless_url: string;
  paperless_connected: boolean;
  ollama_url: string;
  ollama_model_large: string;
  ollama_model_small: string;
  qdrant_url: string;
  qdrant_collection: string;
  auto_processing_enabled: boolean;
  auto_processing_interval_minutes: number;
  tags: {
    pending: string;
    ocr_done: string;
    correspondent_done: string;
    document_type_done: string;
    title_done: string;
    tags_done: string;
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
