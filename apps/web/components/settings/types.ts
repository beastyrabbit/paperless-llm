// Settings types and interfaces

export interface OllamaModel {
  name: string;
  size: string;
  modified: string;
  digest: string;
}

export interface MistralModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface TagStatus {
  key: string;
  name: string;
  exists: boolean;
  tag_id: number | null;
}

export interface TagsStatusResponse {
  tags: TagStatus[];
  all_exist: boolean;
  missing_count: number;
}

export interface CustomField {
  id: number;
  name: string;
  data_type: string;
  extra_data: Record<string, unknown> | null;
}

export interface CustomFieldsResponse {
  fields: CustomField[];
  selected_fields: number[];
}

export interface Settings {
  // External Services
  paperless_url: string;
  paperless_token: string;
  mistral_api_key: string;
  mistral_model: string;
  ollama_url: string;
  ollama_model_large: string;
  ollama_model_small: string;
  ollama_model_translation: string;
  ollama_embedding_model: string;
  ollama_thinking_enabled: boolean;
  ollama_thinking_level: "low" | "medium" | "high";
  qdrant_url: string;
  qdrant_collection: string;
  // Processing
  auto_processing_enabled: boolean;
  auto_processing_interval_minutes: number;
  auto_processing_pause_on_user_activity: boolean;
  confirmation_max_retries: number;
  confirmation_require_user_for_new_entities: boolean;
  // Pipeline
  pipeline_ocr: boolean;
  pipeline_title: boolean;
  pipeline_correspondent: boolean;
  pipeline_tags: boolean;
  pipeline_custom_fields: boolean;
  // Vector Search
  vector_search_enabled: boolean;
  vector_search_top_k: number;
  vector_search_min_score: number;
  // Language
  prompt_language: string;
  // Debug
  debug_log_level: "DEBUG" | "INFO" | "WARNING" | "ERROR";
  debug_log_prompts: boolean;
  debug_log_responses: boolean;
  debug_save_processing_history: boolean;
  // Tags
  tags: {
    pending: string;
    ocr_done: string;
    schema_review: string;
    correspondent_done: string;
    document_type_done: string;
    title_done: string;
    tags_done: string;
    processed: string;
  };
}

export interface LanguageInfo {
  code: string;
  name: string;
  prompt_count: number;
  is_complete: boolean;
}

export interface PaperlessTag {
  id: number;
  name: string;
  color: string;
  matching_algorithm: number;
  document_count: number;
}

export interface DocumentTypeInfo {
  id: number;
  name: string;
  document_count: number;
}

export type ConnectionStatus = "idle" | "testing" | "success" | "error";

export const VALID_TABS = [
  "connections",
  "processing",
  "pipeline",
  "custom-fields",
  "ai-tags",
  "ai-document-types",
  "workflow-tags",
  "language",
  "advanced",
  "maintenance",
  "database",
] as const;

export type SettingsTab = (typeof VALID_TABS)[number];

export const API_BASE = process.env.NEXT_PUBLIC_API_URL || "";

// Default settings
export const DEFAULT_SETTINGS: Settings = {
  paperless_url: "",
  paperless_token: "",
  mistral_api_key: "",
  mistral_model: "mistral-ocr-latest",
  ollama_url: "",
  ollama_model_large: "",
  ollama_model_small: "",
  ollama_model_translation: "",
  ollama_embedding_model: "",
  ollama_thinking_enabled: true,
  ollama_thinking_level: "high",
  qdrant_url: "",
  qdrant_collection: "paperless-documents",
  auto_processing_enabled: false,
  auto_processing_interval_minutes: 10,
  auto_processing_pause_on_user_activity: true,
  confirmation_max_retries: 3,
  confirmation_require_user_for_new_entities: true,
  pipeline_ocr: true,
  pipeline_title: true,
  pipeline_correspondent: true,
  pipeline_tags: true,
  pipeline_custom_fields: true,
  vector_search_enabled: true,
  vector_search_top_k: 5,
  vector_search_min_score: 0.7,
  prompt_language: "en",
  debug_log_level: "INFO",
  debug_log_prompts: false,
  debug_log_responses: false,
  debug_save_processing_history: true,
  tags: {
    pending: "llm-pending",
    ocr_done: "llm-ocr-done",
    schema_review: "llm-schema-review",
    correspondent_done: "llm-correspondent-done",
    document_type_done: "llm-document-type-done",
    title_done: "llm-title-done",
    tags_done: "llm-tags-done",
    processed: "llm-processed",
  },
};
