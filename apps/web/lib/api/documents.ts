/**
 * Documents API endpoints
 */
import { fetchApi, API_BASE } from "./client";
import type { QueueStats, DocumentSummary, DocumentDetail } from "./types";

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
