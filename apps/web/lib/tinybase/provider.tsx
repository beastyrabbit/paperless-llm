'use client';

/**
 * TinyBase Provider Component
 *
 * Provides a TinyBase store to the React component tree with:
 * - Automatic sync from backend on mount
 * - Periodic polling for settings updates
 * - Optimistic updates with backend sync
 */

import {
  createContext,
  useContext,
  useEffect,
  useState,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { Provider as TinyBaseProvider } from 'tinybase/ui-react';
import { Store } from 'tinybase';
import { createAppStore } from './store';
import {
  type SettingKey,
  API_TO_STORE_KEY_MAP,
  STORE_TO_API_KEY_MAP,
  valuesSchema,
} from './schemas';

const API_BASE = process.env.NEXT_PUBLIC_API_URL || '';

// Sync interval in milliseconds (30 seconds)
const SYNC_INTERVAL_MS = 30000;

// Type for setting values
type SettingValue = string | number | boolean;

interface TinyBaseContextValue {
  store: Store;
  syncSettings: () => Promise<void>;
  saveSettings: () => Promise<void>;
  syncLogs: (docId: number) => Promise<void>;
  clearLogs: (docId: number) => Promise<void>;
  updateSetting: (key: SettingKey, value: SettingValue) => Promise<void>;
  updateSettings: (updates: Partial<Record<string, unknown>>) => Promise<void>;
  isSyncing: boolean;
  lastSyncError: string | null;
}

const TinyBaseContext = createContext<TinyBaseContextValue | null>(null);

interface AppTinyBaseProviderProps {
  children: ReactNode;
}

export function AppTinyBaseProvider({ children }: AppTinyBaseProviderProps) {
  const [store] = useState(() => createAppStore());
  const [isSyncing, setIsSyncing] = useState(false);
  const [lastSyncError, setLastSyncError] = useState<string | null>(null);
  const syncIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const mountedRef = useRef(true);

  /**
   * Sync settings from backend API to local store
   */
  const syncSettings = useCallback(async () => {
    if (!mountedRef.current) return;

    setIsSyncing(true);
    store.setValue('_syncing', true);
    store.setValue('_error', '');

    try {
      const response = await fetch(`${API_BASE}/api/settings`);

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const settings = await response.json();

      // Map API response to store values
      for (const [apiKey, storeKey] of Object.entries(API_TO_STORE_KEY_MAP)) {
        const value = settings[apiKey];
        if (value !== undefined && value !== null) {
          // Get the expected type from schema
          const schemaEntry = valuesSchema[storeKey as SettingKey];
          const expectedType = schemaEntry.type;

          // Convert value to correct type
          if (expectedType === 'boolean') {
            store.setValue(storeKey, Boolean(value));
          } else if (expectedType === 'number') {
            store.setValue(storeKey, Number(value));
          } else {
            store.setValue(storeKey, String(value));
          }
        }
      }

      // Handle nested tags object
      if (settings.tags && typeof settings.tags === 'object') {
        const tagKeys = [
          'pending',
          'ocr_done',
          'schema_review',
          'correspondent_done',
          'document_type_done',
          'title_done',
          'tags_done',
          'processed',
        ] as const;

        for (const tagKey of tagKeys) {
          const value = settings.tags[tagKey];
          if (value !== undefined) {
            store.setValue(`tags.${tagKey}`, String(value));
          }
        }
      }

      store.setValue('_lastSync', new Date().toISOString());
      setLastSyncError(null);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : 'Failed to sync settings';
      store.setValue('_error', errorMessage);
      setLastSyncError(errorMessage);
      console.error('Settings sync error:', error);
    } finally {
      if (mountedRef.current) {
        setIsSyncing(false);
        store.setValue('_syncing', false);
      }
    }
  }, [store]);

  /**
   * Sync processing logs for a specific document
   */
  const syncLogs = useCallback(
    async (docId: number) => {
      try {
        const response = await fetch(
          `${API_BASE}/api/processing/${docId}/logs`
        );

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }

        const { logs } = await response.json();

        // Clear existing logs for this document
        const existingTable = store.getTable('processingLogs');
        if (existingTable) {
          for (const rowId of Object.keys(existingTable)) {
            const row = existingTable[rowId];
            if (row && row.docId === docId) {
              store.delRow('processingLogs', rowId);
            }
          }
        }

        // Add new logs
        for (const log of logs || []) {
          store.setRow('processingLogs', log.id, {
            id: log.id,
            docId: log.docId,
            timestamp: log.timestamp,
            step: log.step,
            eventType: log.eventType,
            data: typeof log.data === 'string' ? log.data : JSON.stringify(log.data),
            parentId: log.parentId || '',
          });
        }
      } catch (error) {
        console.error('Failed to sync logs:', error);
      }
    },
    [store]
  );

  /**
   * Clear processing logs for a specific document
   */
  const clearLogs = useCallback(
    async (docId: number) => {
      try {
        // Clear from backend
        await fetch(`${API_BASE}/api/processing/${docId}/logs`, {
          method: 'DELETE',
        });

        // Clear from local store
        const existingTable = store.getTable('processingLogs');
        if (existingTable) {
          for (const rowId of Object.keys(existingTable)) {
            const row = existingTable[rowId];
            if (row && row.docId === docId) {
              store.delRow('processingLogs', rowId);
            }
          }
        }
      } catch (error) {
        console.error('Failed to clear logs:', error);
      }
    },
    [store]
  );

  /**
   * Update a single setting (optimistic update + backend sync)
   */
  const updateSetting = useCallback(
    async (key: SettingKey, value: SettingValue) => {
      // Optimistic update
      store.setValue(key, value);

      // Get API key for backend
      const apiKey = STORE_TO_API_KEY_MAP[key] || key;

      try {
        const response = await fetch(`${API_BASE}/api/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ [apiKey]: value }),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error('Failed to update setting:', error);
        // Could implement rollback here if needed
      }
    },
    [store]
  );

  /**
   * Update multiple settings at once
   */
  const updateSettings = useCallback(
    async (updates: Partial<Record<string, unknown>>) => {
      // Build API payload and update store optimistically
      const apiPayload: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(updates)) {
        // Determine if key is a store key or API key
        const isStoreKey = key in valuesSchema;

        if (isStoreKey) {
          // Key is a store key - map to API key for payload
          const apiKey = STORE_TO_API_KEY_MAP[key] || key;
          apiPayload[apiKey] = value;
          // Optimistic update to store
          store.setValue(key, value as SettingValue);
        } else {
          // Key is an API key - use as-is for payload
          apiPayload[key] = value;
          // Map to store key for optimistic update if mapping exists
          const storeKey = API_TO_STORE_KEY_MAP[key];
          if (storeKey && storeKey in valuesSchema) {
            store.setValue(storeKey, value as SettingValue);
          }
        }
      }

      try {
        const response = await fetch(`${API_BASE}/api/settings`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(apiPayload),
        });

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}`);
        }
      } catch (error) {
        console.error('Failed to update settings:', error);
      }
    },
    [store]
  );

  /**
   * Save all current settings from store to backend
   */
  const saveSettings = useCallback(async () => {
    setIsSyncing(true);

    try {
      // Build API payload from store values
      const apiPayload: Record<string, unknown> = {};

      // Get all store values that have API mappings
      for (const [storeKey, apiKey] of Object.entries(STORE_TO_API_KEY_MAP)) {
        const value = store.getValue(storeKey);
        if (value !== undefined && value !== null) {
          apiPayload[apiKey] = value;
        }
      }

      // Handle tags specially
      const tags: Record<string, string> = {};
      const tagKeys = [
        'pending',
        'ocr_done',
        'schema_review',
        'correspondent_done',
        'document_type_done',
        'title_done',
        'tags_done',
        'processed',
      ] as const;

      for (const tagKey of tagKeys) {
        const value = store.getValue(`tags.${tagKey}`);
        if (value !== undefined && value !== null) {
          tags[tagKey] = String(value);
        }
      }

      if (Object.keys(tags).length > 0) {
        apiPayload['tags'] = tags;
      }

      const response = await fetch(`${API_BASE}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(apiPayload),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
    } catch (error) {
      console.error('Failed to save settings:', error);
      throw error;
    } finally {
      setIsSyncing(false);
    }
  }, [store]);

  // Initial sync and periodic polling
  useEffect(() => {
    mountedRef.current = true;

    // Initial sync
    syncSettings();

    // Set up periodic polling
    syncIntervalRef.current = setInterval(() => {
      if (mountedRef.current) {
        syncSettings();
      }
    }, SYNC_INTERVAL_MS);

    return () => {
      mountedRef.current = false;
      if (syncIntervalRef.current) {
        clearInterval(syncIntervalRef.current);
      }
    };
  }, [syncSettings]);

  const contextValue: TinyBaseContextValue = {
    store,
    syncSettings,
    saveSettings,
    syncLogs,
    clearLogs,
    updateSetting,
    updateSettings,
    isSyncing,
    lastSyncError,
  };

  return (
    <TinyBaseContext.Provider value={contextValue}>
      <TinyBaseProvider store={store}>{children}</TinyBaseProvider>
    </TinyBaseContext.Provider>
  );
}

/**
 * Hook to access TinyBase context
 */
export function useTinyBase() {
  const context = useContext(TinyBaseContext);
  if (!context) {
    throw new Error('useTinyBase must be used within AppTinyBaseProvider');
  }
  return context;
}
