/**
 * API client barrel export
 *
 * Usage:
 *   import { settingsApi, documentsApi, ... } from "@/lib/api";
 *   import type { Settings, DocumentDetail, ... } from "@/lib/api";
 */

// Re-export all API clients
export { settingsApi } from "./settings";
export { documentsApi } from "./documents";
export { processingApi } from "./processing";
export { promptsApi } from "./prompts";
export { pendingApi } from "./pending";
export { metadataApi } from "./metadata";
export { schemaApi } from "./schema";
export { jobsApi } from "./jobs";
export { translationApi } from "./translation";

// Re-export client utilities
export { fetchApi, API_BASE } from "./client";
export type { ApiResponse } from "./client";

// Re-export all types
export type {
  // Settings
  Settings,
  ConnectionTest,
  // Documents
  QueueStats,
  DocumentSummary,
  DocumentDetail,
  // Processing
  ProcessingStatus,
  // Prompts
  PromptInfo,
  PromptGroup,
  PreviewData,
  LanguageInfo,
  AvailableLanguagesResponse,
  // Pending Reviews
  PendingItemType,
  SchemaItemType,
  AllPendingItemType,
  PendingItem,
  SchemaCleanupType,
  SchemaEntityType,
  SchemaCleanupMetadata,
  SchemaCleanupApproveResponse,
  PendingCounts,
  SearchableEntities,
  SimilarGroup,
  SimilarGroupsResponse,
  MergePendingResponse,
  BlockedItem,
  BlockedItemsResponse,
  PendingApproveResponse,
  // Metadata
  TagMetadata,
  TagMetadataUpdate,
  TagMetadataBulk,
  CustomFieldMetadata,
  CustomFieldMetadataUpdate,
  CustomFieldMetadataBulk,
  DocumentTypeInfo,
  AiDocumentTypesResponse,
  // Translation
  TranslateRequest,
  TranslateResponse,
  TranslatePromptsResponse,
  TranslationEntry,
  // Blocked Suggestions
  BlockType,
  RejectionCategory,
  BlockedSuggestion,
  BlockSuggestionRequest,
  // Jobs
  JobStatusType,
  JobStatus,
  // Reject with Feedback
  RejectBlockType,
  RejectWithFeedbackRequest,
  RejectWithFeedbackResponse,
  // Bootstrap Analysis
  BootstrapAnalysisType,
  BootstrapStatusType,
  SuggestionsByType,
  BootstrapProgress,
  BootstrapStartResponse,
  // Job Schedules
  ScheduleType,
  JobScheduleInfo,
  JobScheduleStatus,
  ScheduleUpdateRequest,
  ScheduleUpdateResponse,
  // Bulk OCR
  BulkOCRStatusType,
  BulkOCRProgress,
  BulkOCRStartResponse,
} from "./types";
