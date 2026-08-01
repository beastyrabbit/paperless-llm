/**
 * TinyBase database service for local state and sync.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { Context, Effect, Layer } from "effect";
import { createStore, type Store } from "tinybase";
import { parse as parseYaml } from "yaml";
import { isForbiddenPersistedSettingKey } from "../config/provider-settings.js";
import { resolveConfigPath } from "../config/yaml-loader.js";
import { DatabaseError } from "../errors/index.js";
import type {
  BlockedSuggestion,
  BlockType,
  CustomFieldMetadata,
  JobStatus,
  PendingCounts,
  PendingReview,
  TagMetadata,
  Translation,
} from "../models/index.js";
import { tinybaseLogger } from "./tinybase/logging.js";
import {
  CURRENT_TINYBASE_SCHEMA_VERSION,
  migrateTinyBaseStoreToCurrentSchema,
  verifyTinyBaseStoreSchema,
} from "./tinybase/schema.js";

export {
  CURRENT_TINYBASE_SCHEMA_VERSION,
  getTinyBaseSchemaVersion,
  migrateTinyBaseStoreToCurrentSchema,
  storeSchema,
  verifyTinyBaseStoreSchema,
} from "./tinybase/schema.js";

// ===========================================================================
// Persistence Configuration
// ===========================================================================

const getDataDir = (): string =>
  process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"]
    ? path.resolve(process.env["PAPERLESS_LLM_TINYBASE_DATA_DIR"])
    : path.join(process.cwd(), "data");

const getPersistenceFile = (): string => path.join(getDataDir(), "tinybase.json");

/**
 * Ensure the data directory exists.
 */
const ensureDataDir = (): void => {
  const dataDir = getDataDir();
  if (!fs.existsSync(dataDir)) {
    fs.mkdirSync(dataDir, { recursive: true, mode: 0o700 });
    tinybaseLogger.info("data_directory_created", { dataDir });
  } else {
    fs.chmodSync(dataDir, 0o700);
  }
};

/**
 * Load persisted store data from disk.
 */
const loadPersistedData = (store: Store): boolean => {
  const persistenceFile = getPersistenceFile();
  if (!fs.existsSync(persistenceFile)) {
    tinybaseLogger.info("persisted_data_not_found", { persistenceFile });
    return false;
  }

  try {
    const json = fs.readFileSync(persistenceFile, "utf-8");
    JSON.parse(json);
    store.setJson(json);
    tinybaseLogger.info("persisted_data_loaded", { persistenceFile });
    return true;
  } catch (error) {
    tinybaseLogger.error("persisted_data_load_failed", { persistenceFile, error });
    const backupPath = `${persistenceFile}.corrupt-${Date.now()}`;
    try {
      fs.copyFileSync(persistenceFile, backupPath);
      fs.chmodSync(backupPath, 0o600);
      tinybaseLogger.error("corrupt_persisted_data_backed_up", { persistenceFile, backupPath });
    } catch (backupError) {
      tinybaseLogger.error("corrupt_persisted_data_backup_failed", {
        persistenceFile,
        backupPath,
        error: backupError,
      });
    }
    return false;
  }
};

/**
 * Save store data to disk.
 */
const persistStore = (store: Store): void => {
  try {
    ensureDataDir();
    const persistenceFile = getPersistenceFile();
    const json = store.getJson();
    fs.writeFileSync(persistenceFile, json, { encoding: "utf-8", mode: 0o600 });
    fs.chmodSync(persistenceFile, 0o600);
  } catch (error) {
    tinybaseLogger.error("persist_store_failed", { error });
  }
};

/**
 * Debounced persistence to avoid excessive disk writes.
 */
let persistTimeout: ReturnType<typeof setTimeout> | null = null;
const debouncedPersist = (store: Store): void => {
  if (persistTimeout) {
    clearTimeout(persistTimeout);
  }
  persistTimeout = setTimeout(() => {
    persistStore(store);
    persistTimeout = null;
  }, 500); // Save after 500ms of no changes
};

// ===========================================================================
// Processing Log Types
// ===========================================================================

export type ProcessingLogEventType =
  | "context"
  | "prompt"
  | "response"
  | "thinking"
  | "run_started"
  | "run_completed"
  | "run_cancelled"
  | "run_failed"
  | "lock_acquired"
  | "lock_released"
  | "lock_stale"
  | "agent_message"
  | "tool_call"
  | "tool_result"
  | "question_requested"
  | "question_answered"
  | "stage_started"
  | "stage_completed"
  | "stage_failed"
  | "catalog_proposal_created"
  | "catalog_proposal_applied"
  | "catalog_proposal_rejected"
  | "confirming"
  | "retry"
  | "result"
  | "error"
  | "state_transition";

export interface ProcessingLogEntry {
  id: string;
  docId: number;
  timestamp: string;
  step: string;
  eventType: ProcessingLogEventType;
  data: Record<string, unknown>;
  parentId?: string;
}

export interface ProcessingLogStats {
  totalLogs: number;
  oldestLog: string | null;
  newestLog: string | null;
}

// ===========================================================================
// Service Interface
// ===========================================================================

export interface TinyBaseService {
  readonly store: Store;

  // Pending Reviews
  readonly getPendingReviews: (type?: string) => Effect.Effect<PendingReview[], DatabaseError>;
  readonly getPendingReview: (id: string) => Effect.Effect<PendingReview | null, DatabaseError>;
  readonly addPendingReview: (
    item: Omit<PendingReview, "id" | "createdAt">,
  ) => Effect.Effect<string | null, DatabaseError>;
  readonly updatePendingReview: (
    id: string,
    updates: Partial<PendingReview>,
  ) => Effect.Effect<void, DatabaseError>;
  readonly removePendingReview: (id: string) => Effect.Effect<void, DatabaseError>;
  readonly removePendingReviewByDocAndType: (
    docId: number,
    type: PendingReview["type"],
  ) => Effect.Effect<void, DatabaseError>;
  readonly getPendingCounts: () => Effect.Effect<PendingCounts, DatabaseError>;

  // Tag Metadata
  readonly getTagMetadata: (tagId: number) => Effect.Effect<TagMetadata | null, DatabaseError>;
  readonly getAllTagMetadata: () => Effect.Effect<TagMetadata[], DatabaseError>;
  readonly upsertTagMetadata: (data: Omit<TagMetadata, "id">) => Effect.Effect<void, DatabaseError>;
  readonly deleteTagMetadata: (tagId: number) => Effect.Effect<void, DatabaseError>;

  // Custom Field Metadata
  readonly getCustomFieldMetadata: (
    fieldId: number,
  ) => Effect.Effect<CustomFieldMetadata | null, DatabaseError>;
  readonly getAllCustomFieldMetadata: () => Effect.Effect<CustomFieldMetadata[], DatabaseError>;
  readonly upsertCustomFieldMetadata: (
    data: Omit<CustomFieldMetadata, "id">,
  ) => Effect.Effect<void, DatabaseError>;
  readonly deleteCustomFieldMetadata: (fieldId: number) => Effect.Effect<void, DatabaseError>;

