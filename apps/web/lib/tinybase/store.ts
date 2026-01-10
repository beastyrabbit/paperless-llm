'use client';

/**
 * TinyBase Store Factory
 *
 * Creates a TinyBase store with schema validation.
 * The store is in-memory only (no browser persistence).
 */

import { createStore, Store } from 'tinybase';
import { valuesSchema, tablesSchema as _tablesSchema } from './schemas';

/**
 * Creates a new TinyBase store with schemas applied.
 */
export function createAppStore(): Store {
  const store = createStore();

  // Apply table schema
  store.setTablesSchema({
    processingLogs: {
      id: { type: 'string' },
      docId: { type: 'number' },
      timestamp: { type: 'string' },
      step: { type: 'string' },
      eventType: { type: 'string' },
      data: { type: 'string' },
      parentId: { type: 'string', default: '' },
    },
  });

  // Apply values schema - convert our const schema to TinyBase format
  // We need to build the schema dynamically since TinyBase expects specific types
  const tinybaseValuesSchema: Parameters<typeof store.setValuesSchema>[0] = {};

  for (const [key, def] of Object.entries(valuesSchema)) {
    if (def.type === 'string') {
      tinybaseValuesSchema[key] = { type: 'string', default: def.default as string };
    } else if (def.type === 'number') {
      tinybaseValuesSchema[key] = { type: 'number', default: def.default as number };
    } else if (def.type === 'boolean') {
      tinybaseValuesSchema[key] = { type: 'boolean', default: def.default as boolean };
    }
  }

  store.setValuesSchema(tinybaseValuesSchema);

  return store;
}

// Re-export Store type
export type AppStore = Store;
