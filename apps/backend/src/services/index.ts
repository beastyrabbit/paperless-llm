/**
 * Service exports.
 */
export { ConfigService, ConfigServiceLive, type ResolvedConfig } from "../config/index.js";
export {
  AutoProcessingService,
  AutoProcessingServiceLive,
  type AutoProcessingStatus,
} from "./AutoProcessingService.js";
export {
  ConcurrencyLimitService,
  ConcurrencyLimitServiceLive,
} from "./ConcurrencyLimitService.js";
export {
  CatalogAgentService,
  CatalogAgentServiceLive,
  type CatalogProposal,
  type CatalogRun,
} from "./CatalogAgentService.js";
export {
  type CaseAnswer,
  type CaseFailureDetail,
  type CaseQuestion,
  type DocumentCase,
  DocumentCaseService,
  DocumentCaseServiceLive,
} from "./DocumentCaseService.js";
export {
  type DocumentAuthorization,
  type DocumentAuthorizationAction,
  DocumentAuthorizationService,
  DocumentAuthorizationServiceLive,
  DocumentAuthorizationServiceNoop,
} from "./DocumentAuthorizationService.js";
export {
  type DurableLock,
  LockService,
  LockServiceLive,
} from "./LockService.js";
export {
  classifyMetricsErrorOutcome,
  metrics,
  metricsRegistry,
  metricReasonFromError,
  normalizeMetricPath,
  observeDuration,
  MetricsRegistry,
  type MetricLabels,
} from "./MetricsService.js";

export {
  type OcrUsageBudget,
  OcrBudgetExceededError,
  OcrUsageService,
  OcrUsageServiceLive,
  estimatePdfPages,
} from "./OcrUsageService.js";

export {
  type MistralChatMessage,
  type MistralChatOptions,
  type MistralChatResponse,
  type MistralDocumentResult,
  type MistralModel,
  MistralService,
  MistralServiceLive,
} from "./MistralService.js";

export {
  type OllamaChatMessage,
  type OllamaChatOptions,
  type OllamaChatResponse,
  type OllamaModel,
  OllamaService,
  OllamaServiceLive,
  type OllamaStreamChunk,
} from "./OllamaService.js";
export {
  PaperlessService,
  PaperlessServiceLive,
} from "./PaperlessService.js";
export {
  type TagCacheEntry,
  type TagCacheResult,
  TagCacheService,
  TagCacheServiceLive,
  type TagCacheSource,
} from "./TagCacheService.js";

export {
  type DocumentVector,
  QdrantError,
  QdrantService,
  QdrantServiceLive,
  type SearchResult,
} from "./QdrantService.js";
export {
  storeSchema,
  TinyBaseService,
  TinyBaseServiceLive,
} from "./TinyBaseService.js";