  // Blocked Suggestions
  readonly getBlockedSuggestions: (
    type?: BlockType,
  ) => Effect.Effect<BlockedSuggestion[], DatabaseError>;
  readonly addBlockedSuggestion: (
    item: Omit<BlockedSuggestion, "id" | "createdAt" | "normalizedName">,
  ) => Effect.Effect<number, DatabaseError>;
  readonly removeBlockedSuggestion: (id: number) => Effect.Effect<void, DatabaseError>;
  readonly isBlocked: (name: string, type: BlockType) => Effect.Effect<boolean, DatabaseError>;

  // Translations
  readonly getTranslation: (
    sourceLang: string,
    targetLang: string,
    sourceText: string,
  ) => Effect.Effect<Translation | null, DatabaseError>;
  readonly setTranslation: (
    translation: Omit<Translation, "key" | "createdAt">,
  ) => Effect.Effect<void, DatabaseError>;

  // Job Status
  readonly getJobStatus: (name: string) => Effect.Effect<JobStatus | null, DatabaseError>;
  readonly getAllJobStatuses: () => Effect.Effect<JobStatus[], DatabaseError>;
  readonly updateJobStatus: (
    name: string,
    updates: Partial<JobStatus>,
  ) => Effect.Effect<void, DatabaseError>;

  // Settings
  readonly getSetting: (key: string) => Effect.Effect<string | null, DatabaseError>;
  readonly setSetting: (key: string, value: string) => Effect.Effect<void, DatabaseError>;
  readonly getAllSettings: () => Effect.Effect<Record<string, string>, DatabaseError>;
  readonly clearAllSettings: () => Effect.Effect<void, DatabaseError>;

  // Store operations
  readonly getStoreJson: () => Effect.Effect<string, DatabaseError>;
  readonly loadFromJson: (json: string) => Effect.Effect<void, DatabaseError>;

  // Processing Logs
  readonly addProcessingLog: (
    entry: Omit<ProcessingLogEntry, "id"> & { id?: string },
  ) => Effect.Effect<string, DatabaseError>;
  readonly getProcessingLogs: (docId: number) => Effect.Effect<ProcessingLogEntry[], DatabaseError>;
  readonly clearProcessingLogs: (docId: number) => Effect.Effect<void, DatabaseError>;
  readonly clearAllProcessingLogs: () => Effect.Effect<void, DatabaseError>;
  readonly getProcessingLogStats: () => Effect.Effect<ProcessingLogStats, DatabaseError>;

  // Document OCR Content
  readonly setDocumentOcrContent: (
    docId: number,
    content: string,
    pages: number,
    source: "mistral" | "paperless" | "manual",
  ) => Effect.Effect<void, DatabaseError>;
  readonly getDocumentOcrContent: (
    docId: number,
  ) => Effect.Effect<
    { content: string; pages: number; source: string; createdAt: string; updatedAt: string } | null,
    DatabaseError
  >;
  readonly hasDocumentOcrContent: (docId: number) => Effect.Effect<boolean, DatabaseError>;
  readonly deleteDocumentOcrContent: (docId: number) => Effect.Effect<void, DatabaseError>;
  readonly getDocumentOcrContentStats: () => Effect.Effect<
    { totalDocuments: number; totalCharacters: number },
    DatabaseError
  >;

  // Document Memory
  readonly getDocumentMemory: (
    docId: number,
  ) => Effect.Effect<DocumentMemory | null, DatabaseError>;
  readonly upsertDocumentMemory: (memory: DocumentMemory) => Effect.Effect<void, DatabaseError>;
  readonly patchDocumentMemory: (
    docId: number,
    updates: Partial<DocumentMemory>,
  ) => Effect.Effect<DocumentMemory, DatabaseError>;
  readonly appendHumanDecision: (
    docId: number,
    decision: HumanDecisionRecord,
  ) => Effect.Effect<DocumentMemory, DatabaseError>;
  readonly appendReviewFeedback: (
    docId: number,
    feedback: ReviewFeedbackRecord,
  ) => Effect.Effect<DocumentMemory, DatabaseError>;
  readonly appendRunSummary: (
    docId: number,
    summary: RunSummaryRecord,
  ) => Effect.Effect<DocumentMemory, DatabaseError>;

  // Consolidation Reports
  readonly saveConsolidationReport: (
    report: ConsolidationReportRecord,
  ) => Effect.Effect<void, DatabaseError>;
  readonly getConsolidationReport: (
    id: string,
  ) => Effect.Effect<ConsolidationReportRecord | null, DatabaseError>;
  readonly getConsolidationReports: () => Effect.Effect<ConsolidationReportRecord[], DatabaseError>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const TinyBaseService = Context.GenericTag<TinyBaseService>("TinyBaseService");

// ===========================================================================
// Helper Functions
// ===========================================================================

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const normalizeString = (str: string): string => {
  return str.toLowerCase().trim().replace(/\s+/g, " ");
};

export interface HumanDecisionRecord {
  id: string;
  pendingId?: string;
  type: string;
  question: string;
  suggestion: string;
  answer: "create" | "map" | "edit" | "skip" | "reject";
  value: string | null;
  feedback?: string | null;
  decidedAt: string;
}

export interface ReviewFeedbackRecord {
  id: string;
  pendingId?: string;
  feedback: string;
  category?: string | null;
  createdAt: string;
}

export interface RunSummaryRecord {
  id: string;
  agent: string;
  status: string;
  summary: string;
  createdAt: string;
}

export interface DocumentMemory {
  docId: number;
  sessionId: string;
  ocrVersionIds: number[];
  extractedFacts: Record<string, unknown>;
  candidateEntities: Record<string, unknown>;
  finalDecisions: Record<string, unknown>;
  humanDecisions: HumanDecisionRecord[];
  reviewFeedback: ReviewFeedbackRecord[];
  runSummaries: RunSummaryRecord[];
  transcript: unknown[];
  createdAt: string;
  updatedAt: string;
}

export interface ConsolidationReportRecord {
  id: string;
  status: "draft" | "ready" | "partially_approved" | "applied" | "rejected";
  proposals: unknown[];
  summary: string;
  createdAt: string;
  updatedAt: string;
}

/**
 * TinyBase cells cannot be null, so we convert nulls to empty strings or 0
 * for storage and convert back on retrieval.
 */
const sanitizeForStorage = <T extends Record<string, unknown>>(
  obj: T,
): Record<string, string | number | boolean> => {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = ""; // TinyBase doesn't accept null, use empty string as sentinel
    } else if (typeof value === "object") {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value as string | number | boolean;
    }
  }
  return result;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === "object" && !Array.isArray(value);

const isStringArray = (value: unknown): value is string[] =>
  Array.isArray(value) && value.every((item) => typeof item === "string");

const isNumberArray = (value: unknown): value is number[] =>
  Array.isArray(value) && value.every((item) => typeof item === "number" && Number.isFinite(item));

const isUnknownArray = (value: unknown): value is unknown[] => Array.isArray(value);

const isHumanDecisionRecordArray = (value: unknown): value is HumanDecisionRecord[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item["id"] === "string" &&
      typeof item["type"] === "string" &&
      typeof item["question"] === "string" &&
      typeof item["suggestion"] === "string" &&
      typeof item["answer"] === "string" &&
      (item["value"] === null || typeof item["value"] === "string") &&
      typeof item["decidedAt"] === "string",
  );

const isReviewFeedbackRecordArray = (value: unknown): value is ReviewFeedbackRecord[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item["id"] === "string" &&
      typeof item["feedback"] === "string" &&
      typeof item["createdAt"] === "string",
  );

