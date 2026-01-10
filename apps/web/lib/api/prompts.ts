/**
 * Prompts API endpoints
 */
import { fetchApi } from "./client";
import type {
  PromptInfo,
  PromptGroup,
  PreviewData,
  AvailableLanguagesResponse,
} from "./types";

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

  getLanguages: () =>
    fetchApi<AvailableLanguagesResponse>("/api/prompts/languages"),
};
