/**
 * Settings API endpoints
 */
import { fetchApi } from "./client";
import type { Settings, ConnectionTest, AiDocumentTypesResponse } from "./types";

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
