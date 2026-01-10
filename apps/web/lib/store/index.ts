/**
 * TinyBase store for frontend state management
 *
 * This store provides:
 * - Real-time synchronization with the backend via WebSocket
 * - Local caching of settings, pending items, and documents
 * - Checkpoints for undo/redo functionality
 * - Query capabilities for filtering and aggregation
 */
import {
  createStore,
  createMergeableStore,
  createCheckpoints,
  createQueries,
} from "tinybase";
import type { Store, MergeableStore, Checkpoints, Queries } from "tinybase";

// Schema definition for type safety
export interface StoreSchema {
  settings: {
    key: string;
    value: string;
  };
  pendingItems: {
    id: string;
    docId: number;
    docTitle: string;
    type: string;
    suggestion: string;
    reasoning: string;
    alternatives: string; // JSON array
    attempts: number;
    lastFeedback: string | null;
    createdAt: string;
    metadata: string; // JSON object
  };
  documents: {
    id: number;
    title: string;
    correspondent: string | null;
    tags: string; // JSON array
    processingStatus: string | null;
  };
  jobStatus: {
    name: string;
    status: string;
    lastRun: string | null;
    progress: string; // JSON object
    nextRun: string | null;
  };
  tagMetadata: {
    tagId: number;
    tagName: string;
    description: string | null;
    category: string | null;
    excludeFromAi: boolean;
  };
  customFieldMetadata: {
    fieldId: number;
    fieldName: string;
    description: string | null;
    extractionHints: string | null;
    valueFormat: string | null;
    exampleValues: string; // JSON array
  };
}

// Create the regular store for local use
export const store: Store = createStore().setTablesSchema({
  settings: {
    key: { type: "string" },
    value: { type: "string" },
  },
  pendingItems: {
    id: { type: "string" },
    docId: { type: "number" },
    docTitle: { type: "string" },
    type: { type: "string" },
    suggestion: { type: "string" },
    reasoning: { type: "string" },
    alternatives: { type: "string" }, // JSON array
    attempts: { type: "number" },
    lastFeedback: { type: "string" },
    createdAt: { type: "string" },
    metadata: { type: "string" }, // JSON object
  },
  documents: {
    id: { type: "number" },
    title: { type: "string" },
    correspondent: { type: "string" },
    tags: { type: "string" }, // JSON array
    processingStatus: { type: "string" },
  },
  jobStatus: {
    name: { type: "string" },
    status: { type: "string" },
    lastRun: { type: "string" },
    progress: { type: "string" }, // JSON object
    nextRun: { type: "string" },
  },
  tagMetadata: {
    tagId: { type: "number" },
    tagName: { type: "string" },
    description: { type: "string" },
    category: { type: "string" },
    excludeFromAi: { type: "boolean" },
  },
  customFieldMetadata: {
    fieldId: { type: "number" },
    fieldName: { type: "string" },
    description: { type: "string" },
    extractionHints: { type: "string" },
    valueFormat: { type: "string" },
    exampleValues: { type: "string" }, // JSON array
  },
});

// Create checkpoints for undo/redo
export const checkpoints: Checkpoints = createCheckpoints(store);

// Create queries for filtering and aggregation
export const queries: Queries = createQueries(store);

// Define useful queries
queries.setQueryDefinition(
  "pendingByType",
  "pendingItems",
  ({ select, group }) => {
    select("type");
    select((getCell) => getCell("id")).as("count");
    group("count", "count");
  }
);

queries.setQueryDefinition(
  "pendingCorrespondents",
  "pendingItems",
  ({ select, where }) => {
    select("id");
    select("docId");
    select("docTitle");
    select("suggestion");
    select("reasoning");
    select("alternatives");
    select("attempts");
    select("createdAt");
    where("type", "correspondent");
  }
);

queries.setQueryDefinition(
  "pendingDocumentTypes",
  "pendingItems",
  ({ select, where }) => {
    select("id");
    select("docId");
    select("docTitle");
    select("suggestion");
    select("reasoning");
    select("alternatives");
    select("attempts");
    select("createdAt");
    where("type", "document_type");
  }
);

queries.setQueryDefinition(
  "pendingTags",
  "pendingItems",
  ({ select, where }) => {
    select("id");
    select("docId");
    select("docTitle");
    select("suggestion");
    select("reasoning");
    select("alternatives");
    select("attempts");
    select("createdAt");
    where("type", "tag");
  }
);

queries.setQueryDefinition("runningJobs", "jobStatus", ({ select, where }) => {
  select("name");
  select("status");
  select("progress");
  where("status", "running");
});

// Create a mergeable store for synchronization
// This is separate from the regular store to enable WebSocket sync
export const mergeableStore: MergeableStore = createMergeableStore();

// WebSocket synchronizer initialization
let synchronizer: unknown = null;
let isSyncInitialized = false;

export const initSync = async (wsUrl: string): Promise<void> => {
  if (isSyncInitialized) {
    // Already initialized
    return;
  }

  try {
    // Dynamic import to avoid SSR issues
    const { createWsSynchronizer } = await import(
      "tinybase/synchronizers/synchronizer-ws-client"
    );

    const ws = new WebSocket(wsUrl);
    synchronizer = await createWsSynchronizer(mergeableStore, ws);

    // Start synchronization
    await (synchronizer as { startSync: () => Promise<void> }).startSync();
    isSyncInitialized = true;

    // Copy data from mergeable store to regular store for queries
    mergeableStore.addTablesListener(() => {
      const tables = mergeableStore.getTables();
      Object.entries(tables).forEach(([tableId, rows]) => {
        Object.entries(rows).forEach(([rowId, row]) => {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          store.setRow(tableId, rowId, row as any);
        });
      });
    });
  } catch (error) {
    console.error("Failed to initialize sync:", error);
    throw error;
  }
};

export const stopSync = async (): Promise<void> => {
  if (synchronizer) {
    await (synchronizer as { destroy: () => Promise<void> }).destroy();
    synchronizer = null;
    isSyncInitialized = false;
  }
};

// Export store instance
export default store;
