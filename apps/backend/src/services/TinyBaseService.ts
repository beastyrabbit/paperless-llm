/**
 * TinyBase database service for local state and sync.
 */
import { Effect, Context, Layer, pipe } from 'effect';
import { createStore, type Store } from 'tinybase';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { parse as parseYaml } from 'yaml';
import { DatabaseError } from '../errors/index.js';
import type {
  PendingReview,
  PendingCounts,
  TagMetadata,
  CustomFieldMetadata,
  BlockedSuggestion,
  Translation,
  JobStatus,
  BlockType,
} from '../models/index.js';

// ===========================================================================
// Persistence Configuration
// ===========================================================================

const DATA_DIR = path.join(process.cwd(), 'data');
const PERSISTENCE_FILE = path.join(DATA_DIR, 'tinybase.json');

/**
 * Ensure the data directory exists.
 */
const ensureDataDir = (): void => {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    console.log(`[TinyBase] Created data directory: ${DATA_DIR}`);
  }
};

/**
 * Load persisted store data from disk.
 */
const loadPersistedData = (store: Store): boolean => {
  if (!fs.existsSync(PERSISTENCE_FILE)) {
    console.log('[TinyBase] No persisted data found, starting fresh');
    return false;
  }

  try {
    const json = fs.readFileSync(PERSISTENCE_FILE, 'utf-8');
    store.setJson(json);
    console.log(`[TinyBase] Loaded persisted data from ${PERSISTENCE_FILE}`);
    return true;
  } catch (error) {
    console.error('[TinyBase] Failed to load persisted data:', error);
    return false;
  }
};

/**
 * Save store data to disk.
 */
