/**
 * Settings API handlers.
 */
import { Effect, pipe } from 'effect';
import { ConfigService } from '../../config/index.js';
import { PaperlessService, OllamaService, MistralService, TinyBaseService, QdrantService } from '../../services/index.js';
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

  const { paperless, ollama, mistral, qdrant, autoProcessing, tags, language, debug, pipeline } = config.config;

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
  const qdrantCollection = get('qdrant.collection', (qdrant as Record<string, unknown>).collection as string || 'paperless-documents');
  const vectorSearchEnabled = getBool('vector_search.enabled', false);
  const vectorSearchTopK = getNum('vector_search.top_k', 5);
  const vectorSearchMinScore = parseFloat(get('vector_search.min_score', '0.7')) || 0.7;

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
    qdrant_collection: qdrantCollection,
    vector_search_enabled: vectorSearchEnabled,
    vector_search_top_k: vectorSearchTopK,
    vector_search_min_score: vectorSearchMinScore,
    auto_processing_enabled: getBool('auto_processing.enabled', autoProcessing.enabled),
    auto_processing_interval_minutes: getNum('auto_processing.interval_minutes', autoProcessing.intervalMinutes),
    confirmation_enabled: getBool('auto_processing.confirmation_enabled', autoProcessing.confirmationEnabled),
    confirmation_max_retries: getNum('auto_processing.confirmation_max_retries', autoProcessing.confirmationMaxRetries),
    language: get('language', language),
    prompt_language: get('prompt_language', language),
    debug: getBool('debug', debug),
    // Include tags configuration for frontend filtering
    tags: {
      color: get('tags.color', '#1e88e5'),
      pending: get('tags.pending', tags.pending),
      ocr_done: get('tags.ocr_done', tags.ocrDone),
      summary_done: get('tags.summary_done', tags.summaryDone),
      schema_review: get('tags.schema_review', tags.schemaReview),
      title_done: get('tags.title_done', tags.titleDone),
      correspondent_done: get('tags.correspondent_done', tags.correspondentDone),
      document_type_done: get('tags.document_type_done', tags.documentTypeDone),
      tags_done: get('tags.tags_done', tags.tagsDone),
      processed: get('tags.processed', tags.processed),
      failed: get('tags.failed', tags.failed),
      manual_review: get('tags.manual_review', tags.manualReview),
    },
    // Pipeline settings
    pipeline_ocr: getBool('pipeline.ocr', pipeline.enableOcr),
    pipeline_summary: getBool('pipeline.summary', pipeline.enableSummary),
    pipeline_title: getBool('pipeline.title', pipeline.enableTitle),
    pipeline_correspondent: getBool('pipeline.correspondent', pipeline.enableCorrespondent),
    pipeline_document_type: getBool('pipeline.document_type', pipeline.enableDocumentType),
    pipeline_tags: getBool('pipeline.tags', pipeline.enableTags),
    pipeline_custom_fields: getBool('pipeline.custom_fields', pipeline.enableCustomFields),
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
  qdrant_collection: 'qdrant.collection',
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
  'pipeline.summary': 'pipeline.summary',
  'pipeline.title': 'pipeline.title',
  'pipeline.correspondent': 'pipeline.correspondent',
  'pipeline.document_type': 'pipeline.document_type',
  'pipeline.tags': 'pipeline.tags',
  'pipeline.custom_fields': 'pipeline.custom_fields',
  // Pipeline settings (underscore format from frontend)
  pipeline_ocr: 'pipeline.ocr',
  pipeline_summary: 'pipeline.summary',
  pipeline_title: 'pipeline.title',
  pipeline_correspondent: 'pipeline.correspondent',
  pipeline_document_type: 'pipeline.document_type',
  pipeline_tags: 'pipeline.tags',
  pipeline_custom_fields: 'pipeline.custom_fields',
  // Vector search
  vector_search_enabled: 'vector_search.enabled',
  vector_search_top_k: 'vector_search.top_k',
  vector_search_min_score: 'vector_search.min_score',
  // Workflow tags - passthrough
  'tags.color': 'tags.color',
  tags_color: 'tags.color',
  'tags.pending': 'tags.pending',
  'tags.ocr_done': 'tags.ocr_done',
  'tags.summary_done': 'tags.summary_done',
  'tags.schema_review': 'tags.schema_review',
  'tags.correspondent_done': 'tags.correspondent_done',
  'tags.document_type_done': 'tags.document_type_done',
  'tags.title_done': 'tags.title_done',
  'tags.tags_done': 'tags.tags_done',
  'tags.processed': 'tags.processed',
  'tags.failed': 'tags.failed',
  'tags.manual_review': 'tags.manual_review',
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
  const qdrant = yield* QdrantService;
  const dbSettings = yield* tinybase.getAllSettings();

  const url = getSettingValue(dbSettings, 'qdrant.url', config.config.qdrant.url);
  const collectionName = getSettingValue(dbSettings, 'qdrant.collection', config.config.qdrant.collectionName || 'paperless-documents');

  if (!url) {
    return { status: 'error' as const, message: 'Qdrant not configured', details: null };
  }

  // First, test basic connectivity
  const connectResult: ConnectionTestResult = yield* Effect.tryPromise({
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

  if (connectResult.status === 'error') {
    return connectResult;
  }

  // Now ensure the collection exists (create if needed)
  const ensureResult = yield* qdrant.ensureCollection().pipe(
    Effect.map(() => ({
      status: 'success' as const,
      message: `Connected to Qdrant. Collection "${collectionName}" ready.`,
      details: null,
    })),
    Effect.catchAll((e) => Effect.succeed({
      status: 'warning' as const,
      message: `Connected to Qdrant, but collection setup failed: ${e.message}`,
      details: null,
    }))
  );

  return ensureResult;
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

// Convert camelCase to snake_case
const toSnakeCase = (str: string): string =>
  str.replace(/([A-Z])/g, '_$1').toLowerCase();

export const getTagsStatus = Effect.gen(function* () {
  const config = yield* ConfigService;
  const paperless = yield* PaperlessService;
  const tinybase = yield* TinyBaseService;

  const tagConfig = config.config.tags;
  const dbSettings = yield* tinybase.getAllSettings();
  const expectedColor = dbSettings['tags.color'] ?? '#1e88e5';

  const existingTagsResult = yield* pipe(
    paperless.getTags(),
    Effect.catchAll(() => Effect.succeed([]))
  );
  // Map tag name to { id, color }
  const existingTagsMap = new Map(
    existingTagsResult.map((t) => [t.name, { id: t.id, color: t.color ?? null }])
  );

  // Build tags array with key (snake_case), name, exists, tag_id, color info
  const tags = Object.entries(tagConfig).map(([key, name]) => {
    const tagInfo = existingTagsMap.get(name);
    const actualColor = tagInfo?.color ?? null;
    // Normalize colors to lowercase for comparison
    const colorMatches = actualColor !== null &&
      actualColor.toLowerCase() === expectedColor.toLowerCase();

    return {
      key: toSnakeCase(key),
      name,
      exists: existingTagsMap.has(name),
      tag_id: tagInfo?.id ?? null,
      actual_color: actualColor,
      color_matches: tagInfo ? colorMatches : null,
    };
  });

  const missingCount = tags.filter((t) => !t.exists).length;
  const colorMismatchCount = tags.filter((t) => t.exists && !t.color_matches).length;

  return {
    tags,
    expected_color: expectedColor,
    all_exist: missingCount === 0,
    missing_count: missingCount,
    all_colors_match: colorMismatchCount === 0,
    color_mismatch_count: colorMismatchCount,
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

export const fixWorkflowTagColors = Effect.gen(function* () {
  const paperless = yield* PaperlessService;
  const tinybase = yield* TinyBaseService;
  const config = yield* ConfigService;

  const tagConfig = config.config.tags;
  const dbSettings = yield* tinybase.getAllSettings();
  const expectedColor = dbSettings['tags.color'] ?? '#1e88e5';

  const existingTags = yield* pipe(
    paperless.getTags(),
    Effect.catchAll(() => Effect.succeed([]))
  );
  const existingTagsMap = new Map(
    existingTags.map((t) => [t.name, { id: t.id, color: t.color ?? null }])
  );

  const updated: string[] = [];
  const failed: string[] = [];

  // Update color for each workflow tag that exists but has wrong color
  for (const [, name] of Object.entries(tagConfig)) {
    const tagInfo = existingTagsMap.get(name);
    if (!tagInfo) continue; // Tag doesn't exist, skip

    const actualColor = tagInfo.color;
    const colorMatches = actualColor !== null &&
      actualColor.toLowerCase() === expectedColor.toLowerCase();

    if (!colorMatches) {
      const result = yield* pipe(
        paperless.updateTagColor(tagInfo.id, expectedColor),
        Effect.map(() => true),
        Effect.catchAll(() => Effect.succeed(false))
      );
      if (result) {
        updated.push(name);
      } else {
        failed.push(name);
      }
    }
  }

  return { updated, failed, color: expectedColor };
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
