/**
 * TinyBase Schema Definitions
 *
 * Defines typed schemas for the frontend TinyBase store.
 * Uses tinybase/with-schemas for TypeScript type inference.
 */

// Settings Values Schema
// All settings are stored as TinyBase Values (key-value pairs)
export const valuesSchema = {
  // Paperless-ngx connection
  "paperless.url": { type: "string", default: "" },
  "paperless.token": { type: "string", default: "" },
  "paperless.token_configured": { type: "boolean", default: false },
  "paperless.external_url": { type: "string", default: "" },

  // Ollama LLM
  "ollama.url": { type: "string", default: "" },
  "ollama.model": { type: "string", default: "" },
  "ollama.embedding_model": { type: "string", default: "" },

  // OpenAI local CLI connector. This never stores or uses an OpenAI API key.
  "openai_cli.enabled": { type: "boolean", default: false },
  "openai_cli.command": { type: "string", default: "codex" },
  "openai_cli.model": { type: "string", default: "gpt-5.5" },
  "openai_cli.reasoning_effort": { type: "string", default: "medium" },
  "openai_cli.fast_mode": { type: "boolean", default: true },
  "openai_cli.scope": { type: "string", default: "chat" },

  // Mistral OCR
  "mistral.api_key": { type: "string", default: "" },
  "mistral.api_key_configured": { type: "boolean", default: false },
  "mistral.model": { type: "string", default: "mistral-ocr-latest" },

  // Qdrant vector DB
  "qdrant.url": { type: "string", default: "" },
  "qdrant.collection": { type: "string", default: "" },

  // Auto processing
  "auto_processing.enabled": { type: "boolean", default: false },
  "auto_processing.interval_minutes": { type: "number", default: 10 },
  "auto_processing.include_untagged": { type: "boolean", default: false },
  "auto_processing.pause_on_user_activity": { type: "boolean", default: true },

  // Confirmation settings
  "confirmation.max_retries": { type: "number", default: 3 },
  "confirmation.require_user_for_new_entities": { type: "boolean", default: false },

  // Pipeline toggles
  "pipeline.ocr": { type: "boolean", default: true },
  "pipeline.summary": { type: "boolean", default: false },
  "pipeline.title": { type: "boolean", default: true },
  "pipeline.correspondent": { type: "boolean", default: true },
  "pipeline.document_type": { type: "boolean", default: true },
  "pipeline.tags": { type: "boolean", default: true },
  "pipeline.custom_fields": { type: "boolean", default: true },
  "pipeline.document_links": { type: "boolean", default: true },

  // Vector search
  "vector_search.enabled": { type: "boolean", default: false },
  "vector_search.top_k": { type: "number", default: 5 },
  "vector_search.min_score": { type: "number", default: 0.7 },

  // Debug settings
  "debug.log_level": { type: "string", default: "INFO" },
  "debug.log_prompts": { type: "boolean", default: false },
  "debug.log_responses": { type: "boolean", default: false },
  "debug.save_processing_history": { type: "boolean", default: true },
  language: { type: "string", default: "en" },
  "tag_language.aliases.de": { type: "string", default: "" },

  // Workflow tags
  "tags.color": { type: "string", default: "#1e88e5" },
  "tags.todo": { type: "string", default: "ai-queued" },
  "tags.ocr": { type: "string", default: "ai-processing" },
  "tags.metadata": { type: "string", default: "ai-processing" },
  "tags.review": { type: "string", default: "ai-needs-input" },
  "tags.index": { type: "string", default: "ai-processing" },
  "tags.done": { type: "string", default: "ai-done" },
  "tags.failed": { type: "string", default: "ai-failed" },
  // Compatibility aliases for persisted settings created before the Pi pipeline.
  "tags.pending": { type: "string", default: "ai-queued" },
  "tags.ocr_done": { type: "string", default: "ai-processing" },
  "tags.summary_done": { type: "string", default: "ai-processing" },
  "tags.schema_review": { type: "string", default: "ai-needs-input" },
  "tags.correspondent_done": { type: "string", default: "ai-processing" },
  "tags.document_type_done": { type: "string", default: "ai-processing" },
  "tags.title_done": { type: "string", default: "ai-processing" },
  "tags.tags_done": { type: "string", default: "ai-processing" },
  "tags.processed": { type: "string", default: "ai-done" },
  "tags.manual_review": { type: "string", default: "ai-needs-input" },

  // Sync metadata (internal use)
  _lastSync: { type: "string", default: "" },
  _syncing: { type: "boolean", default: false },
  _error: { type: "string", default: "" },
} as const;