const persistStore = (store: Store): void => {
  try {
    ensureDataDir();
    const json = store.getJson();
    fs.writeFileSync(PERSISTENCE_FILE, json, 'utf-8');
  } catch (error) {
    console.error('[TinyBase] Failed to persist store:', error);
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
// Store Schema Definition
// ===========================================================================

export const storeSchema = {
  pendingReviews: {
    id: { type: 'string' as const },
    docId: { type: 'number' as const },
    docTitle: { type: 'string' as const },
    type: { type: 'string' as const },
    suggestion: { type: 'string' as const },
    reasoning: { type: 'string' as const },
    alternatives: { type: 'string' as const }, // JSON array
    attempts: { type: 'number' as const },
    lastFeedback: { type: 'string' as const },
    nextTag: { type: 'string' as const },
    metadata: { type: 'string' as const }, // JSON object
    createdAt: { type: 'string' as const },
  },
  tagMetadata: {
    id: { type: 'number' as const },
    paperlessTagId: { type: 'number' as const },
    tagName: { type: 'string' as const },
    description: { type: 'string' as const },
    category: { type: 'string' as const },
    excludeFromAi: { type: 'boolean' as const },
  },
  customFieldMetadata: {
    id: { type: 'number' as const },
    paperlessFieldId: { type: 'number' as const },
    fieldName: { type: 'string' as const },
    description: { type: 'string' as const },
    extractionHints: { type: 'string' as const },
    valueFormat: { type: 'string' as const },
    exampleValues: { type: 'string' as const }, // JSON array
  },
  blockedSuggestions: {
    id: { type: 'number' as const },
    suggestionName: { type: 'string' as const },
    normalizedName: { type: 'string' as const },
    blockType: { type: 'string' as const },
    rejectionReason: { type: 'string' as const },
    rejectionCategory: { type: 'string' as const },
    docId: { type: 'number' as const },
    createdAt: { type: 'string' as const },
  },
  translations: {
    key: { type: 'string' as const },
    sourceLang: { type: 'string' as const },
    targetLang: { type: 'string' as const },
    sourceText: { type: 'string' as const },
    translatedText: { type: 'string' as const },
    modelUsed: { type: 'string' as const },
    createdAt: { type: 'string' as const },
  },
  jobStatus: {
    name: { type: 'string' as const },
    status: { type: 'string' as const },
    lastRun: { type: 'string' as const },
    lastResult: { type: 'string' as const }, // JSON
    nextRun: { type: 'string' as const },
    enabled: { type: 'boolean' as const },
    schedule: { type: 'string' as const },
    cron: { type: 'string' as const },
  },
  settings: {
    key: { type: 'string' as const },
    value: { type: 'string' as const },
    updatedAt: { type: 'string' as const },
  },
  processingLogs: {
    id: { type: 'string' as const },
    docId: { type: 'number' as const },
    timestamp: { type: 'string' as const },
    step: { type: 'string' as const },
    eventType: { type: 'string' as const },
    data: { type: 'string' as const }, // JSON stringified
    parentId: { type: 'string' as const },
  },
};

// ===========================================================================
// Processing Log Types
// ===========================================================================

export type ProcessingLogEventType =
  | 'context'
  | 'prompt'
  | 'response'
  | 'thinking'
  | 'tool_call'
  | 'tool_result'
  | 'confirming'
  | 'retry'
  | 'result'
  | 'error'
  | 'state_transition';

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
  readonly addPendingReview: (item: Omit<PendingReview, 'id' | 'createdAt'>) => Effect.Effect<string, DatabaseError>;
  readonly updatePendingReview: (id: string, updates: Partial<PendingReview>) => Effect.Effect<void, DatabaseError>;
  readonly removePendingReview: (id: string) => Effect.Effect<void, DatabaseError>;
  readonly removePendingReviewByDocAndType: (docId: number, type: PendingReview['type']) => Effect.Effect<void, DatabaseError>;
  readonly getPendingCounts: () => Effect.Effect<PendingCounts, DatabaseError>;

  // Tag Metadata
  readonly getTagMetadata: (tagId: number) => Effect.Effect<TagMetadata | null, DatabaseError>;
  readonly getAllTagMetadata: () => Effect.Effect<TagMetadata[], DatabaseError>;
  readonly upsertTagMetadata: (data: Omit<TagMetadata, 'id'>) => Effect.Effect<void, DatabaseError>;
  readonly deleteTagMetadata: (tagId: number) => Effect.Effect<void, DatabaseError>;

  // Custom Field Metadata
  readonly getCustomFieldMetadata: (fieldId: number) => Effect.Effect<CustomFieldMetadata | null, DatabaseError>;
  readonly getAllCustomFieldMetadata: () => Effect.Effect<CustomFieldMetadata[], DatabaseError>;
  readonly upsertCustomFieldMetadata: (data: Omit<CustomFieldMetadata, 'id'>) => Effect.Effect<void, DatabaseError>;
  readonly deleteCustomFieldMetadata: (fieldId: number) => Effect.Effect<void, DatabaseError>;

  // Blocked Suggestions
  readonly getBlockedSuggestions: (type?: BlockType) => Effect.Effect<BlockedSuggestion[], DatabaseError>;
  readonly addBlockedSuggestion: (item: Omit<BlockedSuggestion, 'id' | 'createdAt' | 'normalizedName'>) => Effect.Effect<number, DatabaseError>;
  readonly removeBlockedSuggestion: (id: number) => Effect.Effect<void, DatabaseError>;
  readonly isBlocked: (name: string, type: BlockType) => Effect.Effect<boolean, DatabaseError>;

  // Translations
  readonly getTranslation: (sourceLang: string, targetLang: string, sourceText: string) => Effect.Effect<Translation | null, DatabaseError>;
  readonly setTranslation: (translation: Omit<Translation, 'key' | 'createdAt'>) => Effect.Effect<void, DatabaseError>;

  // Job Status
  readonly getJobStatus: (name: string) => Effect.Effect<JobStatus | null, DatabaseError>;
  readonly getAllJobStatuses: () => Effect.Effect<JobStatus[], DatabaseError>;
  readonly updateJobStatus: (name: string, updates: Partial<JobStatus>) => Effect.Effect<void, DatabaseError>;

  // Settings
  readonly getSetting: (key: string) => Effect.Effect<string | null, DatabaseError>;
  readonly setSetting: (key: string, value: string) => Effect.Effect<void, DatabaseError>;
  readonly getAllSettings: () => Effect.Effect<Record<string, string>, DatabaseError>;
  readonly clearAllSettings: () => Effect.Effect<void, DatabaseError>;

  // Store operations
  readonly getStoreJson: () => Effect.Effect<string, DatabaseError>;
  readonly loadFromJson: (json: string) => Effect.Effect<void, DatabaseError>;

  // Processing Logs
  readonly addProcessingLog: (entry: Omit<ProcessingLogEntry, 'id'> & { id?: string }) => Effect.Effect<string, DatabaseError>;
  readonly getProcessingLogs: (docId: number) => Effect.Effect<ProcessingLogEntry[], DatabaseError>;
  readonly clearProcessingLogs: (docId: number) => Effect.Effect<void, DatabaseError>;
  readonly clearAllProcessingLogs: () => Effect.Effect<void, DatabaseError>;
  readonly getProcessingLogStats: () => Effect.Effect<ProcessingLogStats, DatabaseError>;
}

// ===========================================================================
// Service Tag
// ===========================================================================

export const TinyBaseService = Context.GenericTag<TinyBaseService>('TinyBaseService');

// ===========================================================================
// Helper Functions
// ===========================================================================

const generateId = (): string => {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
};

const normalizeString = (str: string): string => {
  return str.toLowerCase().trim().replace(/\s+/g, ' ');
};

/**
 * TinyBase cells cannot be null, so we convert nulls to empty strings or 0
 * for storage and convert back on retrieval.
 */
const sanitizeForStorage = <T extends Record<string, unknown>>(obj: T): Record<string, string | number | boolean> => {
  const result: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (value === null || value === undefined) {
      result[key] = ''; // TinyBase doesn't accept null, use empty string as sentinel
    } else if (typeof value === 'object') {
      result[key] = JSON.stringify(value);
    } else {
      result[key] = value as string | number | boolean;
    }
  }
  return result;
};

