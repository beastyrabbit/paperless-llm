'use client';

/**
 * TinyBase Settings Hooks
 *
 * React hooks for accessing and updating settings from the TinyBase store.
 * All hooks are reactive - components re-render when values change.
 */

import { useValue, useValues } from 'tinybase/ui-react';
import { useCallback } from 'react';
import { useTinyBase } from '../provider';
import { type SettingKey, valuesSchema } from '../schemas';

// Type for setting values
type SettingValue = string | number | boolean;

/**
 * Get a single setting value reactively.
 * Component will re-render when this value changes.
 */
export function useSetting(key: SettingKey): SettingValue {
  const value = useValue(key);
  const defaultValue = valuesSchema[key].default;

  // Return the value or default
  if (value === undefined || value === null) {
    return defaultValue;
  }

  return value as SettingValue;
}

/**
 * Get a string setting value.
 */
export function useStringSetting(key: SettingKey): string {
  const value = useSetting(key);
  return String(value);
}

/**
 * Get a boolean setting value.
 */
export function useBooleanSetting(key: SettingKey): boolean {
  const value = useSetting(key);
  return Boolean(value);
}

/**
 * Get a number setting value.
 */
export function useNumberSetting(key: SettingKey): number {
  const value = useSetting(key);
  return Number(value);
}

/**
 * Get all settings as an object.
 * Component will re-render when any value changes.
 */
export function useAllSettings() {
  const values = useValues();
  return values as Record<string, SettingValue>;
}

/**
 * Get a setting with an update function (similar to useState pattern).
 */
export function useSettingWithUpdate(key: SettingKey) {
  const value = useSetting(key);
  const { updateSetting } = useTinyBase();

  const setValue = useCallback(
    (newValue: SettingValue) => {
      return updateSetting(key, newValue);
    },
    [key, updateSetting]
  );

  return { value, setValue };
}

/**
 * Get sync status information.
 */
export function useSyncStatus() {
  const { isSyncing, lastSyncError, syncSettings } = useTinyBase();
  const lastSync = useStringSetting('_lastSync');

  return {
    isSyncing,
    lastSync: lastSync || null,
    lastError: lastSyncError,
    refresh: syncSettings,
  };
}

// Convenience hooks for commonly used settings

export function usePaperlessUrl() {
  return useStringSetting('paperless.url');
}

export function usePaperlessToken() {
  return useStringSetting('paperless.token');
}

export function useOllamaUrl() {
  return useStringSetting('ollama.url');
}

export function useOllamaModelLarge() {
  return useStringSetting('ollama.model_large');
}

export function useOllamaModelSmall() {
  return useStringSetting('ollama.model_small');
}

export function useMistralApiKey() {
  return useStringSetting('mistral.api_key');
}

export function useMistralModel() {
  return useStringSetting('mistral.model');
}

export function useQdrantUrl() {
  return useStringSetting('qdrant.url');
}

export function useAutoProcessingEnabled() {
  return useBooleanSetting('auto_processing.enabled');
}

export function useAutoProcessingInterval() {
  return useNumberSetting('auto_processing.interval_minutes');
}

export function usePromptLanguage() {
  return useStringSetting('prompt_language');
}

export function useDebugLogLevel() {
  return useStringSetting('debug.log_level');
}

// Pipeline settings
export function usePipelineOcr() {
  return useBooleanSetting('pipeline.ocr');
}

export function usePipelineTitle() {
  return useBooleanSetting('pipeline.title');
}

export function usePipelineCorrespondent() {
  return useBooleanSetting('pipeline.correspondent');
}

export function usePipelineTags() {
  return useBooleanSetting('pipeline.tags');
}

export function usePipelineCustomFields() {
  return useBooleanSetting('pipeline.custom_fields');
}

// Vector search settings
export function useVectorSearchEnabled() {
  return useBooleanSetting('vector_search.enabled');
}

export function useVectorSearchTopK() {
  return useNumberSetting('vector_search.top_k');
}

export function useVectorSearchMinScore() {
  return useNumberSetting('vector_search.min_score');
}
