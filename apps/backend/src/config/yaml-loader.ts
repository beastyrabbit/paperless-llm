/**
 * YAML configuration loader with Effect integration.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Effect, pipe } from "effect";
import { parse as parseYaml } from "yaml";
import type { AppConfig } from "./schema.js";

export class ConfigLoadError {
  readonly _tag = "ConfigLoadError";
  constructor(
    readonly message: string,
    readonly cause?: unknown,
  ) {}
}

const normalizeYamlConfig = (raw: Record<string, unknown>): AppConfig => {
  const source = { ...raw };

  if (!source["autoProcessing"] && source["auto_processing"]) {
    source["autoProcessing"] = source["auto_processing"];
  }

  const ollama = source["ollama"];
  if (ollama && typeof ollama === "object" && !Array.isArray(ollama)) {
    const section = { ...(ollama as Record<string, unknown>) };
    section["embeddingModel"] ??= section["embedding_model"];
    delete section["embedding_model"];
    source["ollama"] = section;
  }

  const confirmation = source["confirmation"];
  if (confirmation && typeof confirmation === "object" && !Array.isArray(confirmation)) {
    const section = confirmation as Record<string, unknown>;
    const autoProcessing =
      source["autoProcessing"] && typeof source["autoProcessing"] === "object"
        ? { ...(source["autoProcessing"] as Record<string, unknown>) }
        : {};
    autoProcessing["confirmationEnabled"] ??= section["enabled"];
    autoProcessing["confirmationMaxRetries"] ??= section["max_retries"] ?? section["maxRetries"];
    autoProcessing["confirmationMinConfidence"] ??=
      section["min_confidence"] ?? section["minConfidence"];
    source["autoProcessing"] = autoProcessing;
    delete source["confirmation"];
  }

  const mistral = source["mistral"];
  if (mistral && typeof mistral === "object" && !Array.isArray(mistral)) {
    const section = { ...(mistral as Record<string, unknown>) };
    section["apiKey"] ??= section["api_key"];
    section["apiBaseUrl"] ??= section["api_base_url"] ?? section["base_url"];
    delete section["api_key"];
    delete section["api_base_url"];
    delete section["base_url"];
    source["mistral"] = section;
  }

  const qdrant = source["qdrant"];
  if (qdrant && typeof qdrant === "object" && !Array.isArray(qdrant)) {
    const section = { ...(qdrant as Record<string, unknown>) };
    section["collectionName"] ??= section["collection"];
    section["embeddingDimension"] ??= section["embedding_dimension"];
    delete section["collection"];
    delete section["embedding_dimension"];
    source["qdrant"] = section;
  }

  const language = source["language"];
  if (language && typeof language === "object" && !Array.isArray(language)) {
    const section = language as Record<string, unknown>;
    source["language"] = section["prompt"] ?? section["ui"] ?? section["default"];
  }

  const debug = source["debug"];
  if (debug && typeof debug === "object" && !Array.isArray(debug)) {
    const section = debug as Record<string, unknown>;
    source["debug"] =
      section["enabled"] ??
      section["log_prompts"] ??
      section["logPrompts"] ??
      section["save_processing_history"] ??
      section["saveProcessingHistory"] ??
      false;
  }

  if (!source["ocrBudget"] && source["ocr_budget"]) {
    source["ocrBudget"] = source["ocr_budget"];
  }
  const ocrBudget = source["ocrBudget"];
  if (ocrBudget && typeof ocrBudget === "object" && !Array.isArray(ocrBudget)) {
    const section = { ...(ocrBudget as Record<string, unknown>) };
    section["dailyPageLimit"] ??= section["daily_page_limit"];
    section["runPageLimit"] ??= section["run_page_limit"];
    section["dailyTokenLimit"] ??= section["daily_token_limit"];
    section["runTokenLimit"] ??= section["run_token_limit"];
    delete section["daily_page_limit"];
    delete section["run_page_limit"];
    delete section["daily_token_limit"];
    delete section["run_token_limit"];
    source["ocrBudget"] = section;
  }

  const autoProcessing = source["autoProcessing"];
  if (autoProcessing && typeof autoProcessing === "object" && !Array.isArray(autoProcessing)) {
    const section = { ...(autoProcessing as Record<string, unknown>) };
    section["intervalMinutes"] ??= section["interval_minutes"];
    section["includeUntagged"] ??= section["include_untagged"];
    section["confirmationEnabled"] ??= section["confirmation_enabled"];
    section["confirmationMaxRetries"] ??= section["confirmation_max_retries"];
    section["confirmationMinConfidence"] ??= section["confirmation_min_confidence"];
    delete section["interval_minutes"];
    delete section["include_untagged"];
    delete section["confirmation_enabled"];
    delete section["confirmation_max_retries"];
    delete section["confirmation_min_confidence"];
    source["autoProcessing"] = section;
  }

  const concurrency = source["concurrency"];
  if (concurrency && typeof concurrency === "object" && !Array.isArray(concurrency)) {
    const section = { ...(concurrency as Record<string, unknown>) };
    section["ollamaMaxConcurrent"] ??= section["ollama_max_concurrent"];
    section["mistralMaxConcurrent"] ??= section["mistral_max_concurrent"];
    section["ocrMaxConcurrent"] ??= section["ocr_max_concurrent"];
    delete section["ollama_max_concurrent"];
    delete section["mistral_max_concurrent"];
    delete section["ocr_max_concurrent"];
    source["concurrency"] = section;
  }

  const pipeline = source["pipeline"];
  if (pipeline && typeof pipeline === "object" && !Array.isArray(pipeline)) {
    const section = { ...(pipeline as Record<string, unknown>) };
    section["maxSteps"] ??= section["max_steps"];
    delete section["max_steps"];
    source["pipeline"] = section;
  }

  const http = source["http"];
  if (http && typeof http === "object" && !Array.isArray(http)) {
    const section = { ...(http as Record<string, unknown>) };
    section["requestTimeoutMs"] ??= section["request_timeout_ms"];
    section["agentPromptTimeoutMs"] ??= section["agent_prompt_timeout_ms"];
    section["mistralRetryAttempts"] ??= section["mistral_retry_attempts"];
    section["mistralRetryBaseDelayMs"] ??= section["mistral_retry_base_delay_ms"];
    section["rateLimitEnabled"] ??= section["rate_limit_enabled"];
    section["rateLimitWindowMs"] ??= section["rate_limit_window_ms"];
    section["rateLimitMaxRequests"] ??= section["rate_limit_max_requests"];
    section["rateLimitTrustProxy"] ??= section["rate_limit_trust_proxy"];
    delete section["request_timeout_ms"];
    delete section["agent_prompt_timeout_ms"];
    delete section["mistral_retry_attempts"];
    delete section["mistral_retry_base_delay_ms"];
    delete section["rate_limit_enabled"];
    delete section["rate_limit_window_ms"];
    delete section["rate_limit_max_requests"];
    delete section["rate_limit_trust_proxy"];
    source["http"] = section;
  }

  const cutover = source["cutover"];
  if (cutover && typeof cutover === "object" && !Array.isArray(cutover)) {
    const section = { ...(cutover as Record<string, unknown>) };
    section["mutationMode"] ??= section["mutation_mode"];
    const scanner = section["scanner"];
    if (scanner && typeof scanner === "object" && !Array.isArray(scanner)) {
      const scannerSection = { ...(scanner as Record<string, unknown>) };
      scannerSection["canaryDocumentIds"] ??= scannerSection["canary_document_ids"];
      scannerSection["aiAnalyseTagId"] ??= scannerSection["ai_analyse_tag_id"];
      delete scannerSection["canary_document_ids"];
      delete scannerSection["ai_analyse_tag_id"];
      delete scannerSection["configured_custom_field_ids"];
      delete scannerSection["system_tag_ids"];
      delete scannerSection["parent_tag_ids"];
      delete scannerSection["workflow_tag_ids"];
      section["scanner"] = scannerSection;
    }
    delete section["mutation_mode"];
    source["cutover"] = section;
  }

  const tags = source["tags"];
  if (tags && typeof tags === "object" && !Array.isArray(tags)) {
    const section = { ...(tags as Record<string, unknown>) };
    section["ocrDone"] ??= section["ocr_done"];
    section["summaryDone"] ??= section["summary_done"];
    section["schemaReview"] ??= section["schema_review"];
    section["titleDone"] ??= section["title_done"];
    section["correspondentDone"] ??= section["correspondent_done"];
    section["documentTypeDone"] ??= section["document_type_done"];
    section["tagsDone"] ??= section["tags_done"];
    section["manualReview"] ??= section["manual_review"];
    delete section["ocr_done"];
    delete section["summary_done"];
    delete section["schema_review"];
    delete section["title_done"];
    delete section["correspondent_done"];
    delete section["document_type_done"];
    delete section["tags_done"];
    delete section["manual_review"];
    source["tags"] = section;
  }

  delete source["auto_processing"];
  delete source["ocr_budget"];
  return source as AppConfig;
};

const parseEnvNumber = (value: string | undefined): number | undefined => {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

const parseEnvOcrBudgetLimit = (value: string | undefined): number | null | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (normalized === "") return value as never;
  if (normalized === "null" || normalized === "unlimited") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return value as never;
  return parsed;
};

const parseEnvBoolean = (value: string | undefined): boolean | undefined => {
  if (value === undefined) return undefined;
  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return undefined;
};

const parseEnvIntegerList = (value: string | undefined): number[] | undefined => {
  if (value === undefined) return undefined;
  const trimmed = value.trim();
  if (trimmed.length === 0) return [];
  return trimmed.split(",").map((entry) => Number(entry.trim()));
};

const parseMutationMode = (
  value: string | undefined,
): NonNullable<AppConfig["cutover"]>["mutationMode"] | undefined => {
  if (value === undefined) return undefined;
  if (value === "disabled" || value === "legacy" || value === "paperless_first") return value;
  return value as never;
};

const parseScannerScope = (
  value: string | undefined,
): NonNullable<NonNullable<AppConfig["cutover"]>["scanner"]>["scope"] | undefined => {
  if (value === undefined) return undefined;
  if (value === "disabled" || value === "canary" || value === "all") return value;
  return value as never;
};

const stripUndefined = <T>(value: T): T => {
  if (Array.isArray(value)) return value.map((entry) => stripUndefined(entry)) as T;
  if (!value || typeof value !== "object") return value;

  const cleaned: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (entry === undefined) continue;
    const next = stripUndefined(entry);
    if (
      next &&
      typeof next === "object" &&
      !Array.isArray(next) &&
      Object.keys(next as Record<string, unknown>).length === 0
    ) {
      continue;
    }
    cleaned[key] = next;
  }
  return cleaned as T;
};

const DEFAULT_CONFIG_PATH = "config.yaml";
const DOCKER_CONFIG_PATH = "/app/config.yaml";

const requestedConfigPath = (configPath?: string): string =>
  configPath ?? process.env["PAPERLESS_LLM_CONFIG"] ?? DEFAULT_CONFIG_PATH;

const isProductionConfigMode = (): boolean => process.env["NODE_ENV"] === "production";

const resolveProductionConfigPath = (configPath: string): string | null => {
  const envConfigured = process.env["PAPERLESS_LLM_CONFIG"] !== undefined;
  if (path.isAbsolute(configPath)) return fs.existsSync(configPath) ? configPath : null;

  if (envConfigured || configPath !== DEFAULT_CONFIG_PATH) {
    throw new ConfigLoadError(
      "Production config path must be absolute. Set PAPERLESS_LLM_CONFIG=/absolute/path/config.yaml.",
    );
  }

  const cwdConfig = path.join(process.cwd(), DEFAULT_CONFIG_PATH);
  if (fs.existsSync(cwdConfig)) return cwdConfig;
  return fs.existsSync(DOCKER_CONFIG_PATH) ? DOCKER_CONFIG_PATH : null;
};

export const resolveConfigPath = (configPath?: string): string | null => {
  const requestedPath = requestedConfigPath(configPath);
  if (isProductionConfigMode()) return resolveProductionConfigPath(requestedPath);

  if (path.isAbsolute(requestedPath)) return fs.existsSync(requestedPath) ? requestedPath : null;

  const candidates: string[] = [];
  let current = process.cwd();
  while (true) {
    candidates.push(path.join(current, requestedPath));
    if (requestedPath === DEFAULT_CONFIG_PATH) {
      candidates.push(path.join(current, "apps/backend/config.yaml"));
    }
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  candidates.push("/app/config.yaml");

  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
};

/**
 * Load configuration from YAML file.
 */
