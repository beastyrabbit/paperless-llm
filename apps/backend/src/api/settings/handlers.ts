/**
 * Settings API handlers.
 */
import { Effect, pipe } from 'effect';
import { ConfigService } from '../../config/index.js';
import { PaperlessService, OllamaService, MistralService, TinyBaseService } from '../../services/index.js';
import type { Settings, SettingsUpdate, ConnectionTestResult, TagsStatus } from './api.js';

// ===========================================================================
// Get Settings
// ===========================================================================

export const getSettings = Effect.gen(function* () {
  const config = yield* ConfigService;
  const tinybase = yield* TinyBaseService;

  // Get settings from TinyBase (imported from config.yaml)
  const dbSettings = yield* tinybase.getAllSettings();

  // Helper to get setting from DB or fall back to config
  const get = (key: string, fallback: string): string => {
    return dbSettings[key] ?? fallback;
  };
  const getBool = (key: string, fallback: boolean): boolean => {
    const val = dbSettings[key];
    if (val === undefined) return fallback;
    return val === 'true' || val === '1';
  };
  const getNum = (key: string, fallback: number): number => {
    const val = dbSettings[key];
    if (val === undefined) return fallback;
    const num = parseInt(val, 10);
    return isNaN(num) ? fallback : num;
  };

  const { paperless, ollama, mistral, qdrant, autoProcessing, tags, language, debug } = config.config;

  // Merge DB settings with config defaults
  const paperlessUrl = get('paperless.url', paperless.url || '');
  const paperlessToken = get('paperless.token', paperless.token || '');
  const paperlessExternalUrl = get('paperless.external_url', '');
  const ollamaUrl = get('ollama.url', ollama.url || '');
  const ollamaModelLarge = get('ollama.model_large', ollama.modelLarge || '');
  const ollamaModelSmall = get('ollama.model_small', ollama.modelSmall || '');
  const ollamaEmbeddingModel = get('ollama.embedding_model', (ollama as Record<string, unknown>).embeddingModel as string || '');
  const ollamaModelTranslation = get('ollama.model_translation', (ollama as Record<string, unknown>).modelTranslation as string || '');
  const mistralApiKey = get('mistral.api_key', mistral.apiKey || '');
  const mistralModel = get('mistral.model', mistral.model || '');
  const qdrantUrl = get('qdrant.url', qdrant.url || '');

  // Return actual values - this is a local application, no need to mask secrets
  const settings: Settings = {
    paperless_url: paperlessUrl,
    paperless_token: paperlessToken,
    paperless_external_url: paperlessExternalUrl,
    ollama_url: ollamaUrl,
    ollama_model_large: ollamaModelLarge,
    ollama_model_small: ollamaModelSmall,
    ollama_embedding_model: ollamaEmbeddingModel,
    ollama_model_translation: ollamaModelTranslation,
    mistral_api_key: mistralApiKey,
    mistral_model: mistralModel,
    qdrant_url: qdrantUrl,
    auto_processing_enabled: getBool('auto_processing.enabled', autoProcessing.enabled),
    auto_processing_interval_minutes: getNum('auto_processing.interval_minutes', autoProcessing.intervalMinutes),
    confirmation_enabled: getBool('auto_processing.confirmation_enabled', autoProcessing.confirmationEnabled),
    confirmation_max_retries: getNum('auto_processing.confirmation_max_retries', autoProcessing.confirmationMaxRetries),
    language: get('language', language),
    prompt_language: get('prompt_language', language),
    debug: getBool('debug', debug),
    // Include tags configuration for frontend filtering
    tags: {
      pending: get('tags.pending', tags.pending),
      ocr_done: get('tags.ocr_done', tags.ocrDone),
      schema_review: get('tags.schema_review', (tags as Record<string, string>).schemaReview || 'llm-schema-review'),
      title_done: get('tags.title_done', tags.titleDone),
      correspondent_done: get('tags.correspondent_done', tags.correspondentDone),
      document_type_done: get('tags.document_type_done', tags.documentTypeDone),
      tags_done: get('tags.tags_done', tags.tagsDone),
      processed: get('tags.processed', tags.processed),
    },
  };

  return settings;
});

