/**
 * Processing API endpoints
 */
import { fetchApi, API_BASE } from "./client";
import type { ProcessingStatus } from "./types";

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
