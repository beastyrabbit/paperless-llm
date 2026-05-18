import type { Store } from "tinybase";

export const CURRENT_TINYBASE_SCHEMA_VERSION = 1;
const SCHEMA_METADATA_TABLE = "schemaMetadata";
const SCHEMA_VERSION_ROW = "schema_version";

export const storeSchema = {
  schemaMetadata: {
    key: { type: "string" as const },
    version: { type: "number" as const },
    updatedAt: { type: "string" as const },
  },
  pendingReviews: {
    id: { type: "string" as const },
    docId: { type: "number" as const },
    docTitle: { type: "string" as const },
    type: { type: "string" as const },
    suggestion: { type: "string" as const },
    reasoning: { type: "string" as const },
    alternatives: { type: "string" as const }, // JSON array
    attempts: { type: "number" as const },
    lastFeedback: { type: "string" as const },
    nextTag: { type: "string" as const },
    metadata: { type: "string" as const }, // JSON object
    createdAt: { type: "string" as const },
  },
  tagMetadata: {
    id: { type: "number" as const },
    paperlessTagId: { type: "number" as const },
    tagName: { type: "string" as const },
    description: { type: "string" as const },
    category: { type: "string" as const },
    excludeFromAi: { type: "boolean" as const },
  },
  customFieldMetadata: {
    id: { type: "number" as const },
    paperlessFieldId: { type: "number" as const },
    fieldName: { type: "string" as const },
    description: { type: "string" as const },
    extractionHints: { type: "string" as const },
    valueFormat: { type: "string" as const },
    exampleValues: { type: "string" as const }, // JSON array
  },
  blockedSuggestions: {
    id: { type: "number" as const },
    suggestionName: { type: "string" as const },
    normalizedName: { type: "string" as const },
    blockType: { type: "string" as const },
    rejectionReason: { type: "string" as const },
    rejectionCategory: { type: "string" as const },
    docId: { type: "number" as const },
    createdAt: { type: "string" as const },
  },
  translations: {
    key: { type: "string" as const },
    sourceLang: { type: "string" as const },
    targetLang: { type: "string" as const },
    sourceText: { type: "string" as const },
    translatedText: { type: "string" as const },
    modelUsed: { type: "string" as const },
    createdAt: { type: "string" as const },
  },
  jobStatus: {
    name: { type: "string" as const },
    status: { type: "string" as const },
    lastRun: { type: "string" as const },
    lastResult: { type: "string" as const }, // JSON
    nextRun: { type: "string" as const },
    enabled: { type: "boolean" as const },
    schedule: { type: "string" as const },
    cron: { type: "string" as const },
  },
  settings: {
    key: { type: "string" as const },
    value: { type: "string" as const },
    updatedAt: { type: "string" as const },
  },
  processingLogs: {
    id: { type: "string" as const },
    docId: { type: "number" as const },
    timestamp: { type: "string" as const },
    step: { type: "string" as const },
    eventType: { type: "string" as const },
    data: { type: "string" as const }, // JSON stringified
    parentId: { type: "string" as const },
  },
  documentOcrContent: {
    docId: { type: "number" as const },
    content: { type: "string" as const },
    pages: { type: "number" as const },
    source: { type: "string" as const }, // 'mistral' | 'paperless' | 'manual'
    createdAt: { type: "string" as const },
    updatedAt: { type: "string" as const },
  },
  ocrUsageEvents: {
    id: { type: "string" as const },
    runId: { type: "string" as const },
    docId: { type: "number" as const },
    source: { type: "string" as const },
    date: { type: "string" as const },
    estimatedPages: { type: "number" as const },
    estimatedTokens: { type: "number" as const },
    pages: { type: "number" as const },
    tokens: { type: "number" as const },
    promptTokens: { type: "number" as const },
    completionTokens: { type: "number" as const },
    model: { type: "string" as const },
    status: { type: "string" as const },
    reason: { type: "string" as const },
    createdAt: { type: "string" as const },
    updatedAt: { type: "string" as const },
  },
  documentMemory: {
    docId: { type: "number" as const },
    sessionId: { type: "string" as const },
    ocrVersionIds: { type: "string" as const }, // JSON number[]
    extractedFacts: { type: "string" as const }, // JSON
    candidateEntities: { type: "string" as const }, // JSON
    finalDecisions: { type: "string" as const }, // JSON
    humanDecisions: { type: "string" as const }, // JSON array
    reviewFeedback: { type: "string" as const }, // JSON array
    runSummaries: { type: "string" as const }, // JSON array
    transcript: { type: "string" as const }, // JSON AgentMessage[]
    createdAt: { type: "string" as const },
    updatedAt: { type: "string" as const },
  },
  consolidationReports: {
    id: { type: "string" as const },
    status: { type: "string" as const },
    proposals: { type: "string" as const }, // JSON
    summary: { type: "string" as const },
    createdAt: { type: "string" as const },
    updatedAt: { type: "string" as const },
  },
};

const parseSchemaVersion = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === "string" && /^\d+$/.test(value)) return Number(value);
  return null;
};

export const getTinyBaseSchemaVersion = (store: Store): number => {
  const row = store.getRow(SCHEMA_METADATA_TABLE, SCHEMA_VERSION_ROW);
  return parseSchemaVersion(row?.["version"]) ?? 0;
};

const writeTinyBaseSchemaVersion = (store: Store, version: number): void => {
  store.setRow(SCHEMA_METADATA_TABLE, SCHEMA_VERSION_ROW, {
    key: SCHEMA_VERSION_ROW,
    version,
    updatedAt: new Date().toISOString(),
  });
};

interface TinyBaseStoreMigration {
  readonly from: number;
  readonly to: number;
  readonly run: (store: Store) => void;
}

const tinybaseStoreMigrations: TinyBaseStoreMigration[] = [
  {
    from: 0,
    to: 1,
    run: (store) => {
      writeTinyBaseSchemaVersion(store, 1);
    },
  },
];

export const migrateTinyBaseStoreToCurrentSchema = (store: Store): boolean => {
  let version = getTinyBaseSchemaVersion(store);
  if (version > CURRENT_TINYBASE_SCHEMA_VERSION) {
    throw new Error(
      `TinyBase schema version ${version} is newer than supported version ${CURRENT_TINYBASE_SCHEMA_VERSION}`,
    );
  }

  let migrated = false;
  while (version < CURRENT_TINYBASE_SCHEMA_VERSION) {
    const migration = tinybaseStoreMigrations.find((candidate) => candidate.from === version);
    if (!migration) {
      throw new Error(`No TinyBase migration registered from schema version ${version}`);
    }
    migration.run(store);
    version = getTinyBaseSchemaVersion(store);
    if (version !== migration.to) {
      throw new Error(
        `TinyBase migration ${migration.from}->${migration.to} ended at schema version ${version}`,
      );
    }
    migrated = true;
  }

  return migrated;
};

export const verifyTinyBaseStoreSchema = (store: Store): void => {
  const version = getTinyBaseSchemaVersion(store);
  if (version !== CURRENT_TINYBASE_SCHEMA_VERSION) {
    throw new Error(
      `TinyBase schema verification failed: expected version ${CURRENT_TINYBASE_SCHEMA_VERSION}, got ${version}`,
    );
  }
};