// ===========================================================================
// Update Settings
// ===========================================================================

// Map frontend field names to TinyBase keys
const SETTINGS_KEY_MAP: Record<string, string> = {
  // Paperless connection
  paperless_url: 'paperless.url',
  paperless_token: 'paperless.token',
  paperless_external_url: 'paperless.external_url',
  // Ollama
  ollama_url: 'ollama.url',
  ollama_model_large: 'ollama.model_large',
  ollama_model_small: 'ollama.model_small',
  ollama_embedding_model: 'ollama.embedding_model',
  ollama_model_translation: 'ollama.model_translation',
  // Mistral
  mistral_api_key: 'mistral.api_key',
  mistral_model: 'mistral.model',
  // Qdrant
  qdrant_url: 'qdrant.url',
  // Auto processing
  auto_processing_enabled: 'auto_processing.enabled',
  auto_processing_interval_minutes: 'auto_processing.interval_minutes',
  confirmation_enabled: 'auto_processing.confirmation_enabled',
  confirmation_max_retries: 'auto_processing.confirmation_max_retries',
  // Language
  language: 'language',
  prompt_language: 'prompt_language',
  // Debug
  debug: 'debug',
  'debug.log_level': 'debug.log_level',
  'debug.log_prompts': 'debug.log_prompts',
  'debug.log_responses': 'debug.log_responses',
  'debug.save_processing_history': 'debug.save_processing_history',
  // Pipeline settings
  'pipeline.ocr': 'pipeline.ocr',
  'pipeline.title': 'pipeline.title',
  'pipeline.correspondent': 'pipeline.correspondent',
  'pipeline.tags': 'pipeline.tags',
  'pipeline.custom_fields': 'pipeline.custom_fields',
  // Vector search
  'vector_search.enabled': 'vector_search.enabled',
  'vector_search.top_k': 'vector_search.top_k',
  'vector_search.min_score': 'vector_search.min_score',
  // Workflow tags - passthrough
  'tags.pending': 'tags.pending',
  'tags.ocr_done': 'tags.ocr_done',
  'tags.schema_review': 'tags.schema_review',
  'tags.correspondent_done': 'tags.correspondent_done',
  'tags.document_type_done': 'tags.document_type_done',
  'tags.title_done': 'tags.title_done',
  'tags.tags_done': 'tags.tags_done',
  'tags.processed': 'tags.processed',
};

export const updateSettings = (updates: SettingsUpdate) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    // Store updates in TinyBase settings table
    for (const [key, value] of Object.entries(updates)) {
      if (value === undefined) continue;

      // Map frontend key to TinyBase key
      const dbKey = SETTINGS_KEY_MAP[key] ?? key;

      // Convert value to string for storage
      const strValue = typeof value === 'boolean' ? String(value) : String(value);
      yield* tinybase.setSetting(dbKey, strValue);
    }

    // Return updated settings
    return yield* getSettings;
  });

// ===========================================================================
// Connection Tests - Read settings from TinyBase for dynamic config
// ===========================================================================

/**
 * Helper to get a setting value from TinyBase with fallback to ConfigService
 */
const getSettingValue = (dbSettings: Record<string, string>, key: string, configFallback: string): string => {
  return dbSettings[key] ?? configFallback;
};