export const loadYamlConfig = (configPath?: string): Effect.Effect<AppConfig, ConfigLoadError> =>
  pipe(
    Effect.try({
      try: () => {
        const absolutePath = resolveConfigPath(configPath);
        if (!absolutePath) {
          return {};
        }

        const content = fs.readFileSync(absolutePath, "utf-8");
        const parsed = parseYaml(content) as Record<string, unknown> | null;
        const normalized = normalizeYamlConfig(parsed ?? {});
        // Credentials are environment-only so local, container, and production
        // startup all use the same Infisical-friendly bootstrap contract.
        const paperless = normalized.paperless ? { ...normalized.paperless } : undefined;
        const mistral = normalized.mistral ? { ...normalized.mistral } : undefined;
        if (paperless) delete (paperless as { token?: string }).token;
        if (mistral) delete (mistral as { apiKey?: string }).apiKey;
        return {
          ...normalized,
          ...(paperless ? { paperless } : {}),
          ...(mistral ? { mistral } : {}),
        };
      },
      catch: (error) =>
        error instanceof ConfigLoadError
          ? error
          : new ConfigLoadError(
              `Failed to load config from ${requestedConfigPath(configPath)}`,
              error,
            ),
    }),
  );

/**
 * Load configuration from environment variables.
 */