/**
 * Convert empty strings back to null for model compatibility.
 */
const emptyToNull = (value: unknown): unknown => {
  return value === '' ? null : value;
};

/**
 * Flatten a nested object into key-value pairs with dot notation.
 */
const flattenObject = (
  obj: Record<string, unknown>,
  prefix = ''
): Record<string, string> => {
  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(obj)) {
    const newKey = prefix ? `${prefix}.${key}` : key;

    if (value === null || value === undefined) {
      continue;
    } else if (Array.isArray(value)) {
      result[newKey] = JSON.stringify(value);
    } else if (typeof value === 'object') {
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
  const possiblePaths = [
    path.join(process.cwd(), 'config.yaml'),
    path.join(process.cwd(), '../backend/config.yaml'),
    path.join(process.cwd(), '../../config.yaml'),
    path.join(process.cwd(), '../../apps/backend/config.yaml'),
    '/app/config.yaml', // Docker container path
  ];

  let configPath: string | null = null;
  for (const p of possiblePaths) {
    if (fs.existsSync(p)) {
      configPath = p;
      break;
    }
  }

  if (!configPath) {
    console.log('[TinyBase] No config.yaml found for auto-import');
    return;
  }

  try {
    const content = fs.readFileSync(configPath, 'utf-8');
    const yamlConfig = parseYaml(content) as Record<string, unknown>;

    if (!yamlConfig || Object.keys(yamlConfig).length === 0) {
      console.log('[TinyBase] config.yaml is empty');
      return;
    }

    // Flatten the config and import into the store
    const flattened = flattenObject(yamlConfig);
    let count = 0;

    for (const [key, value] of Object.entries(flattened)) {
      store.setRow('settings', key, {
        key,
        value,
        updatedAt: new Date().toISOString(),
      });
      count++;
    }

    console.log(`[TinyBase] Auto-imported ${count} settings from ${configPath}`);
  } catch (error) {
    console.error('[TinyBase] Failed to auto-import config.yaml:', error);
  }
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

    // Try to load persisted data first, fall back to config.yaml
    const hadPersistedData = loadPersistedData(store);
    if (!hadPersistedData) {
      // Only import from config.yaml if we don't have persisted data
      autoImportConfigYaml(store);
      // Persist the initial config
      persistStore(store);
    }

    // Set up auto-persistence on any store change
    store.addTablesListener(() => {
      debouncedPersist(store);
    });
    console.log('[TinyBase] Auto-persistence enabled');

    return {
      store,

      // =====================================================================
      // Pending Reviews
      // =====================================================================

      getPendingReviews: (type) =>
        Effect.try({
          try: () => {
            const table = store.getTable('pendingReviews');
            const rows = Object.entries(table ?? {}).map(([id, row]) => ({
              id,
              docId: row?.['docId'] as number,
              docTitle: row?.['docTitle'] as string,
              type: row?.['type'] as PendingReview['type'],
              suggestion: row?.['suggestion'] as string,
              reasoning: row?.['reasoning'] as string,
              alternatives: JSON.parse((row?.['alternatives'] as string) || '[]') as string[],
              attempts: row?.['attempts'] as number,
              lastFeedback: row?.['lastFeedback'] as string | null,
              nextTag: row?.['nextTag'] as string | null,
              metadata: row?.['metadata'] as string | null,
              createdAt: row?.['createdAt'] as string,
            }));

            if (type) {
              return rows.filter((r) => r.type === type);
            }
            return rows;
          },
          catch: (e) => new DatabaseError({ message: `Failed to get pending reviews: ${e}`, operation: 'getPendingReviews', cause: e }),
        }),

      getPendingReview: (id) =>
        Effect.try({
          try: () => {
            const row = store.getRow('pendingReviews', id);
            if (!row || Object.keys(row).length === 0) return null;

            return {
              id,
              docId: row['docId'] as number,
              docTitle: row['docTitle'] as string,
              type: row['type'] as PendingReview['type'],
              suggestion: row['suggestion'] as string,
              reasoning: row['reasoning'] as string,
              alternatives: JSON.parse((row['alternatives'] as string) || '[]') as string[],
              attempts: row['attempts'] as number,
              lastFeedback: row['lastFeedback'] as string | null,
              nextTag: row['nextTag'] as string | null,
              metadata: row['metadata'] as string | null,
              createdAt: row['createdAt'] as string,
            };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get pending review: ${e}`, operation: 'getPendingReview', cause: e }),
        }),

      addPendingReview: (item) =>
        Effect.try({
          try: () => {
            const id = generateId();
            const rowData = sanitizeForStorage({
              ...item,
              alternatives: JSON.stringify(item.alternatives),
              createdAt: new Date().toISOString(),
            });
            store.setRow('pendingReviews', id, rowData);
            return id;
          },
          catch: (e) => new DatabaseError({ message: `Failed to add pending review: ${e}`, operation: 'addPendingReview', cause: e }),
        }),

      updatePendingReview: (id, updates) =>
        Effect.try({
          try: () => {
            const existing = store.getRow('pendingReviews', id);
            if (existing && Object.keys(existing).length > 0) {
              const updateData = { ...updates } as Record<string, unknown>;
              if (updates.alternatives) {
                updateData['alternatives'] = JSON.stringify(updates.alternatives);
              }
              const sanitized = sanitizeForStorage(updateData);
              store.setPartialRow('pendingReviews', id, sanitized);
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to update pending review: ${e}`, operation: 'updatePendingReview', cause: e }),
        }),

      removePendingReview: (id) =>
        Effect.try({
          try: () => {
            store.delRow('pendingReviews', id);
          },
          catch: (e) => new DatabaseError({ message: `Failed to remove pending review: ${e}`, operation: 'removePendingReview', cause: e }),
        }),

      removePendingReviewByDocAndType: (docId, type) =>
        Effect.try({
          try: () => {
            const table = store.getTable('pendingReviews') ?? {};
            // Find all matching rows and delete them
            for (const [id, row] of Object.entries(table)) {
              if (row?.['docId'] === docId && row?.['type'] === type) {
                store.delRow('pendingReviews', id);
              }
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to remove pending review by doc and type: ${e}`, operation: 'removePendingReviewByDocAndType', cause: e }),
        }),

      getPendingCounts: () =>
        Effect.try({
          try: (): PendingCounts => {
            const table = store.getTable('pendingReviews') ?? {};
            const rows = Object.values(table);

            let correspondent = 0;
            let document_type = 0;
            let tag = 0;
            let title = 0;
            let schema = 0;
            let total = 0;

            for (const row of rows) {
              const rowType = row?.['type'] as string;
              if (rowType === 'correspondent') correspondent++;
              else if (rowType === 'document_type') document_type++;
              else if (rowType === 'tag') tag++;
              else if (rowType === 'title') title++;
              else if (rowType?.startsWith('schema_')) schema++;
              total++;
            }

            return { correspondent, document_type, tag, title, schema, total };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get pending counts: ${e}`, operation: 'getPendingCounts', cause: e }),
        }),

      // =====================================================================
      // Tag Metadata
      // =====================================================================

      getTagMetadata: (tagId) =>
        Effect.try({
          try: () => {
            const table = store.getTable('tagMetadata') ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.['paperlessTagId'] === tagId
            );
            if (!found) return null;

            const [id, row] = found;
            return {
              id: parseInt(id, 10),
              paperlessTagId: row?.['paperlessTagId'] as number,
              tagName: row?.['tagName'] as string,
              description: row?.['description'] as string | null,
              category: row?.['category'] as string | null,
              excludeFromAi: row?.['excludeFromAi'] as boolean,
            };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get tag metadata: ${e}`, operation: 'getTagMetadata', cause: e }),
        }),

      getAllTagMetadata: () =>
        Effect.try({
          try: () => {
            const table = store.getTable('tagMetadata') ?? {};
            return Object.entries(table).map(([id, row]) => ({
              id: parseInt(id, 10),
              paperlessTagId: row?.['paperlessTagId'] as number,
              tagName: row?.['tagName'] as string,
              description: row?.['description'] as string | null,
              category: row?.['category'] as string | null,
              excludeFromAi: row?.['excludeFromAi'] as boolean,
            }));
          },
          catch: (e) => new DatabaseError({ message: `Failed to get all tag metadata: ${e}`, operation: 'getAllTagMetadata', cause: e }),
        }),

      upsertTagMetadata: (data) =>
        Effect.try({
          try: () => {
            const table = store.getTable('tagMetadata') ?? {};
            const existing = Object.entries(table).find(
              ([, row]) => row?.['paperlessTagId'] === data.paperlessTagId
            );

            const sanitized = sanitizeForStorage(data);
            if (existing) {
              store.setPartialRow('tagMetadata', existing[0], sanitized);
            } else {
              const id = nextTagMetaId++;
              store.setRow('tagMetadata', String(id), { ...sanitized, id });
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to upsert tag metadata: ${e}`, operation: 'upsertTagMetadata', cause: e }),
        }),

      deleteTagMetadata: (tagId) =>
        Effect.try({
          try: () => {
            const table = store.getTable('tagMetadata') ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.['paperlessTagId'] === tagId
            );
            if (found) {
              store.delRow('tagMetadata', found[0]);
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to delete tag metadata: ${e}`, operation: 'deleteTagMetadata', cause: e }),
        }),

      // =====================================================================
      // Custom Field Metadata
      // =====================================================================

      getCustomFieldMetadata: (fieldId) =>
        Effect.try({
          try: () => {
            const table = store.getTable('customFieldMetadata') ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.['paperlessFieldId'] === fieldId
            );
            if (!found) return null;

            const [id, row] = found;
            return {
              id: parseInt(id, 10),
              paperlessFieldId: row?.['paperlessFieldId'] as number,
              fieldName: row?.['fieldName'] as string,
              description: row?.['description'] as string | null,
              extractionHints: row?.['extractionHints'] as string | null,
              valueFormat: row?.['valueFormat'] as string | null,
              exampleValues: row?.['exampleValues'] as string | null,
            };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get custom field metadata: ${e}`, operation: 'getCustomFieldMetadata', cause: e }),
        }),

      getAllCustomFieldMetadata: () =>
        Effect.try({
          try: () => {
            const table = store.getTable('customFieldMetadata') ?? {};
            return Object.entries(table).map(([id, row]) => ({
              id: parseInt(id, 10),
              paperlessFieldId: row?.['paperlessFieldId'] as number,
              fieldName: row?.['fieldName'] as string,
              description: row?.['description'] as string | null,
              extractionHints: row?.['extractionHints'] as string | null,
              valueFormat: row?.['valueFormat'] as string | null,
              exampleValues: row?.['exampleValues'] as string | null,
            }));
          },
          catch: (e) => new DatabaseError({ message: `Failed to get all custom field metadata: ${e}`, operation: 'getAllCustomFieldMetadata', cause: e }),
        }),

      upsertCustomFieldMetadata: (data) =>
        Effect.try({
          try: () => {
            const table = store.getTable('customFieldMetadata') ?? {};
            const existing = Object.entries(table).find(
              ([, row]) => row?.['paperlessFieldId'] === data.paperlessFieldId
            );

            const sanitized = sanitizeForStorage(data);
            if (existing) {
              store.setPartialRow('customFieldMetadata', existing[0], sanitized);
            } else {
              const id = nextFieldMetaId++;
              store.setRow('customFieldMetadata', String(id), { ...sanitized, id });
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to upsert custom field metadata: ${e}`, operation: 'upsertCustomFieldMetadata', cause: e }),
        }),

      deleteCustomFieldMetadata: (fieldId) =>
        Effect.try({
          try: () => {
            const table = store.getTable('customFieldMetadata') ?? {};
            const found = Object.entries(table).find(
              ([, row]) => row?.['paperlessFieldId'] === fieldId
            );
            if (found) {
              store.delRow('customFieldMetadata', found[0]);
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to delete custom field metadata: ${e}`, operation: 'deleteCustomFieldMetadata', cause: e }),
        }),

      // =====================================================================
      // Blocked Suggestions
      // =====================================================================

      getBlockedSuggestions: (type) =>
        Effect.try({
          try: () => {
            const table = store.getTable('blockedSuggestions') ?? {};
            const rows = Object.entries(table).map(([id, row]) => ({
              id: parseInt(id, 10),
              suggestionName: row?.['suggestionName'] as string,
              normalizedName: row?.['normalizedName'] as string,
              blockType: row?.['blockType'] as BlockType,
              rejectionReason: row?.['rejectionReason'] as string | null,
              rejectionCategory: row?.['rejectionCategory'] as BlockedSuggestion['rejectionCategory'],
              docId: row?.['docId'] as number | null,
              createdAt: row?.['createdAt'] as string,
            }));

            if (type) {
              return rows.filter((r) => r.blockType === type || r.blockType === 'global');
            }
            return rows;
          },
          catch: (e) => new DatabaseError({ message: `Failed to get blocked suggestions: ${e}`, operation: 'getBlockedSuggestions', cause: e }),
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
            store.setRow('blockedSuggestions', String(id), rowData);
            return id;
          },
          catch: (e) => new DatabaseError({ message: `Failed to add blocked suggestion: ${e}`, operation: 'addBlockedSuggestion', cause: e }),
        }),

      removeBlockedSuggestion: (id) =>
        Effect.try({
          try: () => {
            store.delRow('blockedSuggestions', String(id));
          },
          catch: (e) => new DatabaseError({ message: `Failed to remove blocked suggestion: ${e}`, operation: 'removeBlockedSuggestion', cause: e }),
        }),

      isBlocked: (name, type) =>
        Effect.try({
          try: () => {
            const normalized = normalizeString(name);
            const table = store.getTable('blockedSuggestions') ?? {};

            return Object.values(table).some(
              (row) =>
                row?.['normalizedName'] === normalized &&
                (row['blockType'] === 'global' || row['blockType'] === type)
            );
          },
          catch: (e) => new DatabaseError({ message: `Failed to check if blocked: ${e}`, operation: 'isBlocked', cause: e }),
        }),

      // =====================================================================
      // Translations
      // =====================================================================

      getTranslation: (sourceLang, targetLang, sourceText) =>
        Effect.try({
          try: () => {
            const key = `${sourceLang}:${targetLang}:${sourceText}`;
            const row = store.getRow('translations', key);
            if (!row || Object.keys(row).length === 0) return null;

            return {
              key: row['key'] as string,
              sourceLang: row['sourceLang'] as string,
              targetLang: row['targetLang'] as string,
              sourceText: row['sourceText'] as string,
              translatedText: row['translatedText'] as string,
              modelUsed: row['modelUsed'] as string | null,
              createdAt: row['createdAt'] as string,
            };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get translation: ${e}`, operation: 'getTranslation', cause: e }),
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
            store.setRow('translations', key, rowData);
          },
          catch: (e) => new DatabaseError({ message: `Failed to set translation: ${e}`, operation: 'setTranslation', cause: e }),
        }),

      // =====================================================================
      // Job Status
      // =====================================================================

      getJobStatus: (name) =>
        Effect.try({
          try: () => {
            const row = store.getRow('jobStatus', name);
            if (!row || Object.keys(row).length === 0) return null;

            return {
              name: row['name'] as string,
              status: row['status'] as JobStatus['status'],
              lastRun: row['lastRun'] as string | null,
              lastResult: row['lastResult'] as string | null,
              nextRun: row['nextRun'] as string | null,
              enabled: row['enabled'] as boolean,
              schedule: row['schedule'] as string | null,
              cron: row['cron'] as string | null,
            };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get job status: ${e}`, operation: 'getJobStatus', cause: e }),
        }),

      getAllJobStatuses: () =>
        Effect.try({
          try: () => {
            const table = store.getTable('jobStatus') ?? {};
            return Object.entries(table).map(([, row]) => ({
              name: row?.['name'] as string,
              status: row?.['status'] as JobStatus['status'],
              lastRun: row?.['lastRun'] as string | null,
              lastResult: row?.['lastResult'] as string | null,
              nextRun: row?.['nextRun'] as string | null,
              enabled: row?.['enabled'] as boolean,
              schedule: row?.['schedule'] as string | null,
              cron: row?.['cron'] as string | null,
            }));
          },
          catch: (e) => new DatabaseError({ message: `Failed to get all job statuses: ${e}`, operation: 'getAllJobStatuses', cause: e }),
        }),

      updateJobStatus: (name, updates) =>
        Effect.try({
          try: () => {
            const existing = store.getRow('jobStatus', name);
            const sanitizedUpdates = sanitizeForStorage(updates);
            if (existing && Object.keys(existing).length > 0) {
              store.setPartialRow('jobStatus', name, sanitizedUpdates);
            } else {
              const defaultRow = sanitizeForStorage({
                name,
                status: 'idle',
                lastRun: null,
                lastResult: null,
                nextRun: null,
                enabled: true,
                schedule: null,
                cron: null,
              });
              store.setRow('jobStatus', name, {
                ...defaultRow,
                ...sanitizedUpdates,
              });
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to update job status: ${e}`, operation: 'updateJobStatus', cause: e }),
        }),

      // =====================================================================
      // Settings
      // =====================================================================

      getSetting: (key) =>
        Effect.try({
          try: () => {
            const row = store.getRow('settings', key);
            return row?.['value'] as string | null ?? null;
          },
          catch: (e) => new DatabaseError({ message: `Failed to get setting: ${e}`, operation: 'getSetting', cause: e }),
        }),

      setSetting: (key, value) =>
        Effect.try({
          try: () => {
            store.setRow('settings', key, {
              key,
              value,
              updatedAt: new Date().toISOString(),
            });
          },
          catch: (e) => new DatabaseError({ message: `Failed to set setting: ${e}`, operation: 'setSetting', cause: e }),
        }),

      getAllSettings: () =>
        Effect.try({
          try: () => {
            const table = store.getTable('settings') ?? {};
            const result: Record<string, string> = {};
            for (const [key, row] of Object.entries(table)) {
              result[key] = row?.['value'] as string;
            }
            return result;
          },
          catch: (e) => new DatabaseError({ message: `Failed to get all settings: ${e}`, operation: 'getAllSettings', cause: e }),
        }),

      clearAllSettings: () =>
        Effect.try({
          try: () => {
            store.delTable('settings');
          },
          catch: (e) => new DatabaseError({ message: `Failed to clear all settings: ${e}`, operation: 'clearAllSettings', cause: e }),
        }),

      // =====================================================================
      // Store Operations
      // =====================================================================

      getStoreJson: () =>
        Effect.try({
          try: () => store.getJson(),
          catch: (e) => new DatabaseError({ message: `Failed to get store JSON: ${e}`, operation: 'getStoreJson', cause: e }),
        }),

      loadFromJson: (json) =>
        Effect.try({
          try: () => {
            store.setJson(json);
          },
          catch: (e) => new DatabaseError({ message: `Failed to load from JSON: ${e}`, operation: 'loadFromJson', cause: e }),
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
              parentId: entry.parentId ?? '',
            };
            store.setRow('processingLogs', id, rowData);
            return id;
          },
          catch: (e) => new DatabaseError({ message: `Failed to add processing log: ${e}`, operation: 'addProcessingLog', cause: e }),
        }),

      getProcessingLogs: (docId) =>
        Effect.try({
          try: () => {
            const table = store.getTable('processingLogs') ?? {};
            const logs = Object.entries(table)
              .filter(([, row]) => row?.['docId'] === docId)
              .map(([id, row]) => ({
                id,
                docId: row?.['docId'] as number,
                timestamp: row?.['timestamp'] as string,
                step: row?.['step'] as string,
                eventType: row?.['eventType'] as ProcessingLogEventType,
                data: JSON.parse((row?.['data'] as string) || '{}') as Record<string, unknown>,
                parentId: (row?.['parentId'] as string) || undefined,
              }))
              .sort((a, b) => a.timestamp.localeCompare(b.timestamp));
            return logs;
          },
          catch: (e) => new DatabaseError({ message: `Failed to get processing logs: ${e}`, operation: 'getProcessingLogs', cause: e }),
        }),

      clearProcessingLogs: (docId) =>
        Effect.try({
          try: () => {
            const table = store.getTable('processingLogs') ?? {};
            for (const [id, row] of Object.entries(table)) {
              if (row?.['docId'] === docId) {
                store.delRow('processingLogs', id);
              }
            }
          },
          catch: (e) => new DatabaseError({ message: `Failed to clear processing logs: ${e}`, operation: 'clearProcessingLogs', cause: e }),
        }),

      clearAllProcessingLogs: () =>
        Effect.try({
          try: () => {
            store.delTable('processingLogs');
          },
          catch: (e) => new DatabaseError({ message: `Failed to clear all processing logs: ${e}`, operation: 'clearAllProcessingLogs', cause: e }),
        }),

      getProcessingLogStats: () =>
        Effect.try({
          try: (): ProcessingLogStats => {
            const table = store.getTable('processingLogs') ?? {};
            const rows = Object.values(table);
            const timestamps = rows
              .map((row) => row?.['timestamp'] as string)
              .filter(Boolean)
              .sort();

            return {
              totalLogs: rows.length,
              oldestLog: timestamps[0] ?? null,
              newestLog: timestamps[timestamps.length - 1] ?? null,
            };
          },
          catch: (e) => new DatabaseError({ message: `Failed to get processing log stats: ${e}`, operation: 'getProcessingLogStats', cause: e }),
        }),
    };
  })
);