export const testPaperlessConnection = Effect.gen(function* () {
  const config = yield* ConfigService;
  const tinybase = yield* TinyBaseService;
  const dbSettings = yield* tinybase.getAllSettings();

  const url = getSettingValue(dbSettings, 'paperless.url', config.config.paperless.url);
  const token = getSettingValue(dbSettings, 'paperless.token', config.config.paperless.token);

  if (!url || !token) {
    return { status: 'error' as const, message: 'Paperless-ngx not configured', details: null };
  }

  const result: ConnectionTestResult = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${url}/api/documents/?page_size=1`, {
        headers: { Authorization: `Token ${token}` },
      });
      if (response.ok) {
        return { status: 'success' as const, message: 'Connected to Paperless-ngx', details: null };
      }
      return { status: 'error' as const, message: `Failed to connect: HTTP ${response.status}`, details: null };
    },
    catch: (e) => ({
      status: 'error' as const,
      message: `Failed to connect to Paperless-ngx: ${e}`,
      details: null,
    }),
  });

  return result;
});

export const testOllamaConnection = Effect.gen(function* () {
  const config = yield* ConfigService;
  const tinybase = yield* TinyBaseService;
  const dbSettings = yield* tinybase.getAllSettings();

  const url = getSettingValue(dbSettings, 'ollama.url', config.config.ollama.url);

  if (!url) {
    return { status: 'error' as const, message: 'Ollama not configured', details: null };
  }

  const result: ConnectionTestResult = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${url}/api/tags`);
      if (response.ok) {
        return { status: 'success' as const, message: 'Connected to Ollama', details: null };
      }
      return { status: 'error' as const, message: `Failed to connect: HTTP ${response.status}`, details: null };
    },
    catch: (e) => ({
      status: 'error' as const,
      message: `Failed to connect to Ollama: ${e}`,
      details: null,
    }),
  });

  return result;
});

export const testMistralConnection = Effect.gen(function* () {
  const config = yield* ConfigService;
  const tinybase = yield* TinyBaseService;
  const dbSettings = yield* tinybase.getAllSettings();

  const apiKey = getSettingValue(dbSettings, 'mistral.api_key', config.config.mistral.apiKey);

  if (!apiKey) {
    return { status: 'error' as const, message: 'Mistral API key not configured', details: null };
  }

  const result: ConnectionTestResult = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch('https://api.mistral.ai/v1/models', {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      if (response.ok) {
        return { status: 'success' as const, message: 'Connected to Mistral AI', details: null };
      }
      return { status: 'error' as const, message: `Failed to connect: HTTP ${response.status}`, details: null };
    },
    catch: (e) => ({
      status: 'error' as const,
      message: `Failed to connect to Mistral AI: ${e}`,
      details: null,
    }),
  });

  return result;
});

export const testQdrantConnection = Effect.gen(function* () {
  const config = yield* ConfigService;
  const tinybase = yield* TinyBaseService;
  const dbSettings = yield* tinybase.getAllSettings();

  const url = getSettingValue(dbSettings, 'qdrant.url', config.config.qdrant.url);

  if (!url) {
    return { status: 'error' as const, message: 'Qdrant not configured', details: null };
  }

  const result: ConnectionTestResult = yield* Effect.tryPromise({
    try: async () => {
      const response = await fetch(`${url}/collections`);
      if (response.ok) {
        return { status: 'success' as const, message: 'Connected to Qdrant', details: null };
      }
      return { status: 'error' as const, message: `Failed to connect: HTTP ${response.status}`, details: null };
    },
    catch: (e) => ({
      status: 'error' as const,
      message: `Failed to connect to Qdrant: ${e}`,
      details: null,
    }),
  });

  return result;
});

// ===========================================================================
// Model Lists
// ===========================================================================

export const getOllamaModels = Effect.gen(function* () {
  const ollama = yield* OllamaService;

  const models = yield* pipe(
    ollama.listModels(),
    Effect.catchAll(() => Effect.succeed([]))
  );

  // Return in format expected by frontend: { models: [...] }
  return {
    models: models.map((m) => ({
      name: m.name,
      size: m.size,
      modified_at: m.modified_at,
    })),
  };
});

export const getMistralModels = Effect.gen(function* () {
  const mistral = yield* MistralService;

  const models = yield* pipe(
    mistral.listModels(),
    Effect.catchAll(() => Effect.succeed([]))
  );

  // Return in format expected by frontend: { models: [...] }
  return {
    models: models.map((m) => ({
      id: m.id,
      object: m.object,
      created: m.created,
      owned_by: m.owned_by,
    })),
  };
});

// ===========================================================================
// Import Config from YAML
// ===========================================================================

import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';