export const loadEnvConfig = (): Effect.Effect<Partial<AppConfig>, never> =>
  Effect.succeed(
    stripUndefined({
      paperless: {
        url: process.env["PAPERLESS_URL"],
        token: process.env["PAPERLESS_TOKEN"],
      },
      ollama: {
        url: process.env["OLLAMA_URL"],
        model: process.env["OLLAMA_MODEL"],
        embeddingModel: process.env["OLLAMA_EMBEDDING_MODEL"],
      },
      mistral: {
        apiKey: process.env["MISTRAL_API_KEY"],
        model: process.env["MISTRAL_MODEL"],
        apiBaseUrl: process.env["MISTRAL_API_BASE_URL"],
      },
      qdrant: {
        url: process.env["QDRANT_URL"],
        collectionName: process.env["QDRANT_COLLECTION"],
        embeddingDimension: parseEnvNumber(process.env["QDRANT_EMBEDDING_DIMENSION"]),
      },
      ocrBudget: {
        dailyPageLimit: parseEnvOcrBudgetLimit(process.env["PAPERLESS_LLM_OCR_DAILY_PAGE_LIMIT"]),
        runPageLimit: parseEnvOcrBudgetLimit(process.env["PAPERLESS_LLM_OCR_RUN_PAGE_LIMIT"]),
        dailyTokenLimit: parseEnvOcrBudgetLimit(process.env["PAPERLESS_LLM_OCR_DAILY_TOKEN_LIMIT"]),
        runTokenLimit: parseEnvOcrBudgetLimit(process.env["PAPERLESS_LLM_OCR_RUN_TOKEN_LIMIT"]),
      },
      autoProcessing: {
        confirmationEnabled:
          process.env["AUTO_PROCESSING_CONFIRMATION_ENABLED"] === undefined
            ? undefined
            : process.env["AUTO_PROCESSING_CONFIRMATION_ENABLED"] === "true",
        confirmationMaxRetries: parseEnvNumber(
          process.env["AUTO_PROCESSING_CONFIRMATION_MAX_RETRIES"],
        ),
        confirmationMinConfidence: parseEnvNumber(
          process.env["AUTO_PROCESSING_CONFIRMATION_MIN_CONFIDENCE"] ??
            process.env["CONFIRMATION_MIN_CONFIDENCE"],
        ),
      },
      concurrency: {
        ollamaMaxConcurrent: parseEnvNumber(process.env["PAPERLESS_LLM_OLLAMA_MAX_CONCURRENT"]),
        mistralMaxConcurrent: parseEnvNumber(process.env["PAPERLESS_LLM_MISTRAL_MAX_CONCURRENT"]),
        ocrMaxConcurrent: parseEnvNumber(process.env["PAPERLESS_LLM_OCR_MAX_CONCURRENT"]),
      },
      http: {
        requestTimeoutMs: parseEnvNumber(process.env["PAPERLESS_LLM_HTTP_TIMEOUT_MS"]),
        agentPromptTimeoutMs: parseEnvNumber(process.env["PAPERLESS_LLM_AGENT_PROMPT_TIMEOUT_MS"]),
        mistralRetryAttempts: parseEnvNumber(process.env["PAPERLESS_LLM_MISTRAL_RETRY_ATTEMPTS"]),
        mistralRetryBaseDelayMs: parseEnvNumber(
          process.env["PAPERLESS_LLM_MISTRAL_RETRY_BASE_DELAY_MS"],
        ),
        rateLimitEnabled: parseEnvBoolean(process.env["PAPERLESS_LLM_RATE_LIMIT_ENABLED"]),
        rateLimitWindowMs: parseEnvNumber(process.env["PAPERLESS_LLM_RATE_LIMIT_WINDOW_MS"]),
        rateLimitMaxRequests: parseEnvNumber(process.env["PAPERLESS_LLM_RATE_LIMIT_MAX_REQUESTS"]),
        rateLimitTrustProxy: parseEnvBoolean(process.env["PAPERLESS_LLM_RATE_LIMIT_TRUST_PROXY"]),
      },
      cutover: {
        mutationMode: parseMutationMode(process.env["PAPERLESS_LLM_MUTATION_MODE"]),
        scanner: {
          scope: parseScannerScope(process.env["PAPERLESS_LLM_AI_ANALYSE_SCANNER_SCOPE"]),
          canaryDocumentIds: parseEnvIntegerList(
            process.env["PAPERLESS_LLM_AI_ANALYSE_CANARY_DOCUMENT_IDS"],
          ),
          aiAnalyseTagId: parseEnvNumber(process.env["PAPERLESS_LLM_AI_ANALYSE_TAG_ID"]),
        },
      },
      language: process.env["LANGUAGE"],
      debug: process.env["DEBUG"] === undefined ? undefined : process.env["DEBUG"] === "true",
    }),
  );

/**
 * Deep merge two objects, preferring non-undefined values from the second.
 */
const deepMerge = <T extends Record<string, unknown>>(base: T, override: Partial<T>): T => {
  const result = { ...base } as T;

  for (const key in override) {
    const overrideValue = override[key];
    const baseValue = base[key];

    if (overrideValue === undefined) {
      continue;
    }

    if (
      typeof overrideValue === "object" &&
      overrideValue !== null &&
      !Array.isArray(overrideValue) &&
      typeof baseValue === "object" &&
      baseValue !== null
    ) {
      result[key] = deepMerge(
        baseValue as Record<string, unknown>,
        overrideValue as Record<string, unknown>,
      ) as T[Extract<keyof T, string>];
    } else {
      result[key] = overrideValue as T[Extract<keyof T, string>];
    }
  }

  return result;
};

/**
 * Merge configurations with priority: env > yaml > defaults.
 */
export const mergeConfigs = (yamlConfig: AppConfig, envConfig: Partial<AppConfig>): AppConfig =>
  deepMerge(yamlConfig, envConfig);
