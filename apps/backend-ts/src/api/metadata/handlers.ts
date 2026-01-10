/**
 * Metadata API handlers.
 *
 * Real implementations that store tag descriptions and translations in TinyBase.
 */
import { Effect } from 'effect';
import { TinyBaseService } from '../../services/TinyBaseService.js';
import { OllamaService } from '../../services/OllamaService.js';

// ===========================================================================
// Tags - with descriptions stored in TinyBase
// ===========================================================================

// Get all tag metadata (descriptions)
export const listTags = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  const allSettings = yield* tinybase.getAllSettings();

  // Find all tag description keys
  const tagMeta: Array<{ paperless_tag_id: number; description: string }> = [];

  for (const [key, value] of Object.entries(allSettings)) {
    if (key.startsWith('tag_description_')) {
      const tagId = parseInt(key.replace('tag_description_', ''), 10);
      if (!isNaN(tagId) && value) {
        tagMeta.push({
          paperless_tag_id: tagId,
          description: value,
        });
      }
    }
  }

  return tagMeta;
});

// Get single tag metadata
export const getTag = (tagId: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const description = yield* tinybase.getSetting(`tag_description_${tagId}`);

    return {
      id: tagId,
      paperless_tag_id: tagId,
      description: description || null,
    };
  });

// Update tag metadata (description)
export const updateTag = (tagId: number, data: { tag_name?: string; description?: string }) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    if (data.description !== undefined) {
      yield* tinybase.setSetting(`tag_description_${tagId}`, data.description);
    }

    return {
      id: tagId,
      paperless_tag_id: tagId,
      tag_name: data.tag_name || null,
      description: data.description || null,
    };
  });

export const deleteTag = (tagId: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    yield* tinybase.setSetting(`tag_description_${tagId}`, '');

    // Also delete any translations
    const allSettings = yield* tinybase.getAllSettings();
    for (const key of Object.keys(allSettings)) {
      if (key.startsWith(`tag_translation_${tagId}_`)) {
        yield* tinybase.setSetting(key, '');
      }
    }

    return { deleted: true };
  });

export const bulkUpdateTags = (items: Array<{ id: number; tag_name?: string; description?: string }>) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const results: Array<{ id: number; description: string | null }> = [];

    for (const item of items) {
      if (item.description !== undefined) {
        yield* tinybase.setSetting(`tag_description_${item.id}`, item.description);
      }
      const desc = yield* tinybase.getSetting(`tag_description_${item.id}`);
      results.push({
        id: item.id,
        description: desc || null,
      });
    }

    return results;
  });

// ===========================================================================
// Tag Translations
// ===========================================================================

// Get all translations for a tag
export const getTagTranslations = (tagId: number) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    const allSettings = yield* tinybase.getAllSettings();

    const translations: Record<string, string> = {};
    const translatedLangs: string[] = [];

    for (const [key, value] of Object.entries(allSettings)) {
      const prefix = `tag_translation_${tagId}_`;
      if (key.startsWith(prefix) && value) {
        const lang = key.substring(prefix.length);
        translations[lang] = value;
        translatedLangs.push(lang);
      }
    }

    return {
      tag_id: tagId,
      translations,
      translated_langs: translatedLangs,
    };
  });

// Update translation for a specific language
export const updateTagTranslation = (tagId: number, lang: string, data: { text: string }) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;
    yield* tinybase.setSetting(`tag_translation_${tagId}_${lang}`, data.text);

    return {
      tag_id: tagId,
      lang,
      text: data.text,
    };
  });

// ===========================================================================
// Tag AI Operations (Optimize & Translate)
// ===========================================================================

// Supported UI/prompt languages
const SUPPORTED_LANGS = ['en', 'de', 'fr', 'es', 'it', 'nl', 'pt', 'pl', 'ru', 'ja', 'zh'];

// Optimize tag description using LLM
export const optimizeTagDescription = (
  tagId: number,
  data: { description: string; tag_name: string }
) =>
  Effect.gen(function* () {
    const ollama = yield* OllamaService;
    const model = ollama.getModel('small');

    const prompt = `You are helping to optimize a tag description for a document management system.

Tag name: "${data.tag_name}"
Current description: "${data.description}"

Please rewrite this description to be:
1. Clear and concise (1-2 sentences max)
2. Focused on WHEN to use this tag (what kinds of documents should have it)
3. Written in the same language as the input

Return ONLY the optimized description text, nothing else.`;

    const result = yield* ollama.generate(model, prompt, {
      temperature: 0.3,
      num_predict: 200,
    });

    return {
      tag_id: tagId,
      optimized: result.trim(),
    };
  });

// Translate tag description to all supported languages
export const translateTagDescription = (
  tagId: number,
  data: { description: string; source_lang: string }
) =>
  Effect.gen(function* () {
    const ollama = yield* OllamaService;
    const tinybase = yield* TinyBaseService;
    const model = ollama.getModel('small');

    const targetLangs = SUPPORTED_LANGS.filter((l) => l !== data.source_lang);
    const translations: Array<{ lang: string; text: string }> = [];

    for (const targetLang of targetLangs) {
      const prompt = `Translate the following text from ${data.source_lang} to ${targetLang}. Return ONLY the translated text, nothing else.

Text to translate:
"${data.description}"`;

      const result = yield* Effect.catchAll(
        ollama.generate(model, prompt, {
          temperature: 0.2,
          num_predict: 300,
        }),
        () => Effect.succeed('')
      );

      if (result.trim()) {
        const translatedText = result.trim().replace(/^["']|["']$/g, ''); // Remove quotes
        translations.push({ lang: targetLang, text: translatedText });
        // Also save to TinyBase
        yield* tinybase.setSetting(`tag_translation_${tagId}_${targetLang}`, translatedText);
      }
    }

    // Save source language translation too
    yield* tinybase.setSetting(`tag_translation_${tagId}_${data.source_lang}`, data.description);

    return {
      tag_id: tagId,
      translations,
    };
  });

// ===========================================================================
// Custom Fields - stub implementations (not used for descriptions yet)
// ===========================================================================

export const listCustomFields = Effect.succeed([]);

export const getCustomField = (fieldId: number) =>
  Effect.succeed({
    id: fieldId,
    name: `Field ${fieldId}`,
    data_type: 'string',
    extra_data: null,
  });

export const updateCustomField = (
  fieldId: number,
  data: { name?: string; extra_data?: unknown }
) =>
  Effect.succeed({
    id: fieldId,
    name: data.name ?? `Field ${fieldId}`,
    data_type: 'string',
    extra_data: data.extra_data ?? null,
  });

export const deleteCustomField = (fieldId: number) =>
  Effect.succeed({ deleted: true });

export const bulkUpdateCustomFields = (
  items: Array<{ id: number; name?: string; extra_data?: unknown }>
) =>
  Effect.succeed(items.map((item) => ({
    id: item.id,
    name: item.name ?? `Field ${item.id}`,
    data_type: 'string',
    extra_data: item.extra_data ?? null,
  })));
