/**
 * Configuration service for the application.
 */
import { Context, Effect, Layer, pipe, Schema } from "effect";
import { validateCutoverRuntimeConfig } from "../services/cutover/mode.js";
import { type AppConfig, AppConfigSchema, type ResolvedConfig } from "./schema.js";
import {
  type ConfigLoadError,
  loadEnvConfig,
  loadYamlConfig,
  mergeConfigs,
} from "./yaml-loader.js";

// Default configuration values
const defaultConfig: ResolvedConfig = {
  paperless: {
    url: "http://localhost:8000",
    token: "",
  },
  ollama: {
    url: "http://localhost:11434",
    model: "gpt-oss:120b",
    embeddingModel: "qwen3-embedding:8b",
  },
  mistral: {
    apiKey: "",
    model: "pixtral-12b-latest",
    apiBaseUrl: "https://api.mistral.ai",
  },
  qdrant: {
    url: "http://localhost:6333",
    collectionName: "paperless-documents",
    embeddingDimension: 4096,
  },
  ocrBudget: {
    dailyPageLimit: null,
    runPageLimit: null,
    dailyTokenLimit: null,
    runTokenLimit: null,
  },
  autoProcessing: {
    enabled: false,
    intervalMinutes: 5,
    includeUntagged: false,
    confirmationEnabled: true,
    confirmationMaxRetries: 3,
    confirmationMinConfidence: 0.7,
  },
  tags: {
    todo: "ai-queued",
    ocr: "ai-processing",
    metadata: "ai-processing",
    review: "ai-needs-input",
    index: "ai-processing",
    done: "ai-done",
    failed: "ai-failed",
    // Compatibility aliases for persisted settings and older callers.
    pending: "ai-queued",
    ocrDone: "ai-processing",
    summaryDone: "ai-processing",
    schemaReview: "ai-needs-input",
    titleDone: "ai-processing",
    correspondentDone: "ai-processing",
    documentTypeDone: "ai-processing",
    tagsDone: "ai-processing",
    processed: "ai-done",
    manualReview: "ai-needs-input",
  },
  pipeline: {
    enableOcr: true,
    enableSummary: false,
    enableTitle: true,
    enableCorrespondent: true,
    enableDocumentType: true,
    enableTags: true,
    enableCustomFields: false,
    enableDocumentLinks: true,
    // Safety bound against infinite workflow loops in full-pipeline SSE processing.
    maxSteps: 10,
  },
  http: {
    requestTimeoutMs: 120_000,
    agentPromptTimeoutMs: 120_000,
    mistralRetryAttempts: 3,
    mistralRetryBaseDelayMs: 5_000,
    rateLimitEnabled: true,
    rateLimitWindowMs: 60_000,
    rateLimitMaxRequests: 300,
    rateLimitTrustProxy: false,
  },
  concurrency: {
    ollamaMaxConcurrent: 1,
    mistralMaxConcurrent: 1,
    ocrMaxConcurrent: 1,
  },
  cutover: {
    mutationMode: "disabled",
    scanner: {
      scope: "disabled",
      canaryDocumentIds: [],
      aiAnalyseTagId: 0,
    },
  },
  language: "en",
  debug: false,
};

/**
 * Configuration service interface.
 */
export interface ConfigService {
  readonly config: ResolvedConfig;
  readonly get: <K extends keyof ResolvedConfig>(key: K) => ResolvedConfig[K];
}

/**
 * Configuration service context tag.
 */
export const ConfigService = Context.GenericTag<ConfigService>("ConfigService");

const validateAppConfig = (value: unknown): Effect.Effect<AppConfig, ConfigLoadError> =>
  Effect.try({
    try: () => Schema.decodeUnknownSync(AppConfigSchema)(value),
    catch: (error) => ({
      _tag: "ConfigLoadError" as const,
      message: "Invalid application configuration",
      cause: error,
    }),
  });

