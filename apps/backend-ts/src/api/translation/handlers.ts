/**
 * Translation API handlers.
 *
 * Stub implementations for translation endpoints.
 */
import { Effect } from 'effect';

// ===========================================================================
// Translation
// ===========================================================================

export const translate = (data: {
  text: string;
  source_lang?: string;
  target_lang: string;
}) =>
  Effect.succeed({
    original: data.text,
    translated: data.text, // Stub: return unchanged
    source_lang: data.source_lang ?? 'auto',
    target_lang: data.target_lang,
  });

export const translatePrompts = (sourceLang: string, targetLang: string) =>
  Effect.succeed({
    status: 'completed',
    translated_count: 0,
    failed_count: 0,
    prompts: [],
  });

// ===========================================================================
// Translations Cache
// ===========================================================================

export const getTranslations = (targetLang: string, contentType?: string) =>
  Effect.succeed({
    translations: [],
  });

export const clearCache = (targetLang?: string, contentType?: string) =>
  Effect.succeed({ success: true });

// ===========================================================================
// Languages
// ===========================================================================

export const getLanguages = Effect.succeed({
  languages: [
    { code: 'en', name: 'English' },
    { code: 'de', name: 'German' },
    { code: 'fr', name: 'French' },
    { code: 'es', name: 'Spanish' },
    { code: 'it', name: 'Italian' },
  ],
});