const isRunSummaryRecordArray = (value: unknown): value is RunSummaryRecord[] =>
  Array.isArray(value) &&
  value.every(
    (item) =>
      isRecord(item) &&
      typeof item["id"] === "string" &&
      typeof item["agent"] === "string" &&
      typeof item["status"] === "string" &&
      typeof item["summary"] === "string" &&
      typeof item["createdAt"] === "string",
  );

const parseStoredJson = <T>(
  value: unknown,
  fallback: T,
  validate: (parsed: unknown) => parsed is T,
  context: { table: string; rowId: string; field: string },
): T => {
  if (typeof value !== "string" || value.length === 0) return fallback;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch (error) {
    tinybaseLogger.warn("stored_json_parse_failed", { ...context, error });
    return fallback;
  }
  if (!validate(parsed)) {
    tinybaseLogger.warn("stored_json_validation_failed", { ...context });
    return fallback;
  }
  return parsed;
};

/**
 * Flatten a nested object into key-value pairs with dot notation.
 */
const flattenObject = (obj: Record<string, unknown>, prefix = ""): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else if (typeof value === "object") {
      Object.assign(result, flattenObject(value as Record<string, unknown>, newKey));
    } else {
      result[newKey] = String(value);
    }
  }

  return result;
};

/**
 * Auto-import settings from config.yaml into a store.
 */
const autoImportConfigYaml = (store: Store): void => {
  if (process.env["PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT"] === "true") {
    return;
  }

  const possiblePaths = [
    path.join(process.cwd(), "config.yaml"),
    path.join(process.cwd(), "../backend/config.yaml"),
    path.join(process.cwd(), "../../config.yaml"),
    path.join(process.cwd(), "../../apps/backend/config.yaml"),
    "/app/config.yaml", // Docker container path
  ];

  let configPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    tinybaseLogger.info("config_auto_import_not_found");
    return;
  }

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const yamlConfig = parseYaml(content) as Record<string, unknown>;

    if (!yamlConfig || Object.keys(yamlConfig).length === 0) {
      tinybaseLogger.info("config_auto_import_empty", { configPath });
      return;
    }

    // Flatten the config and import into the store
    const flattened = flattenObject(yamlConfig);
    let count = 0;

    for (const [key, value] of Object.entries(flattened)) {
      if (isForbiddenPersistedSettingKey(key)) continue;
      store.setRow("settings", key, {
        key,
        value,
        updatedAt: new Date().toISOString(),
      });
      count++;
    }

    tinybaseLogger.info("config_auto_import_completed", { configPath, count });
  } catch (error) {
    tinybaseLogger.error("config_auto_import_failed", { configPath, error });
  }
};

const readConfigYamlSettings = (): Record<string, string> => {
  if (process.env["PAPERLESS_LLM_TINYBASE_DISABLE_CONFIG_IMPORT"] === "true") {
    return {};
  }

  const configPath = resolveConfigPath();
  if (!configPath) return {};

  try {
    const content = fs.readFileSync(configPath, "utf-8");
    const yamlConfig = parseYaml(content) as Record<string, unknown>;
    return yamlConfig && Object.keys(yamlConfig).length > 0 ? flattenObject(yamlConfig) : {};
  } catch (error) {
    tinybaseLogger.error("settings_migration_config_read_failed", { configPath, error });
    return {};
  }
};

const migrateCanonicalSettings = (store: Store): boolean => {
  const configSettings = readConfigYamlSettings();
  const existingSettings = store.getTable("settings") ?? {};
  const removedProviderSettings = Object.keys(existingSettings).filter((key) => {
    if (!isForbiddenPersistedSettingKey(key)) return false;
    store.delRow("settings", key);
    return true;
  }).length;
  if (removedProviderSettings > 0) {
    tinybaseLogger.warn("config_owned_provider_settings_removed", {
      removed: removedProviderSettings,
    });
  }
  const table = store.getTable("settings") ?? {};
  const now = new Date().toISOString();
  const readSetting = (key: string): string | undefined => {
    const value = table[key]?.["value"];
    return typeof value === "string" ? value : undefined;
  };
  const readSettingRow = (key: string): { value: string; updatedAt: string } | null => {
    const row = table[key];
    const value = row?.["value"];
    if (typeof value !== "string") return null;
    return {
      value,
      updatedAt: typeof row?.["updatedAt"] === "string" ? row["updatedAt"] : "",
    };
  };
  const firstNonEmpty = (keys: string[]): string | undefined => {
    for (const key of keys) {
      const persisted = readSetting(key);
      if (persisted?.trim()) return persisted;
      const configured = configSettings[key];
      if (configured?.trim()) return configured;
    }
    return undefined;
  };
  const writeIfEmpty = (canonicalKey: string, sourceKeys: string[]): boolean => {
    const current = readSetting(canonicalKey);
    if (current?.trim()) return false;
    const value = firstNonEmpty(sourceKeys);
    if (!value) return false;
    store.setRow("settings", canonicalKey, { key: canonicalKey, value, updatedAt: now });
    return true;
  };
  const syncCanonicalFromLatest = (canonicalKey: string, sourceKeys: string[]): boolean => {
    const candidates = [canonicalKey, ...sourceKeys]
      .map((key) => ({ key, row: readSettingRow(key) }))
      .filter(
        (candidate): candidate is { key: string; row: { value: string; updatedAt: string } } =>
          !!candidate.row && candidate.row.value.trim().length > 0,
      )
      .sort((a, b) => b.row.updatedAt.localeCompare(a.row.updatedAt));
    const latest = candidates[0];
    if (!latest) return false;
    if (readSetting(canonicalKey) === latest.row.value) return false;
    store.setRow("settings", canonicalKey, {
      key: canonicalKey,
      value: latest.row.value,
      updatedAt: now,
    });
    return true;
  };

  const migrations: Array<[string, string[]]> = [
    ["paperless.external_url", ["paperless.external_url", "paperless_external_url"]],
    ["ollama.url", ["ollama.url", "ollama_url"]],
    ["ollama.model", ["ollama.model", "ollama_model"]],
    [
      "ollama.embedding_model",
      ["ollama.embedding_model", "ollama.embeddingModel", "ollama_embedding_model"],
    ],
    ["qdrant.url", ["qdrant.url", "qdrant_url"]],
    ["qdrant.collectionName", ["qdrant.collectionName", "qdrant.collection", "qdrant_collection"]],
    [
      "auto_processing.enabled",
      ["auto_processing.enabled", "autoProcessing.enabled", "auto_processing_enabled"],
    ],
    [
      "auto_processing.interval_minutes",
      [
        "auto_processing.interval_minutes",
        "autoProcessing.intervalMinutes",
        "auto_processing_interval_minutes",
      ],
    ],
    [
      "auto_processing.include_untagged",
      [
        "auto_processing.include_untagged",
        "autoProcessing.includeUntagged",
        "auto_processing_include_untagged",
      ],
    ],
    ["pipeline.ocr", ["pipeline.ocr", "pipeline.enableOcr", "pipeline_ocr"]],
    ["pipeline.summary", ["pipeline.summary", "pipeline.enableSummary", "pipeline_summary"]],
    ["pipeline.title", ["pipeline.title", "pipeline.enableTitle", "pipeline_title"]],
    [
      "pipeline.correspondent",
      ["pipeline.correspondent", "pipeline.enableCorrespondent", "pipeline_correspondent"],
    ],
    [
      "pipeline.document_type",
      ["pipeline.document_type", "pipeline.enableDocumentType", "pipeline_document_type"],
    ],
    ["pipeline.tags", ["pipeline.tags", "pipeline.enableTags", "pipeline_tags"]],
    [
      "pipeline.custom_fields",
      ["pipeline.custom_fields", "pipeline.enableCustomFields", "pipeline_custom_fields"],
    ],
    [
      "pipeline.document_links",
      ["pipeline.document_links", "pipeline.enableDocumentLinks", "pipeline_document_links"],
    ],
    ["vector_search.enabled", ["vector_search.enabled", "vector_search_enabled"]],
    ["vector_search.top_k", ["vector_search.top_k", "vector_search_top_k"]],
    ["vector_search.min_score", ["vector_search.min_score", "vector_search_min_score"]],
    ["language.prompt", ["language.prompt", "prompt_language", "language"]],
    ["debug.log_level", ["debug.log_level", "debug_log_level"]],
    ["debug.log_prompts", ["debug.log_prompts", "debug_log_prompts"]],
    ["debug.log_responses", ["debug.log_responses", "debug_log_responses"]],
    [
      "debug.save_processing_history",
      ["debug.save_processing_history", "debug_save_processing_history"],
    ],
  ];

  const migrated = migrations.filter(([canonicalKey, sourceKeys]) =>
    writeIfEmpty(canonicalKey, sourceKeys),
  ).length;

  if (migrated > 0) {
    tinybaseLogger.info("settings_migrated_to_canonical_keys", { migrated });
  }

  const synchronized = [
    ["vector_search.enabled", ["vector_search_enabled"]],
    ["vector_search.top_k", ["vector_search_top_k"]],
    ["vector_search.min_score", ["vector_search_min_score"]],
    ["auto_processing.enabled", ["auto_processing_enabled"]],
    ["auto_processing.interval_minutes", ["auto_processing_interval_minutes"]],
    ["auto_processing.include_untagged", ["auto_processing_include_untagged"]],
  ].filter(([canonicalKey, sourceKeys]) =>
    syncCanonicalFromLatest(canonicalKey as string, sourceKeys as string[]),
  ).length;

  if (synchronized > 0) {
    tinybaseLogger.info("canonical_settings_synchronized_from_aliases", { synchronized });
  }

  return removedProviderSettings > 0 || migrated > 0 || synchronized > 0;
};