// Processing Logs Table Schema
export const tablesSchema = {
  processingLogs: {
    id: { type: "string" },
    docId: { type: "number" },
    timestamp: { type: "string" },
    step: { type: "string" },
    eventType: { type: "string" },
    data: { type: "string" }, // JSON stringified
    parentId: { type: "string", default: "" },
  },
} as const;

// TypeScript type exports
export type ValuesSchema = typeof valuesSchema;
export type TablesSchema = typeof tablesSchema;
export type SettingKey = keyof ValuesSchema;

// Mapping from API keys to store keys
export const API_TO_STORE_KEY_MAP: Record<string, SettingKey> = {
  paperless_url: "paperless.url",
  paperless_token_configured: "paperless.token_configured",
  paperless_external_url: "paperless.external_url",
  ollama_url: "ollama.url",
  ollama_model: "ollama.model",
  ollama_embedding_model: "ollama.embedding_model",
  openai_cli_enabled: "openai_cli.enabled",
  openai_cli_command: "openai_cli.command",
  openai_cli_model: "openai_cli.model",
  openai_cli_reasoning_effort: "openai_cli.reasoning_effort",
  openai_cli_fast_mode: "openai_cli.fast_mode",
  openai_cli_scope: "openai_cli.scope",
  mistral_api_key_configured: "mistral.api_key_configured",
  mistral_model: "mistral.model",
  qdrant_url: "qdrant.url",
  qdrant_collection: "qdrant.collection",
  auto_processing_enabled: "auto_processing.enabled",
  auto_processing_interval_minutes: "auto_processing.interval_minutes",
  auto_processing_include_untagged: "auto_processing.include_untagged",
  auto_processing_pause_on_user_activity: "auto_processing.pause_on_user_activity",
  confirmation_max_retries: "confirmation.max_retries",
  confirmation_require_user_for_new_entities: "confirmation.require_user_for_new_entities",
  pipeline_ocr: "pipeline.ocr",
  pipeline_summary: "pipeline.summary",
  pipeline_title: "pipeline.title",
  pipeline_correspondent: "pipeline.correspondent",
  pipeline_document_type: "pipeline.document_type",
  pipeline_tags: "pipeline.tags",
  pipeline_custom_fields: "pipeline.custom_fields",
  pipeline_document_links: "pipeline.document_links",
  vector_search_enabled: "vector_search.enabled",
  vector_search_top_k: "vector_search.top_k",
  vector_search_min_score: "vector_search.min_score",
  debug_log_level: "debug.log_level",
  debug_log_prompts: "debug.log_prompts",
  debug_log_responses: "debug.log_responses",
  debug_save_processing_history: "debug.save_processing_history",
  language: "language",
  tag_language_aliases_de: "tag_language.aliases.de",
  tags_color: "tags.color",
  tags_todo: "tags.todo",
  tags_ocr: "tags.ocr",
  tags_metadata: "tags.metadata",
  tags_review: "tags.review",
  tags_index: "tags.index",
  tags_done: "tags.done",
  tags_failed: "tags.failed",
};

// Reverse mapping from store keys to API keys
export const STORE_TO_API_KEY_MAP: Record<string, string> = Object.entries(
  API_TO_STORE_KEY_MAP,
).reduce(
  (acc, [apiKey, storeKey]) => {
    acc[storeKey] = apiKey;
    return acc;
  },
  {} as Record<string, string>,
);
