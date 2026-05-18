/**
 * Settings API definition.
 */
import { Schema } from "effect";

// ===========================================================================
// Schemas
// ===========================================================================

export const TagsConfigSchema = Schema.Struct({
  color: Schema.String,
  todo: Schema.String,
  ocr: Schema.String,
  metadata: Schema.String,
  review: Schema.String,
  index: Schema.String,
  done: Schema.String,
  failed: Schema.String,
  pending: Schema.String.pipe(Schema.optional),
  ocr_done: Schema.String.pipe(Schema.optional),
  summary_done: Schema.String.pipe(Schema.optional),
  schema_review: Schema.String.pipe(Schema.optional),
  title_done: Schema.String.pipe(Schema.optional),
  correspondent_done: Schema.String.pipe(Schema.optional),
  document_type_done: Schema.String.pipe(Schema.optional),
  tags_done: Schema.String.pipe(Schema.optional),
  processed: Schema.String.pipe(Schema.optional),
  manual_review: Schema.String.pipe(Schema.optional),
});

export type TagsConfig = Schema.Schema.Type<typeof TagsConfigSchema>;

export const SettingsSchema = Schema.Struct({
  paperless_url: Schema.NullOr(Schema.String),
  paperless_token: Schema.NullOr(Schema.String),
  paperless_token_configured: Schema.Boolean.pipe(Schema.optional),
  paperless_external_url: Schema.NullOr(Schema.String),
  ollama_url: Schema.NullOr(Schema.String),
  ollama_model: Schema.NullOr(Schema.String),
  ollama_embedding_model: Schema.NullOr(Schema.String),
  openai_cli_enabled: Schema.Boolean,
  openai_cli_command: Schema.NullOr(Schema.String),
  openai_cli_model: Schema.NullOr(Schema.String),
  openai_cli_reasoning_effort: Schema.Literal("off", "minimal", "low", "medium", "high", "xhigh"),
  openai_cli_fast_mode: Schema.Boolean,
  openai_cli_scope: Schema.Literal("chat", "full_pipeline", "catalog", "all"),
  mistral_api_key: Schema.NullOr(Schema.String),
  mistral_api_key_configured: Schema.Boolean.pipe(Schema.optional),
  mistral_model: Schema.NullOr(Schema.String),
  qdrant_url: Schema.NullOr(Schema.String),
  qdrant_collection: Schema.NullOr(Schema.String),
  vector_search_enabled: Schema.Boolean,
  vector_search_top_k: Schema.Number,
  vector_search_min_score: Schema.Number,
  auto_processing_enabled: Schema.Boolean,
  auto_processing_interval_minutes: Schema.Number,
  auto_processing_include_untagged: Schema.Boolean,
  confirmation_enabled: Schema.Boolean,
  confirmation_max_retries: Schema.Number,
  confirmation_min_confidence: Schema.Number,
  language: Schema.String,
  tag_language_aliases_de: Schema.String,
  debug: Schema.Boolean,
  debug_log_level: Schema.String,
  debug_log_prompts: Schema.Boolean,
  debug_log_responses: Schema.Boolean,
  debug_save_processing_history: Schema.Boolean,
  tags: TagsConfigSchema,
  // Pipeline settings
  pipeline_ocr: Schema.Boolean,
  pipeline_summary: Schema.Boolean,
  pipeline_title: Schema.Boolean,
  pipeline_correspondent: Schema.Boolean,
  pipeline_document_type: Schema.Boolean,
  pipeline_tags: Schema.Boolean,
  pipeline_custom_fields: Schema.Boolean,
  pipeline_document_links: Schema.Boolean,
});

export type Settings = Schema.Schema.Type<typeof SettingsSchema>;