// ===========================================================================
// Live Implementation
// ===========================================================================

export const TinyBaseServiceLive = Layer.effect(
  TinyBaseService,
  Effect.gen(function* () {
    const store = createStore();
    let nextBlockedId = 1;
    let nextTagMetaId = 1;
    let nextFieldMetaId = 1;

    const getNextNumericRowId = (tableName: string): number => {
      const table = store.getTable(tableName) ?? {};
      const maxId = Object.keys(table)
        .map((id) => Number(id))
        .filter(Number.isFinite)
        .reduce((max, id) => Math.max(max, id), 0);
      return maxId + 1;
    };

    // Try to load persisted data first, fall back to config.yaml.
    const hadPersistedData = loadPersistedData(store);
    const schemaMigrated = migrateTinyBaseStoreToCurrentSchema(store);
    if (schemaMigrated) {
      tinybaseLogger.info("schema_migration_completed", {
        version: CURRENT_TINYBASE_SCHEMA_VERSION,
      });
    }
    if (!hadPersistedData) {
      // Only import from config.yaml if we don't have persisted data
      autoImportConfigYaml(store);
    }
    const settingsMigrated = migrateCanonicalSettings(store);
    if (!hadPersistedData || schemaMigrated || settingsMigrated) {
      persistStore(store);
    }
    verifyTinyBaseStoreSchema(store);

    nextBlockedId = getNextNumericRowId("blockedSuggestions");
    nextTagMetaId = getNextNumericRowId("tagMetadata");
    nextFieldMetaId = getNextNumericRowId("customFieldMetadata");

    // Set up auto-persistence on any store change
    store.addTablesListener(() => {
      debouncedPersist(store);
    });
    tinybaseLogger.info("auto_persistence_enabled");

    const createEmptyMemory = (docId: number): DocumentMemory => {
      const now = new Date().toISOString();
      return {
        docId,
        sessionId: `doc-${docId}-${generateId()}`,
        ocrVersionIds: [],
        extractedFacts: {},
        candidateEntities: {},
        finalDecisions: {},
        humanDecisions: [],
        reviewFeedback: [],
        runSummaries: [],
        transcript: [],
        createdAt: now,
        updatedAt: now,
      };
    };

    const rowToMemory = (rowId: string): DocumentMemory | null => {
      const row = store.getRow("documentMemory", rowId);
      if (!row || Object.keys(row).length === 0) return null;
      return {
        docId: row["docId"] as number,
        sessionId: row["sessionId"] as string,
        ocrVersionIds: parseStoredJson(row["ocrVersionIds"], [], isNumberArray, {
          table: "documentMemory",
          rowId,
          field: "ocrVersionIds",
        }),
        extractedFacts: parseStoredJson(row["extractedFacts"], {}, isRecord, {
          table: "documentMemory",
          rowId,
          field: "extractedFacts",
        }),
        candidateEntities: parseStoredJson(row["candidateEntities"], {}, isRecord, {
          table: "documentMemory",
          rowId,
          field: "candidateEntities",
        }),
        finalDecisions: parseStoredJson(row["finalDecisions"], {}, isRecord, {
          table: "documentMemory",
          rowId,
          field: "finalDecisions",
        }),
        humanDecisions: parseStoredJson(row["humanDecisions"], [], isHumanDecisionRecordArray, {
          table: "documentMemory",
          rowId,
          field: "humanDecisions",
        }),
        reviewFeedback: parseStoredJson(row["reviewFeedback"], [], isReviewFeedbackRecordArray, {
          table: "documentMemory",
          rowId,
          field: "reviewFeedback",
        }),
        runSummaries: parseStoredJson(row["runSummaries"], [], isRunSummaryRecordArray, {
          table: "documentMemory",
          rowId,
          field: "runSummaries",
        }),
        transcript: parseStoredJson(row["transcript"], [], isUnknownArray, {
          table: "documentMemory",
          rowId,
          field: "transcript",
        }),
        createdAt: row["createdAt"] as string,
        updatedAt: row["updatedAt"] as string,
      };
    };

    const writeMemory = (memory: DocumentMemory): void => {
      store.setRow("documentMemory", String(memory.docId), {
        docId: memory.docId,
        sessionId: memory.sessionId,
        ocrVersionIds: JSON.stringify(memory.ocrVersionIds),
        extractedFacts: JSON.stringify(memory.extractedFacts),
        candidateEntities: JSON.stringify(memory.candidateEntities),
        finalDecisions: JSON.stringify(memory.finalDecisions),
        humanDecisions: JSON.stringify(memory.humanDecisions),
        reviewFeedback: JSON.stringify(memory.reviewFeedback),
        runSummaries: JSON.stringify(memory.runSummaries),
        transcript: JSON.stringify(memory.transcript),
        createdAt: memory.createdAt,
        updatedAt: memory.updatedAt,
      });
    };

    const getOrCreateMemory = (docId: number): DocumentMemory =>
      rowToMemory(String(docId)) ?? createEmptyMemory(docId);

    const rowToConsolidationReport = (rowId: string): ConsolidationReportRecord | null => {
      const row = store.getRow("consolidationReports", rowId);
      if (!row || Object.keys(row).length === 0) return null;
      return {
        id: row["id"] as string,
        status: row["status"] as ConsolidationReportRecord["status"],
        proposals: parseStoredJson(row["proposals"], [], isUnknownArray, {
          table: "consolidationReports",
          rowId,
          field: "proposals",
        }),
        summary: row["summary"] as string,
        createdAt: row["createdAt"] as string,
        updatedAt: row["updatedAt"] as string,
      };
    };

    return {
      store,

      // =====================================================================
      // Pending Reviews
      // =====================================================================

      getPendingReviews: (type) =>
        Effect.try({
          try: () => {
            const table = store.getTable("pendingReviews");
            const rows = Object.entries(table ?? {}).map(([id, row]) => ({
              id,
              docId: row?.["docId"] as number,
              docTitle: row?.["docTitle"] as string,
              type: row?.["type"] as PendingReview["type"],
              suggestion: row?.["suggestion"] as string,
              reasoning: row?.["reasoning"] as string,
              alternatives: parseStoredJson(row?.["alternatives"], [], isStringArray, {
                table: "pendingReviews",
                rowId: id,
                field: "alternatives",
              }),
              attempts: row?.["attempts"] as number,
              lastFeedback: row?.["lastFeedback"] as string | null,
              nextTag: row?.["nextTag"] as string | null,
              metadata: row?.["metadata"] as string | null,
              createdAt: row?.["createdAt"] as string,
            }));

            if (type) {
              return rows.filter((r) => r.type === type);
            }
            return rows;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get pending reviews: ${e}`,
              operation: "getPendingReviews",
              cause: e,
            }),
        }),

      getPendingReview: (id) =>
        Effect.try({
          try: () => {
            const row = store.getRow("pendingReviews", id);
            if (!row || Object.keys(row).length === 0) return null;

            return {
              id,
              docId: row["docId"] as number,
              docTitle: row["docTitle"] as string,
              type: row["type"] as PendingReview["type"],
              suggestion: row["suggestion"] as string,
              reasoning: row["reasoning"] as string,
              alternatives: parseStoredJson(row["alternatives"], [], isStringArray, {
                table: "pendingReviews",
                rowId: id,
                field: "alternatives",
              }),
              attempts: row["attempts"] as number,
              lastFeedback: row["lastFeedback"] as string | null,
              nextTag: row["nextTag"] as string | null,
              metadata: row["metadata"] as string | null,
              createdAt: row["createdAt"] as string,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get pending review: ${e}`,
              operation: "getPendingReview",
              cause: e,
            }),
        }),

      addPendingReview: (item) =>
        Effect.try({
          try: (): string | null => {
            // Skip empty suggestions - don't add items with no actual suggestion
            const trimmedSuggestion = item.suggestion?.trim() ?? "";
            if (!trimmedSuggestion) {
              tinybaseLogger.info("pending_review_skipped_empty_suggestion", {
                docId: item.docId,
                reviewType: item.type,
              });
              return null;
            }

            // Check for duplicates: same docId + type + suggestion (normalized)
            const table = store.getTable("pendingReviews") ?? {};
            const normalizedSuggestion = trimmedSuggestion.toLowerCase();

            for (const [existingId, row] of Object.entries(table)) {
              if (
                row.docId === item.docId &&
                row.type === item.type &&
                String(row.suggestion).toLowerCase().trim() === normalizedSuggestion
              ) {
                // Duplicate found - return existing ID without adding
                return existingId;
              }
            }

            // No duplicate - add new item
            const id = generateId();
            const rowData = sanitizeForStorage({
              ...item,
              suggestion: trimmedSuggestion,
              alternatives: JSON.stringify(item.alternatives),
              createdAt: new Date().toISOString(),
            });
            store.setRow("pendingReviews", id, rowData);
            return id;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to add pending review: ${e}`,
              operation: "addPendingReview",
              cause: e,
            }),
        }),

      updatePendingReview: (id, updates) =>
        Effect.try({
          try: () => {
            const existing = store.getRow("pendingReviews", id);
            if (existing && Object.keys(existing).length > 0) {
              const updateData = { ...updates } as Record<string, unknown>;
              if (updates.alternatives) {
                updateData["alternatives"] = JSON.stringify(updates.alternatives);
              }
              const sanitized = sanitizeForStorage(updateData);
              store.setPartialRow("pendingReviews", id, sanitized);
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to update pending review: ${e}`,
              operation: "updatePendingReview",
              cause: e,
            }),
        }),

      removePendingReview: (id) =>
        Effect.try({
          try: () => {
            store.delRow("pendingReviews", id);
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to remove pending review: ${e}`,
              operation: "removePendingReview",
              cause: e,
            }),
        }),

      removePendingReviewByDocAndType: (docId, type) =>
        Effect.try({
          try: () => {
            const table = store.getTable("pendingReviews") ?? {};
            // Find all matching rows and delete them
            for (const [id, row] of Object.entries(table)) {
              if (row?.["docId"] === docId && row?.["type"] === type) {
                store.delRow("pendingReviews", id);
              }
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to remove pending review by doc and type: ${e}`,
              operation: "removePendingReviewByDocAndType",
              cause: e,
            }),
        }),

      getPendingCounts: () =>
        Effect.try({
          try: (): PendingCounts => {
            const table = store.getTable("pendingReviews") ?? {};
            const rows = Object.values(table);

            let correspondent = 0;
            let document_type = 0;
            let tag = 0;
            let title = 0;
            let human_decision = 0;
            let consolidation = 0;
            let schema_correspondent = 0;
            let schema_document_type = 0;
            let schema_tag = 0;
            let schema_custom_field = 0;
            let schema_merge = 0;
            let schema_delete = 0;
            let schema_cleanup = 0;
            let metadata_description = 0;
            let schema = 0;
            let total = 0;

            for (const row of rows) {
              const rowType = row?.["type"] as string;
              if (rowType === "correspondent") correspondent++;
              else if (rowType === "document_type") document_type++;
              else if (rowType === "tag") tag++;
              else if (rowType === "title") title++;
              else if (rowType === "human_decision") human_decision++;
              else if (rowType === "consolidation") consolidation++;
              else if (rowType === "schema_correspondent") schema_correspondent++;
              else if (rowType === "schema_document_type") schema_document_type++;
              else if (rowType === "schema_tag") schema_tag++;
              else if (rowType === "schema_custom_field") schema_custom_field++;
              else if (rowType === "schema_merge") schema_merge++;
              else if (rowType === "schema_delete") schema_delete++;
              else if (rowType === "schema_cleanup") schema_cleanup++;
              else if (rowType === "metadata_description") metadata_description++;
              if (rowType?.startsWith("schema_")) schema++;
              // Note: documentlink items are no longer queued for review
              total++;
            }

            return {
              correspondent,
              document_type,
              tag,
              title,
              human_decision,
              consolidation,
              schema_correspondent,
              schema_document_type,
              schema_tag,
              schema_custom_field,
              schema_merge,
              schema_delete,
              schema_cleanup,
              metadata_description,
              schema,
              total,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get pending counts: ${e}`,
              operation: "getPendingCounts",
              cause: e,
            }),
        }),

      // =====================================================================
      // Tag Metadata
      // =====================================================================

      getTagMetadata: (tagId) =>
        Effect.try({
          try: () => {
            const table = store.getTable("tagMetadata") ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.["paperlessTagId"] === tagId,
            );
            if (!found) return null;

            const [id, row] = found;
            return {
              id: parseInt(id, 10),
              paperlessTagId: row?.["paperlessTagId"] as number,
              tagName: row?.["tagName"] as string,
              description: row?.["description"] as string | null,
              category: row?.["category"] as string | null,
              excludeFromAi: row?.["excludeFromAi"] as boolean,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get tag metadata: ${e}`,
              operation: "getTagMetadata",
              cause: e,
            }),
        }),

      getAllTagMetadata: () =>
        Effect.try({
          try: () => {
            const table = store.getTable("tagMetadata") ?? {};
            return Object.entries(table).map(([id, row]) => ({
              id: parseInt(id, 10),
              paperlessTagId: row?.["paperlessTagId"] as number,
              tagName: row?.["tagName"] as string,
              description: row?.["description"] as string | null,
              category: row?.["category"] as string | null,
              excludeFromAi: row?.["excludeFromAi"] as boolean,
            }));
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get all tag metadata: ${e}`,
              operation: "getAllTagMetadata",
              cause: e,
            }),
        }),

      upsertTagMetadata: (data) =>
        Effect.try({
          try: () => {
            const table = store.getTable("tagMetadata") ?? {};
            const existing = Object.entries(table).find(
              ([, row]) => row?.["paperlessTagId"] === data.paperlessTagId,
            );

            const sanitized = sanitizeForStorage(data);
            if (existing) {
              store.setPartialRow("tagMetadata", existing[0], sanitized);
            } else {
              const id = nextTagMetaId++;
              store.setRow("tagMetadata", String(id), { ...sanitized, id });
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to upsert tag metadata: ${e}`,
              operation: "upsertTagMetadata",
              cause: e,
            }),
        }),

      deleteTagMetadata: (tagId) =>
        Effect.try({
          try: () => {
            const table = store.getTable("tagMetadata") ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.["paperlessTagId"] === tagId,
            );
            if (found) {
              store.delRow("tagMetadata", found[0]);
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to delete tag metadata: ${e}`,
              operation: "deleteTagMetadata",
              cause: e,
            }),
        }),

      // =====================================================================
      // Custom Field Metadata
      // =====================================================================

      getCustomFieldMetadata: (fieldId) =>
        Effect.try({
          try: () => {
            const table = store.getTable("customFieldMetadata") ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.["paperlessFieldId"] === fieldId,
            );
            if (!found) return null;

            const [id, row] = found;
            return {
              id: parseInt(id, 10),
              paperlessFieldId: row?.["paperlessFieldId"] as number,
              fieldName: row?.["fieldName"] as string,
              description: row?.["description"] as string | null,
              extractionHints: row?.["extractionHints"] as string | null,
              valueFormat: row?.["valueFormat"] as string | null,
              exampleValues: row?.["exampleValues"] as string | null,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get custom field metadata: ${e}`,
              operation: "getCustomFieldMetadata",
              cause: e,
            }),
        }),

      getAllCustomFieldMetadata: () =>
        Effect.try({
          try: () => {
            const table = store.getTable("customFieldMetadata") ?? {};
            return Object.entries(table).map(([id, row]) => ({
              id: parseInt(id, 10),
              paperlessFieldId: row?.["paperlessFieldId"] as number,
              fieldName: row?.["fieldName"] as string,
              description: row?.["description"] as string | null,
              extractionHints: row?.["extractionHints"] as string | null,
              valueFormat: row?.["valueFormat"] as string | null,
              exampleValues: row?.["exampleValues"] as string | null,
            }));
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get all custom field metadata: ${e}`,
              operation: "getAllCustomFieldMetadata",
              cause: e,
            }),
        }),

      upsertCustomFieldMetadata: (data) =>
        Effect.try({
          try: () => {
            const table = store.getTable("customFieldMetadata") ?? {};
            const existing = Object.entries(table).find(
              ([, row]) => row?.["paperlessFieldId"] === data.paperlessFieldId,
            );

            const sanitized = sanitizeForStorage(data);
            if (existing) {
              store.setPartialRow("customFieldMetadata", existing[0], sanitized);
            } else {
              const id = nextFieldMetaId++;
              store.setRow("customFieldMetadata", String(id), { ...sanitized, id });
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to upsert custom field metadata: ${e}`,
              operation: "upsertCustomFieldMetadata",
              cause: e,
            }),
        }),

      deleteCustomFieldMetadata: (fieldId) =>
        Effect.try({
          try: () => {
            const table = store.getTable("customFieldMetadata") ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.["paperlessFieldId"] === fieldId,
            );
            if (found) {
              store.delRow("customFieldMetadata", found[0]);
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to delete custom field metadata: ${e}`,
              operation: "deleteCustomFieldMetadata",
              cause: e,
            }),
        }),

      // =====================================================================
      // Blocked Suggestions
      // =====================================================================

      getBlockedSuggestions: (type) =>
        Effect.try({
          try: () => {
            const table = store.getTable("blockedSuggestions") ?? {};
            const rows = Object.entries(table).map(([id, row]) => ({
              id: parseInt(id, 10),
              suggestionName: row?.["suggestionName"] as string,
              normalizedName: row?.["normalizedName"] as string,
              blockType: row?.["blockType"] as BlockType,
              rejectionReason: row?.["rejectionReason"] as string | null,
              rejectionCategory: row?.[
                "rejectionCategory"
              ] as BlockedSuggestion["rejectionCategory"],
              docId: row?.["docId"] as number | null,
              createdAt: row?.["createdAt"] as string,
            }));

            if (type) {
              return rows.filter((r) => r.blockType === type || r.blockType === "global");
            }
            return rows;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get blocked suggestions: ${e}`,
              operation: "getBlockedSuggestions",
              cause: e,
            }),
        }),

      addBlockedSuggestion: (item) =>
        Effect.try({
          try: () => {
            const id = nextBlockedId++;
            const rowData = sanitizeForStorage({
              ...item,
              id,
              normalizedName: normalizeString(item.suggestionName),
              createdAt: new Date().toISOString(),
            });
            store.setRow("blockedSuggestions", String(id), rowData);
            return id;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to add blocked suggestion: ${e}`,
              operation: "addBlockedSuggestion",
              cause: e,
            }),
        }),

      removeBlockedSuggestion: (id) =>
        Effect.try({
          try: () => {
            store.delRow("blockedSuggestions", String(id));
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to remove blocked suggestion: ${e}`,
              operation: "removeBlockedSuggestion",
              cause: e,
            }),
        }),

      isBlocked: (name, type) =>
        Effect.try({
          try: () => {
            const normalized = normalizeString(name);
            const table = store.getTable("blockedSuggestions") ?? {};

            return Object.values(table).some(
              (row) =>
                row?.["normalizedName"] === normalized &&
                (row["blockType"] === "global" || row["blockType"] === type),
            );
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to check if blocked: ${e}`,
              operation: "isBlocked",
              cause: e,
            }),
        }),

      // =====================================================================
      // Translations
      // =====================================================================

      getTranslation: (sourceLang, targetLang, sourceText) =>
        Effect.try({
          try: () => {
            const key = `${sourceLang}:${targetLang}:${sourceText}`;
            const row = store.getRow("translations", key);
            if (!row || Object.keys(row).length === 0) return null;

            return {
              key: row["key"] as string,
              sourceLang: row["sourceLang"] as string,
              targetLang: row["targetLang"] as string,
              sourceText: row["sourceText"] as string,
              translatedText: row["translatedText"] as string,
              modelUsed: row["modelUsed"] as string | null,
              createdAt: row["createdAt"] as string,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get translation: ${e}`,
              operation: "getTranslation",
              cause: e,
            }),
        }),

      setTranslation: (translation) =>
        Effect.try({
          try: () => {
            const key = `${translation.sourceLang}:${translation.targetLang}:${translation.sourceText}`;
            const rowData = sanitizeForStorage({
              ...translation,
              key,
              createdAt: new Date().toISOString(),
            });
            store.setRow("translations", key, rowData);
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to set translation: ${e}`,
              operation: "setTranslation",
              cause: e,
            }),
        }),

      // =====================================================================
      // Job Status
      // =====================================================================

      getJobStatus: (name) =>
        Effect.try({
          try: () => {
            const row = store.getRow("jobStatus", name);
            if (!row || Object.keys(row).length === 0) return null;

            return {
              name: row["name"] as string,
              status: row["status"] as JobStatus["status"],
              lastRun: row["lastRun"] as string | null,
              lastResult: row["lastResult"] as string | null,
              nextRun: row["nextRun"] as string | null,
              enabled: row["enabled"] as boolean,
              schedule: row["schedule"] as string | null,
              cron: row["cron"] as string | null,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get job status: ${e}`,
              operation: "getJobStatus",
              cause: e,
            }),
        }),

      getAllJobStatuses: () =>
        Effect.try({
          try: () => {
            const table = store.getTable("jobStatus") ?? {};
            return Object.entries(table).map(([, row]) => ({
              name: row?.["name"] as string,
              status: row?.["status"] as JobStatus["status"],
              lastRun: row?.["lastRun"] as string | null,
              lastResult: row?.["lastResult"] as string | null,
              nextRun: row?.["nextRun"] as string | null,
              enabled: row?.["enabled"] as boolean,
              schedule: row?.["schedule"] as string | null,
              cron: row?.["cron"] as string | null,
            }));
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get all job statuses: ${e}`,
              operation: "getAllJobStatuses",
              cause: e,
            }),
        }),

      updateJobStatus: (name, updates) =>
        Effect.try({
          try: () => {
            const existing = store.getRow("jobStatus", name);
            const sanitizedUpdates = sanitizeForStorage(updates);
            if (existing && Object.keys(existing).length > 0) {
              store.setPartialRow("jobStatus", name, sanitizedUpdates);
            } else {
              const defaultRow = sanitizeForStorage({
                name,
                status: "idle",
                lastRun: null,
                lastResult: null,
                nextRun: null,
                enabled: true,
                schedule: null,
                cron: null,
              });
              store.setRow("jobStatus", name, {
                ...defaultRow,
                ...sanitizedUpdates,
              });
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to update job status: ${e}`,
              operation: "updateJobStatus",
              cause: e,
            }),
        }),

      // =====================================================================
      // Settings
      // =====================================================================

      getSetting: (key) =>
        Effect.try({
          try: () => {
            const row = store.getRow("settings", key);
            return (row?.["value"] as string | null) ?? null;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get setting: ${e}`,
              operation: "getSetting",
              cause: e,
            }),
        }),

      setSetting: (key, value) =>
        Effect.try({
          try: () => {
            if (isForbiddenPersistedSettingKey(key)) {
              throw new Error(
                "Provider connection and secret settings must come from environment/YAML configuration",
              );
            }
            store.setRow("settings", key, {
              key,
              value,
              updatedAt: new Date().toISOString(),
            });
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to set setting: ${e}`,
              operation: "setSetting",
              cause: e,
            }),
        }),

      getAllSettings: () =>
        Effect.try({
          try: () => {
            const table = store.getTable("settings") ?? {};
            const result: Record<string, string> = {};
            for (const [key, row] of Object.entries(table)) {
              result[key] = row?.["value"] as string;
            }
            return result;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get all settings: ${e}`,
              operation: "getAllSettings",
              cause: e,
            }),
        }),

      clearAllSettings: () =>
        Effect.try({
          try: () => {
            store.delTable("settings");
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to clear all settings: ${e}`,
              operation: "clearAllSettings",
              cause: e,
            }),
        }),

      // =====================================================================
      // Store Operations
      // =====================================================================

      getStoreJson: () =>
        Effect.try({
          try: () => store.getJson(),
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get store JSON: ${e}`,
              operation: "getStoreJson",
              cause: e,
            }),
        }),

      loadFromJson: (json) =>
        Effect.try({
          try: () => {
            store.setJson(json);
            migrateTinyBaseStoreToCurrentSchema(store);
            verifyTinyBaseStoreSchema(store);
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to load from JSON: ${e}`,
              operation: "loadFromJson",
              cause: e,
            }),
        }),

      // =====================================================================
      // Processing Logs
      // =====================================================================

      addProcessingLog: (entry) =>
        Effect.try({
          try: () => {
            const id = entry.id ?? generateId();
            const rowData = {
              id,
              docId: entry.docId,
              timestamp: entry.timestamp,
              step: entry.step,
              eventType: entry.eventType,
              data: JSON.stringify(entry.data),
              parentId: entry.parentId ?? "",
            };
            store.setRow("processingLogs", id, rowData);
            return id;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to add processing log: ${e}`,
              operation: "addProcessingLog",
              cause: e,
            }),
        }),

      getProcessingLogs: (docId) =>
        Effect.try({
          try: () => {
            const table = store.getTable("processingLogs") ?? {};
            const logs = Object.entries(table)
              .filter(([, row]) => row?.["docId"] === docId)
              .map(([id, row]) => ({
                id,
                docId: row?.["docId"] as number,
                timestamp: row?.["timestamp"] as string,
                step: row?.["step"] as string,
                eventType: row?.["eventType"] as ProcessingLogEventType,
                data: parseStoredJson(row?.["data"], {}, isRecord, {
                  table: "processingLogs",
                  rowId: id,
                  field: "data",
                }),
                parentId: (row?.["parentId"] as string) || undefined,
              }))
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            return logs;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get processing logs: ${e}`,
              operation: "getProcessingLogs",
              cause: e,
            }),
        }),

      clearProcessingLogs: (docId) =>
        Effect.try({
          try: () => {
            const table = store.getTable("processingLogs") ?? {};
            for (const [id, row] of Object.entries(table)) {
              if (row?.["docId"] === docId) {
                store.delRow("processingLogs", id);
              }
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to clear processing logs: ${e}`,
              operation: "clearProcessingLogs",
              cause: e,
            }),
        }),

      clearAllProcessingLogs: () =>
        Effect.try({
          try: () => {
            store.delTable("processingLogs");
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to clear all processing logs: ${e}`,
              operation: "clearAllProcessingLogs",
              cause: e,
            }),
        }),

      getProcessingLogStats: () =>
        Effect.try({
          try: (): ProcessingLogStats => {
            const table = store.getTable("processingLogs") ?? {};
            const rows = Object.values(table);
            const timestamps = rows
              .map((row) => row?.["timestamp"] as string)
              .filter(Boolean)
              .sort();

            return {
              totalLogs: rows.length,
              oldestLog: timestamps[0] ?? null,
              newestLog: timestamps[timestamps.length - 1] ?? null,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get processing log stats: ${e}`,
              operation: "getProcessingLogStats",
              cause: e,
            }),
        }),

      // =====================================================================
      // Document OCR Content
      // =====================================================================

      setDocumentOcrContent: (docId, content, pages, source) =>
        Effect.try({
          try: () => {
            const existing = store.getRow("documentOcrContent", String(docId));
            const now = new Date().toISOString();
            if (existing && Object.keys(existing).length > 0) {
              // Update existing
              store.setRow("documentOcrContent", String(docId), {
                docId,
                content,
                pages,
                source,
                createdAt: existing["createdAt"] as string,
                updatedAt: now,
              });
            } else {
              // Create new
              store.setRow("documentOcrContent", String(docId), {
                docId,
                content,
                pages,
                source,
                createdAt: now,
                updatedAt: now,
              });
            }
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to set document OCR content: ${e}`,
              operation: "setDocumentOcrContent",
              cause: e,
            }),
        }),

      getDocumentOcrContent: (docId) =>
        Effect.try({
          try: () => {
            const row = store.getRow("documentOcrContent", String(docId));
            if (!row || Object.keys(row).length === 0) return null;

            return {
              content: row["content"] as string,
              pages: row["pages"] as number,
              source: row["source"] as string,
              createdAt: row["createdAt"] as string,
              updatedAt: row["updatedAt"] as string,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get document OCR content: ${e}`,
              operation: "getDocumentOcrContent",
              cause: e,
            }),
        }),

      hasDocumentOcrContent: (docId) =>
        Effect.try({
          try: () => {
            const row = store.getRow("documentOcrContent", String(docId));
            return row !== null && Object.keys(row).length > 0;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to check document OCR content: ${e}`,
              operation: "hasDocumentOcrContent",
              cause: e,
            }),
        }),

      deleteDocumentOcrContent: (docId) =>
        Effect.try({
          try: () => {
            store.delRow("documentOcrContent", String(docId));
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to delete document OCR content: ${e}`,
              operation: "deleteDocumentOcrContent",
              cause: e,
            }),
        }),

      getDocumentOcrContentStats: () =>
        Effect.try({
          try: () => {
            const table = store.getTable("documentOcrContent") ?? {};
            const rows = Object.values(table);
            let totalCharacters = 0;
            for (const row of rows) {
              const content = row?.["content"] as string;
              if (content) {
                totalCharacters += content.length;
              }
            }
            return {
              totalDocuments: rows.length,
              totalCharacters,
            };
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get document OCR content stats: ${e}`,
              operation: "getDocumentOcrContentStats",
              cause: e,
            }),
        }),

      // =====================================================================
      // Document Memory
      // =====================================================================

      getDocumentMemory: (docId) =>
        Effect.try({
          try: () => rowToMemory(String(docId)),
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get document memory: ${e}`,
              operation: "getDocumentMemory",
              cause: e,
            }),
        }),

      upsertDocumentMemory: (memory) =>
        Effect.try({
          try: () => writeMemory({ ...memory, updatedAt: new Date().toISOString() }),
          catch: (e) =>
            new DatabaseError({
              message: `Failed to upsert document memory: ${e}`,
              operation: "upsertDocumentMemory",
              cause: e,
            }),
        }),

      patchDocumentMemory: (docId, updates) =>
        Effect.try({
          try: () => {
            const current = getOrCreateMemory(docId);
            const next: DocumentMemory = {
              ...current,
              ...updates,
              docId,
              sessionId: updates.sessionId ?? current.sessionId,
              ocrVersionIds: updates.ocrVersionIds ?? current.ocrVersionIds,
              extractedFacts: updates.extractedFacts ?? current.extractedFacts,
              candidateEntities: updates.candidateEntities ?? current.candidateEntities,
              finalDecisions: updates.finalDecisions ?? current.finalDecisions,
              humanDecisions: updates.humanDecisions ?? current.humanDecisions,
              reviewFeedback: updates.reviewFeedback ?? current.reviewFeedback,
              runSummaries: updates.runSummaries ?? current.runSummaries,
              transcript: updates.transcript ?? current.transcript,
              createdAt: current.createdAt,
              updatedAt: new Date().toISOString(),
            };
            writeMemory(next);
            return next;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to patch document memory: ${e}`,
              operation: "patchDocumentMemory",
              cause: e,
            }),
        }),

      appendHumanDecision: (docId, decision) =>
        Effect.try({
          try: () => {
            const current = getOrCreateMemory(docId);
            const next = {
              ...current,
              humanDecisions: [...current.humanDecisions, decision],
              updatedAt: new Date().toISOString(),
            };
            writeMemory(next);
            return next;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to append human decision: ${e}`,
              operation: "appendHumanDecision",
              cause: e,
            }),
        }),

      appendReviewFeedback: (docId, feedback) =>
        Effect.try({
          try: () => {
            const current = getOrCreateMemory(docId);
            const next = {
              ...current,
              reviewFeedback: [...current.reviewFeedback, feedback],
              updatedAt: new Date().toISOString(),
            };
            writeMemory(next);
            return next;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to append review feedback: ${e}`,
              operation: "appendReviewFeedback",
              cause: e,
            }),
        }),

      appendRunSummary: (docId, summary) =>
        Effect.try({
          try: () => {
            const current = getOrCreateMemory(docId);
            const next = {
              ...current,
              runSummaries: [...current.runSummaries, summary],
              updatedAt: new Date().toISOString(),
            };
            writeMemory(next);
            return next;
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to append run summary: ${e}`,
              operation: "appendRunSummary",
              cause: e,
            }),
        }),

      // =====================================================================
      // Consolidation Reports
      // =====================================================================

      saveConsolidationReport: (report) =>
        Effect.try({
          try: () => {
            store.setRow("consolidationReports", report.id, {
              id: report.id,
              status: report.status,
              proposals: JSON.stringify(report.proposals),
              summary: report.summary,
              createdAt: report.createdAt,
              updatedAt: report.updatedAt,
            });
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to save consolidation report: ${e}`,
              operation: "saveConsolidationReport",
              cause: e,
            }),
        }),

      getConsolidationReport: (id) =>
        Effect.try({
          try: () => rowToConsolidationReport(id),
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get consolidation report: ${e}`,
              operation: "getConsolidationReport",
              cause: e,
            }),
        }),

      getConsolidationReports: () =>
        Effect.try({
          try: () => {
            const table = store.getTable("consolidationReports") ?? {};
            return Object.keys(table)
              .map(rowToConsolidationReport)
              .filter((row): row is ConsolidationReportRecord => row !== null)
              .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
          },
          catch: (e) =>
            new DatabaseError({
              message: `Failed to get consolidation reports: ${e}`,
              operation: "getConsolidationReports",
              cause: e,
            }),
        }),
    };
  }),
);