const applyDefaults = (partial: AppConfig): ResolvedConfig => ({
  paperless: {
    ...defaultConfig.paperless,
    ...partial.paperless,
  },
  ollama: {
    ...defaultConfig.ollama,
    ...partial.ollama,
  },
  mistral: {
    ...defaultConfig.mistral,
    ...partial.mistral,
  },
  qdrant: {
    ...defaultConfig.qdrant,
    ...partial.qdrant,
  },
  ocrBudget: {
    ...defaultConfig.ocrBudget,
    ...partial.ocrBudget,
  },
  autoProcessing: {
    ...defaultConfig.autoProcessing,
    ...partial.autoProcessing,
  },
  tags: {
    ...defaultConfig.tags,
    ...partial.tags,
  },
  pipeline: {
    ...defaultConfig.pipeline,
    ...partial.pipeline,
  },
  http: {
    ...defaultConfig.http,
    ...partial.http,
  },
  concurrency: {
    ...defaultConfig.concurrency,
    ...partial.concurrency,
  },
  cutover: {
    ...defaultConfig.cutover,
    ...partial.cutover,
    scanner: {
      ...defaultConfig.cutover.scanner,
      ...partial.cutover?.scanner,
    },
  },
  language: partial.language ?? defaultConfig.language,
  debug: partial.debug ?? defaultConfig.debug,
});

const truthyEnvValues = new Set(["1", "true", "yes", "on"]);

const isTruthyEnvValue = (value: string | undefined): boolean =>
  truthyEnvValues.has(value?.trim().toLowerCase() ?? "");

const shouldRequireSecrets = (): boolean =>
  isTruthyEnvValue(process.env["PAPERLESS_LLM_REQUIRE_SECRETS"]) ||
  process.env["NODE_ENV"] === "production";

const shouldRequireApiAuthToken = (): boolean =>
  shouldRequireSecrets() ||
  isTruthyEnvValue(process.env["PAPERLESS_LLM_PROD_READ_ONLY"]) ||
  isTruthyEnvValue(process.env["PAPERLESS_LLM_READ_ONLY"]);

const getConfiguredApiAuthToken = (): string =>
  process.env["PAPERLESS_LLM_API_TOKEN"] ?? process.env["LOCAL_LLM_API_KEY"] ?? "";

const isMissingSecret = (value: string): boolean => {
  const normalized = value.trim().toLowerCase();
  return normalized.length === 0 || normalized.startsWith("your-");
};

const validateRequiredSecrets = (
  resolved: ResolvedConfig,
): Effect.Effect<ResolvedConfig, ConfigLoadError> => {
  if (!shouldRequireSecrets() && !shouldRequireApiAuthToken()) return Effect.succeed(resolved);

  const missing = [
    shouldRequireSecrets() && isMissingSecret(resolved.paperless.token) ? "paperless.token" : null,
    shouldRequireSecrets() && isMissingSecret(resolved.mistral.apiKey) ? "mistral.apiKey" : null,
    shouldRequireApiAuthToken() && isMissingSecret(getConfiguredApiAuthToken())
      ? "PAPERLESS_LLM_API_TOKEN"
      : null,
  ].filter((field): field is string => field !== null);

  if (missing.length === 0) return Effect.succeed(resolved);

  return Effect.fail({
    _tag: "ConfigLoadError" as const,
    message: `Missing required secret configuration: ${missing.join(", ")}`,
  });
};

const validateCutoverConfig = (
  resolved: ResolvedConfig,
): Effect.Effect<ResolvedConfig, ConfigLoadError> =>
  Effect.try({
    try: () => {
      validateCutoverRuntimeConfig(resolved.cutover);
      return resolved;
    },
    catch: (error) => ({
      _tag: "ConfigLoadError" as const,
      message: error instanceof Error ? error.message : "Invalid cutover configuration",
      cause: error,
    }),
  });

/**
 * Create the configuration service.
 */
export const makeConfigService = (
  configPath?: string,
): Effect.Effect<ConfigService, ConfigLoadError> =>
  pipe(
    Effect.all({
      yamlConfig: loadYamlConfig(configPath),
      envConfig: loadEnvConfig(),
    }),
    Effect.flatMap(({ yamlConfig, envConfig }) => {
      const merged = mergeConfigs(yamlConfig, envConfig);
      return pipe(
        validateAppConfig(merged),
        Effect.map(applyDefaults),
        Effect.flatMap(validateCutoverConfig),
        Effect.flatMap(validateRequiredSecrets),
        Effect.map((resolved) => ({
          config: resolved,
          get: <K extends keyof ResolvedConfig>(key: K) => resolved[key],
        })),
      );
    }),
  );

/**
 * Live layer for configuration service.
 */
export const ConfigServiceLive = (configPath?: string) =>
  Layer.effect(ConfigService, makeConfigService(configPath));

// Re-export types
export type { ResolvedConfig } from "./schema.js";
export { ConfigLoadError } from "./yaml-loader.js";