interface ImportConfigResult {
  success: boolean;
  message: string;
  imported_keys: string[];
}

/**
 * Flatten a nested object into key-value pairs with dot notation.
 */
const flattenObject = (
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else if (typeof value === 'object') {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = String(value);
    }
  }

  return result;
};

/**
 * Import settings from config.yaml into TinyBase.
 * Looks for config.yaml in several locations.
 */
export const importConfigFromYaml = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;

  // Try multiple paths for config.yaml
  const possiblePaths = [
    path.join(process.cwd(), 'config.yaml'),
    path.join(process.cwd(), '../backend/config.yaml'),
    path.join(process.cwd(), '../../config.yaml'),
    path.join(process.cwd(), '../../apps/backend/config.yaml'),
    '/app/config.yaml', // Docker container path
  ];

  let configPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    return {
      success: false,
      message: 'No config.yaml found. Tried: ' + possiblePaths.join(', '),
      imported_keys: [],
    } as ImportConfigResult;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const yamlConfig = parseYaml(content) as Record<string, unknown>;

    if (!yamlConfig || Object.keys(yamlConfig).length === 0) {
      return {
        success: false,
        message: 'Config file is empty or invalid',
        imported_keys: [],
      } as ImportConfigResult;
    }

    // Flatten the config and import into TinyBase
    const flattened = flattenObject(yamlConfig);
    const importedKeys: string[] = [];

    for (const [key, value] of Object.entries(flattened)) {
      yield* tinybase.setSetting(key, value);
      importedKeys.push(key);
    }

    return {
      success: true,
      message: `Imported ${importedKeys.length} settings from ${configPath}`,
      imported_keys: importedKeys,
    } as ImportConfigResult;
  } catch (error) {
    return {
      success: false,
      message: `Failed to parse config.yaml: ${error}`,
      imported_keys: [],
    } as ImportConfigResult;
  }
});

/**
 * Check if TinyBase settings are empty and auto-import if needed.
 */
export const checkAndImportSettings = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  const existingSettings = yield* tinybase.getAllSettings();

  if (Object.keys(existingSettings).length > 0) {
    return {
      imported: false,
      message: 'Settings already exist, skipping import',
      existing_count: Object.keys(existingSettings).length,
    };
  }

  const importResult = yield* importConfigFromYaml;

  return {
    imported: importResult.success,
    message: importResult.message,
    imported_keys: importResult.imported_keys,
  };
});

// ===========================================================================
// Workflow Tags
// ===========================================================================

export const getTagsStatus = Effect.gen(function* () {
  const config = yield* ConfigService;
  const paperless = yield* PaperlessService;

  const tagConfig = config.config.tags;
  const existingTagsResult = yield* pipe(
    paperless.getTags(),
    Effect.catchAll(() => Effect.succeed([]))
  );
  const existingTagsMap = new Map(existingTagsResult.map((t) => [t.name, t.id]));

  // Build tags array with key, name, exists, tag_id
  const tags = Object.entries(tagConfig).map(([key, name]) => ({
    key,
    name,
    exists: existingTagsMap.has(name),
    tag_id: existingTagsMap.get(name) ?? null,
  }));

  const missingCount = tags.filter((t) => !t.exists).length;

  return {
    tags,
    all_exist: missingCount === 0,
    missing_count: missingCount,
  };
});

export const createWorkflowTags = (tagNames: string[]) =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;

    const results: Array<{ name: string; id: number }> = [];
    for (const name of tagNames) {
      const id = yield* paperless.getOrCreateTag(name);
      results.push({ name, id });
    }

    return { created: results };
  });

// ===========================================================================
// AI Tags
// ===========================================================================

