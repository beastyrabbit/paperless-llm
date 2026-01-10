'use client';

/**
 * TinyBase Processing Logs Hooks
 *
 * React hooks for accessing processing logs from the TinyBase store.
 * Supports real-time updates via SSE streaming.
 */

import { useTable } from 'tinybase/ui-react';
import { useMemo, useEffect, useRef, useCallback } from 'react';
import { useTinyBase } from '../provider';
import type { ProcessingLogEntry, ProcessingLogEventType } from '@/lib/api';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

/**
 * Get all processing logs for a document, reactively updated.
 * Automatically syncs logs from backend on mount.
 */
export function useProcessingLogs(docId: number): ProcessingLogEntry[] {
  const { syncLogs } = useTinyBase();
  const table = useTable('processingLogs');

  // Initial sync on mount or docId change
  useEffect(() => {
    syncLogs(docId);
  }, [docId, syncLogs]);

  // Filter and transform logs for this document
  return useMemo(() => {
    const logs: ProcessingLogEntry[] = [];

    for (const [, row] of Object.entries(table || {})) {
      if (row && row.docId === docId) {
        let parsedData: Record<string, unknown> = {};

        try {
          const dataStr = row.data as string;
          if (dataStr) {
            parsedData = JSON.parse(dataStr);
          }
        } catch {
          parsedData = { raw: row.data };
        }

        logs.push({
          id: row.id as string,
          docId: row.docId as number,
          timestamp: row.timestamp as string,
          step: row.step as string,
          eventType: row.eventType as ProcessingLogEventType,
          data: parsedData,
          parentId: (row.parentId as string) || undefined,
        });
      }
    }

    // Sort by timestamp ascending
    return logs.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
  }, [table, docId]);
}

/**
 * Get processing logs grouped by step.
 */
export function useProcessingLogsByStep(docId: number) {
  const logs = useProcessingLogs(docId);

  return useMemo(() => {
    const grouped: Record<string, ProcessingLogEntry[]> = {};

    for (const log of logs) {
      if (!grouped[log.step]) {
        grouped[log.step] = [];
      }
      grouped[log.step].push(log);
    }

    return grouped;
  }, [logs]);
}

/**
 * Get logs for a specific step.
 */
export function useStepLogs(docId: number, step: string): ProcessingLogEntry[] {
  const logs = useProcessingLogs(docId);

  return useMemo(
    () => logs.filter((log) => log.step === step),
    [logs, step]
  );
}

/**
 * Hook to subscribe to SSE stream and push logs to TinyBase store in real-time.
 * Use this when you want logs to appear as processing happens.
 */
export function useProcessingStream(docId: number, enabled: boolean = true) {
  const { store } = useTinyBase();
  const eventSourceRef = useRef<EventSource | null>(null);

  const addLogToStore = useCallback(
    (log: ProcessingLogEntry) => {
      store.setRow('processingLogs', log.id, {
        id: log.id,
        docId: log.docId,
        timestamp: log.timestamp,
        step: log.step,
        eventType: log.eventType,
        data: typeof log.data === 'string' ? log.data : JSON.stringify(log.data),
        parentId: log.parentId || '',
      });
    },
    [store]
  );

  useEffect(() => {
    if (!enabled) return;

    const eventSource = new EventSource(
      `${API_BASE}/api/processing/${docId}/stream`
    );
    eventSourceRef.current = eventSource;

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);

        // If the event contains a log entry, add it to the store
        if (data.logEntry) {
          addLogToStore(data.logEntry);
        }

        // Handle state transitions or other events that might include logs
        if (data.type === 'log_entry' && data.payload) {
          addLogToStore(data.payload);
        }
      } catch (error) {
        console.error('Failed to parse SSE event:', error);
      }
    };

    eventSource.onerror = () => {
      // Connection closed or error - SSE will auto-reconnect
      console.debug('SSE connection closed for doc', docId);
    };

    return () => {
      eventSource.close();
      eventSourceRef.current = null;
    };
  }, [docId, enabled, addLogToStore]);

  return eventSourceRef;
}

/**
 * Build a tree structure from flat logs based on parentId.
 */
export function useLogTree(docId: number) {
  const logs = useProcessingLogs(docId);

  return useMemo(() => {
    const logMap = new Map<string, ProcessingLogEntry>();
    const roots: ProcessingLogEntry[] = [];
    const children = new Map<string, ProcessingLogEntry[]>();

    // First pass: index all logs
    for (const log of logs) {
      logMap.set(log.id, log);

      if (log.parentId) {
        if (!children.has(log.parentId)) {
          children.set(log.parentId, []);
        }
        children.get(log.parentId)!.push(log);
      } else {
        roots.push(log);
      }
    }

    return {
      roots,
      children,
      getChildren: (parentId: string) => children.get(parentId) || [],
      getLog: (id: string) => logMap.get(id),
    };
  }, [logs]);
}

/**
 * Hook for managing log operations (clear, refresh).
 */
export function useLogOperations(docId: number) {
  const { syncLogs, clearLogs } = useTinyBase();

  const refresh = useCallback(() => {
    return syncLogs(docId);
  }, [docId, syncLogs]);

  const clear = useCallback(() => {
    return clearLogs(docId);
  }, [docId, clearLogs]);

  return { refresh, clear };
}
