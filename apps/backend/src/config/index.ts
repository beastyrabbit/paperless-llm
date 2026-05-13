/**
 * Configuration service for the application.
 */
import { Context, Effect, Layer, pipe } from "effect";
import type { ResolvedConfig } from "./schema.js";
import { ConfigLoadError, loadEnvConfig, loadYamlConfig, mergeConfigs } from "./yaml-loader.js";

// Default configuration values
const defaultConfig: ResolvedConfig = {
  paperless: {
    url: "http://localhost:8000",
    token: "",
  },
  ollama: {
    url: "http://localhost:11434",
    modelLarge: "llama3.2",
    modelSmall: "llama3.2",
  },
  mistral: {
    apiKey: "",
    model: "pixtral-12b-latest",
  },
  qdrant: {
    url: "http://localhost:6333",
    collectionName: "documents",
    embeddingDimension: 768, // Must match embedding model (nomic-embed-text=768, mxbai-embed-large=1024)
  },
  autoProcessing: {
    enabled: false,
    intervalMinutes: 5,
    confirmationEnabled: true,
    confirmationMaxRetries: 3,
  },
  tags: {
    todo: "llm-todo",
    ocr: "llm-ocr",
    metadata: "llm-metadata",
    review: "llm-review",
    index: "llm-index",
    done: "llm-done",
    failed: "llm-failed",
    // Compatibility aliases for persisted settings and older callers.
    pending: "llm-todo",
    ocrDone: "llm-ocr",
    summaryDone: "llm-metadata",
    schemaReview: "llm-review",
    titleDone: "llm-metadata",
    correspondentDone: "llm-metadata",
    documentTypeDone: "llm-metadata",
    tagsDone: "llm-index",
    processed: "llm-done",
    manualReview: "llm-review",
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

/**
 * Apply defaults to a partial config.
 */
const applyDefaults = (partial: Record<string, unknown>): ResolvedConfig => {
  const result = { ...defaultConfig };

  for (const key of Object.keys(partial)) {
    const value = partial[key];
    if (value === undefined) continue;

    if (
      typeof value === "object" &&
      value !== null &&
      !Array.isArray(value) &&
      key in defaultConfig
    ) {
      const defaultSection = defaultConfig[key as keyof ResolvedConfig];
      if (typeof defaultSection === "object" && defaultSection !== null) {
        (result as Record<string, unknown>)[key] = {
          ...defaultSection,
          ...(value as Record<string, unknown>),
        };
      }
    } else {
      (result as Record<string, unknown>)[key] = value;
    }
  }

  return result;
};

/**
 * Create the configuration service.
 */
export const makeConfigService = (
  configPath = "config.yaml",
): Effect.Effect<ConfigService, ConfigLoadError> =>
  pipe(
    Effect.all({
      yamlConfig: loadYamlConfig(configPath),
      envConfig: loadEnvConfig(),
    }),
    Effect.map(({ yamlConfig, envConfig }) => {
      const merged = mergeConfigs(yamlConfig, envConfig);
      const resolved = applyDefaults(merged as Record<string, unknown>);

      return {
        config: resolved,
        get: <K extends keyof ResolvedConfig>(key: K) => resolved[key],
      };
    }),
  );

/**
 * Live layer for configuration service.
 */
export const ConfigServiceLive = (configPath = "config.yaml") =>
  Layer.effect(ConfigService, makeConfigService(configPath));

// Re-export types
export type { ResolvedConfig } from "./schema.js";
export { ConfigLoadError } from "./yaml-loader.js";
