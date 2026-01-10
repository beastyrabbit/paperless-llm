/**
 * TinyBase Module - Barrel Exports
 *
 * Centralized exports for all TinyBase-related functionality.
 */

// Provider and context
export { AppTinyBaseProvider, useTinyBase } from './provider';

// Store factory
export { createAppStore, type AppStore } from './store';

// Schemas and types
export {
  valuesSchema,
  tablesSchema,
  type ValuesSchema,
  type TablesSchema,
  type SettingKey,
  API_TO_STORE_KEY_MAP,
  STORE_TO_API_KEY_MAP,
} from './schemas';

// Settings hooks
export {
  useSetting,
  useStringSetting,
  useBooleanSetting,
  useNumberSetting,
  useAllSettings,
  useSettingWithUpdate,
  useSyncStatus,
  // Convenience hooks
  usePaperlessUrl,
  usePaperlessToken,
  useOllamaUrl,
  useOllamaModelLarge,
  useOllamaModelSmall,
  useMistralApiKey,
  useMistralModel,
  useQdrantUrl,
  useAutoProcessingEnabled,
  useAutoProcessingInterval,
  usePromptLanguage,
  useDebugLogLevel,
  usePipelineOcr,
  usePipelineTitle,
  usePipelineCorrespondent,
  usePipelineTags,
  usePipelineCustomFields,
  useVectorSearchEnabled,
  useVectorSearchTopK,
  useVectorSearchMinScore,
} from './hooks/useSettings';

// Processing logs hooks
export {
  useProcessingLogs,
  useProcessingLogsByStep,
  useStepLogs,
  useProcessingStream,
  useLogTree,
  useLogOperations,
} from './hooks/useProcessingLogs';
