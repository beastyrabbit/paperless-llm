/**
 * Provider connection settings are deployment configuration, never application
 * state. Secrets come from the environment (normally injected by Infisical);
 * related non-secret endpoint/model values come from startup environment/YAML
 * configuration so the connection test and runtime client cannot drift.
 */
const CONFIG_OWNED_PROVIDER_SETTING_KEYS = new Set([
  "paperless.url",
  "paperless_url",
  "paperless.token",
  "paperless_token",
  "paperless.api_token",
  "paperless_api_token",
  "mistral.api_key",
  "mistral.apiKey",
  "mistral_api_key",
  "mistral.api_base_url",
  "mistral.apiBaseUrl",
  "mistral_api_base_url",
  "mistral.model",
  "mistral_model",
  "mistral.ocr_model",
  "mistral.ocrModel",
  "ollama.url",
  "ollama_url",
  "ollama.model",
  "ollama_model",
  "ollama.embedding_model",
  "ollama.embeddingModel",
  "ollama_embedding_model",
  "qdrant.url",
  "qdrant_url",
  "qdrant.collection",
  "qdrant.collectionName",
  "qdrant_collection",
  "qdrant.embedding_dimension",
  "qdrant.embeddingDimension",
  "qdrant_embedding_dimension",
]);

const SECRET_KEY_SEGMENT =
  /(?:^|[._-])(api[_-]?key|password|secret|credential)(?:$|[._-])/i;
const TOKEN_KEY_SEGMENT = /(?:^|[._-])token(?:$|[._-])/i;
const NON_SECRET_TOKEN_METRIC = /(?:^|[._-])token(?:s|[_-]limit)(?:$|[._-])/i;

export const isConfigOwnedProviderSettingKey = (key: string): boolean =>
  CONFIG_OWNED_PROVIDER_SETTING_KEYS.has(key);

export const isSecretLikeSettingKey = (key: string): boolean =>
  SECRET_KEY_SEGMENT.test(key) ||
  (TOKEN_KEY_SEGMENT.test(key) && !NON_SECRET_TOKEN_METRIC.test(key));

export const isForbiddenPersistedSettingKey = (key: string): boolean =>
  isConfigOwnedProviderSettingKey(key) || isSecretLikeSettingKey(key);
