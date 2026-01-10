/**
 * Translation API endpoints
 */
import { fetchApi } from "./client";
import type {
  TranslateRequest,
  TranslateResponse,
  TranslatePromptsResponse,
  TranslationEntry,
} from "./types";

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
      body: JSON.stringify({
        target_lang: targetLang,
        content_type: contentType,
      }),
    }),

  getLanguages: () =>
    fetchApi<{ languages: { code: string; name: string }[] }>(
      "/api/translation/languages"
    ),
};
