/**
 * Settings API definition.
 */
import { Schema } from 'effect';

// ===========================================================================
// Schemas
// ===========================================================================

export const TagsConfigSchema = Schema.Struct({
  pending: Schema.String,
  ocr_done: Schema.String,
  schema_review: Schema.String,
  title_done: Schema.String,
  correspondent_done: Schema.String,
  document_type_done: Schema.String,
  tags_done: Schema.String,
  processed: Schema.String,
});

export type TagsConfig = Schema.Schema.Type<typeof TagsConfigSchema>;

export const SettingsSchema = Schema.Struct({
  paperless_url: Schema.NullOr(Schema.String),
  paperless_token: Schema.NullOr(Schema.String),
  paperless_external_url: Schema.NullOr(Schema.String),
  ollama_url: Schema.NullOr(Schema.String),
  ollama_model_large: Schema.NullOr(Schema.String),
  ollama_model_small: Schema.NullOr(Schema.String),
  ollama_embedding_model: Schema.NullOr(Schema.String),
  ollama_model_translation: Schema.NullOr(Schema.String),
  mistral_api_key: Schema.NullOr(Schema.String),
  mistral_model: Schema.NullOr(Schema.String),
  qdrant_url: Schema.NullOr(Schema.String),
  auto_processing_enabled: Schema.Boolean,
  auto_processing_interval_minutes: Schema.Number,
  confirmation_enabled: Schema.Boolean,
  confirmation_max_retries: Schema.Number,
  language: Schema.String,
  prompt_language: Schema.String,
  debug: Schema.Boolean,
  tags: TagsConfigSchema,
});

export type Settings = Schema.Schema.Type<typeof SettingsSchema>;

export const SettingsUpdateSchema = Schema.Struct({
  paperless_url: Schema.String.pipe(Schema.optional),
  paperless_token: Schema.String.pipe(Schema.optional),
  paperless_external_url: Schema.String.pipe(Schema.optional),
  ollama_url: Schema.String.pipe(Schema.optional),
  ollama_model_large: Schema.String.pipe(Schema.optional),
  ollama_model_small: Schema.String.pipe(Schema.optional),
  ollama_embedding_model: Schema.String.pipe(Schema.optional),
  ollama_model_translation: Schema.String.pipe(Schema.optional),
  mistral_api_key: Schema.String.pipe(Schema.optional),
  mistral_model: Schema.String.pipe(Schema.optional),
  qdrant_url: Schema.String.pipe(Schema.optional),
  auto_processing_enabled: Schema.Boolean.pipe(Schema.optional),
  auto_processing_interval_minutes: Schema.Number.pipe(Schema.optional),
  confirmation_enabled: Schema.Boolean.pipe(Schema.optional),
  confirmation_max_retries: Schema.Number.pipe(Schema.optional),
  language: Schema.String.pipe(Schema.optional),
  prompt_language: Schema.String.pipe(Schema.optional),
  debug: Schema.Boolean.pipe(Schema.optional),
});

export type SettingsUpdate = Schema.Schema.Type<typeof SettingsUpdateSchema>;

export const ConnectionTestResultSchema = Schema.Struct({
  status: Schema.Literal('success', 'error'),
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
