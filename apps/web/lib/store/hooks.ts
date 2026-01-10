/**
 * React hooks for TinyBase store
 *
 * These hooks provide reactive access to store data in React components.
 * Changes to the store automatically trigger re-renders.
 */
"use client";

import { useRow, useTable, useResultTable } from "tinybase/ui-react";
import { store, queries } from "./index";

// Settings hooks
export const useSetting = (key: string) => {
  const row = useRow("settings", key, store);
  return row?.value as string | undefined;
};

export const useSettings = () => {
  return useTable("settings", store);
};

// Pending items hooks
export const usePendingItems = () => {
  return useTable("pendingItems", store);
};

export const usePendingItem = (id: string) => {
  return useRow("pendingItems", id, store);
};

export const usePendingByType = (type: string) => {
  // Use query result
  const allPending = useTable("pendingItems", store);
  return Object.entries(allPending)
    .filter(([, item]) => item.type === type)
    .reduce(
      (acc, [id, item]) => {
        acc[id] = item;
        return acc;
      },
      {} as Record<string, unknown>
    );
};

export const usePendingCounts = () => {
  const allPending = useTable("pendingItems", store);
  const counts = {
    correspondent: 0,
    document_type: 0,
    tag: 0,
    schema_correspondent: 0,
    schema_document_type: 0,
    schema_tag: 0,
    schema_custom_field: 0,
    schema_cleanup: 0,
    total: 0,
  };

  Object.values(allPending).forEach((item) => {
    const type = item.type as keyof typeof counts;
    if (type in counts) {
      counts[type]++;
    }
    counts.total++;
  });

  return counts;
};

// Documents hooks
export const useDocuments = () => {
  return useTable("documents", store);
};

export const useDocument = (id: number) => {
  return useRow("documents", String(id), store);
};

// Job status hooks
export const useJobStatus = (name: string) => {
  return useRow("jobStatus", name, store);
};

export const useAllJobStatus = () => {
  return useTable("jobStatus", store);
};

export const useRunningJobs = () => {
  return useResultTable("runningJobs", queries);
};

// Tag metadata hooks
export const useTagMetadata = () => {
  return useTable("tagMetadata", store);
};

export const useTagMeta = (tagId: number) => {
  return useRow("tagMetadata", String(tagId), store);
};

// Custom field metadata hooks
export const useCustomFieldMetadata = () => {
  return useTable("customFieldMetadata", store);
};

export const useCustomFieldMeta = (fieldId: number) => {
  return useRow("customFieldMetadata", String(fieldId), store);
};

// Store actions
export const useStoreActions = () => {
  return {
    // Settings
    setSetting: (key: string, value: string) => {
      store.setRow("settings", key, { key, value });
    },

    // Pending items
    addPendingItem: (item: {
      id: string;
      docId: number;
      docTitle: string;
      type: string;
      suggestion: string;
      reasoning: string;
      alternatives: string[];
      attempts: number;
      lastFeedback?: string;
      createdAt: string;
      metadata?: Record<string, unknown>;
    }) => {
      store.setRow("pendingItems", item.id, {
        id: item.id,
        docId: item.docId,
        docTitle: item.docTitle,
        type: item.type,
        suggestion: item.suggestion,
        reasoning: item.reasoning,
        alternatives: JSON.stringify(item.alternatives),
        attempts: item.attempts,
        lastFeedback: item.lastFeedback || "",
        createdAt: item.createdAt,
        metadata: JSON.stringify(item.metadata || {}),
      });
    },

    removePendingItem: (id: string) => {
      store.delRow("pendingItems", id);
    },

    updatePendingItem: (
      id: string,
      updates: Partial<{
        suggestion: string;
        attempts: number;
        lastFeedback: string;
      }>
    ) => {
      const existing = store.getRow("pendingItems", id);
      if (existing) {
        store.setRow("pendingItems", id, { ...existing, ...updates });
      }
    },

    // Documents
    setDocument: (doc: {
      id: number;
      title: string;
      correspondent?: string;
      tags: string[];
      processingStatus?: string;
    }) => {
      store.setRow("documents", String(doc.id), {
        id: doc.id,
        title: doc.title,
        correspondent: doc.correspondent || "",
        tags: JSON.stringify(doc.tags),
        processingStatus: doc.processingStatus || "",
      });
    },

    // Job status
    setJobStatus: (job: {
      name: string;
      status: string;
      lastRun?: string;
      progress?: Record<string, unknown>;
      nextRun?: string;
    }) => {
      store.setRow("jobStatus", job.name, {
        name: job.name,
        status: job.status,
        lastRun: job.lastRun || "",
        progress: JSON.stringify(job.progress || {}),
        nextRun: job.nextRun || "",
      });
    },

    // Clear all data
    clearStore: () => {
      store.delTables();
    },
  };
};