export const SettingsUpdateSchema = Schema.Struct({
  paperless_url: Schema.String.pipe(Schema.optional),
  paperless_token: Schema.String.pipe(Schema.optional),
  paperless_external_url: Schema.String.pipe(Schema.optional),
  ollama_url: Schema.String.pipe(Schema.optional),
  ollama_model: Schema.String.pipe(Schema.optional),
  ollama_embedding_model: Schema.String.pipe(Schema.optional),
  openai_cli_enabled: Schema.Boolean.pipe(Schema.optional),
  openai_cli_command: Schema.String.pipe(Schema.optional),
  openai_cli_model: Schema.String.pipe(Schema.optional),
  openai_cli_reasoning_effort: Schema.Literal(
    "off",
    "minimal",
    "low",
    "medium",
    "high",
    "xhigh",
  ).pipe(Schema.optional),
  openai_cli_fast_mode: Schema.Boolean.pipe(Schema.optional),
  openai_cli_scope: Schema.Literal("chat", "full_pipeline", "catalog", "all").pipe(Schema.optional),
  mistral_api_key: Schema.String.pipe(Schema.optional),
  mistral_model: Schema.String.pipe(Schema.optional),
  qdrant_url: Schema.String.pipe(Schema.optional),
  qdrant_collection: Schema.String.pipe(Schema.optional),
  vector_search_enabled: Schema.Boolean.pipe(Schema.optional),
  vector_search_top_k: Schema.Number.pipe(Schema.optional),
  vector_search_min_score: Schema.Number.pipe(Schema.optional),
  auto_processing_enabled: Schema.Boolean.pipe(Schema.optional),
  auto_processing_interval_minutes: Schema.Number.pipe(Schema.optional),
  auto_processing_include_untagged: Schema.Boolean.pipe(Schema.optional),
  confirmation_enabled: Schema.Boolean.pipe(Schema.optional),
  confirmation_max_retries: Schema.Number.pipe(Schema.optional),
  confirmation_min_confidence: Schema.Number.pipe(Schema.optional),
  language: Schema.String.pipe(Schema.optional),
  tag_language_aliases_de: Schema.Union(Schema.String, Schema.Array(Schema.Unknown)).pipe(Schema.optional),
  debug: Schema.Boolean.pipe(Schema.optional),
  debug_log_level: Schema.String.pipe(Schema.optional),
  debug_log_prompts: Schema.Boolean.pipe(Schema.optional),
  debug_log_responses: Schema.Boolean.pipe(Schema.optional),
  debug_save_processing_history: Schema.Boolean.pipe(Schema.optional),
  // Pipeline settings
  pipeline_ocr: Schema.Boolean.pipe(Schema.optional),
  pipeline_summary: Schema.Boolean.pipe(Schema.optional),
  pipeline_title: Schema.Boolean.pipe(Schema.optional),
  pipeline_correspondent: Schema.Boolean.pipe(Schema.optional),
  pipeline_document_type: Schema.Boolean.pipe(Schema.optional),
  pipeline_tags: Schema.Boolean.pipe(Schema.optional),
  pipeline_custom_fields: Schema.Boolean.pipe(Schema.optional),
  pipeline_document_links: Schema.Boolean.pipe(Schema.optional),
  tags: TagsConfigSchema.pipe(Schema.optional),
});

export type SettingsUpdate = Schema.Schema.Type<typeof SettingsUpdateSchema>;

export const ConnectionTestResultSchema = Schema.Struct({
  status: Schema.Literal("success", "error", "warning"),
  message: Schema.String,
  details: Schema.NullOr(Schema.Unknown),
});

export type ConnectionTestResult = Schema.Schema.Type<typeof ConnectionTestResultSchema>;

export const OllamaModelSchema = Schema.Struct({
  name: Schema.String,
  size: Schema.Number,
  modified_at: Schema.String,
});

export type OllamaModel = Schema.Schema.Type<typeof OllamaModelSchema>;

export const MistralModelSchema = Schema.Struct({
  id: Schema.String,
  object: Schema.String,
  created: Schema.Number,
  owned_by: Schema.String,
});

export type MistralModel = Schema.Schema.Type<typeof MistralModelSchema>;

export const TagsStatusSchema = Schema.Struct({
  required_tags: Schema.Array(Schema.String),
  existing_tags: Schema.Array(Schema.String),
  missing_tags: Schema.Array(Schema.String),
  all_present: Schema.Boolean,
});

export type TagsStatus = Schema.Schema.Type<typeof TagsStatusSchema>;