export const getAiTags = Effect.gen(function* () {
  const paperless = yield* PaperlessService;
  const tinybase = yield* TinyBaseService;

  const tags = yield* pipe(
    paperless.getTags(),
    Effect.catchAll(() => Effect.succeed([]))
  );

  // Get selected tag IDs from TinyBase
  const selectedJson = yield* tinybase.getSetting('ai_tag_ids');
  const selectedTagIds = selectedJson ? JSON.parse(selectedJson) as number[] : [];

  return {
    tags: tags.map((t) => ({
      id: t.id,
      name: t.name,
      color: t.color ?? null,
      text_color: t.text_color ?? null,
      is_inbox_tag: t.is_inbox_tag ?? false,
      document_count: t.document_count ?? 0,
    })),
    selected_tag_ids: selectedTagIds,
  };
});

export const updateAiTags = (selectedTagIds: number[]) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    // Store the selected tags in TinyBase
    yield* tinybase.setSetting('ai_tag_ids', JSON.stringify(selectedTagIds));

    return { success: true, selected_tag_ids: selectedTagIds };
  });

// ===========================================================================
// Custom Fields
// ===========================================================================

export const getCustomFields = Effect.gen(function* () {
  const paperless = yield* PaperlessService;
  const tinybase = yield* TinyBaseService;

  const fields = yield* pipe(
    paperless.getCustomFields(),
    Effect.catchAll(() => Effect.succeed([]))
  );

  // Get selected field IDs from TinyBase
  const selectedJson = yield* tinybase.getSetting('custom_field_ids');
  const selectedFieldIds = selectedJson ? JSON.parse(selectedJson) as number[] : [];

  return {
    fields: fields.map((f) => ({
      id: f.id,
      name: f.name,
      data_type: f.data_type,
    })),
    selected_fields: selectedFieldIds,
  };
});

export const updateCustomFields = (selectedFieldIds: number[]) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    // Store the selected fields in TinyBase
    yield* tinybase.setSetting('custom_field_ids', JSON.stringify(selectedFieldIds));

    return { success: true, selected_fields: selectedFieldIds };
  });

// ===========================================================================
// AI Document Types
// ===========================================================================

export const getAiDocumentTypes = Effect.gen(function* () {
  const paperless = yield* PaperlessService;
  const tinybase = yield* TinyBaseService;

  const docTypes = yield* pipe(
    paperless.getDocumentTypes(),
    Effect.catchAll(() => Effect.succeed([]))
  );

  // Get selected document type IDs from TinyBase
  const selectedJson = yield* tinybase.getSetting('ai_document_type_ids');
  const selectedTypeIds = selectedJson ? JSON.parse(selectedJson) as number[] : [];

  return {
    document_types: docTypes.map((dt) => ({
      id: dt.id,
      name: dt.name,
      slug: dt.slug ?? '',
      document_count: dt.document_count ?? 0,
    })),
    selected_type_ids: selectedTypeIds,
  };
});

export const updateAiDocumentTypes = (selectedTypeIds: number[]) =>
  Effect.gen(function* () {
    const tinybase = yield* TinyBaseService;

    // Store the selected types in TinyBase
    yield* tinybase.setSetting('ai_document_type_ids', JSON.stringify(selectedTypeIds));

    return { success: true, selected_type_ids: selectedTypeIds };
  });

// ===========================================================================
// Clear Database
// ===========================================================================

interface ClearDatabaseResult {
  success: boolean;
  message: string;
  deleted_count: number;
}

/**
 * Clear all settings from TinyBase database.
 */
export const clearDatabase = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;

  // Get all current settings first to count them
  const existingSettings = yield* tinybase.getAllSettings();
  const count = Object.keys(existingSettings).length;

  // Clear all settings
  yield* tinybase.clearAllSettings();

  return {
    success: true,
    message: `Successfully cleared ${count} settings from database`,
    deleted_count: count,
  } as ClearDatabaseResult;
});

// ===========================================================================
// Processing Logs
// ===========================================================================

/**
 * Get processing log statistics.
 */
export const getProcessingLogStats = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  const stats = yield* tinybase.getProcessingLogStats();
  return stats;
});

/**
 * Clear all processing logs.
 */
export const clearAllProcessingLogs = Effect.gen(function* () {
  const tinybase = yield* TinyBaseService;
  yield* tinybase.clearAllProcessingLogs();
  return { success: true, message: 'All processing logs cleared' };
});
