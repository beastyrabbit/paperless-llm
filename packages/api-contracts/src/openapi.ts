import { JSONSchema, type Schema } from "effect";
import {
  AnalysisActionAcceptedSchema,
  AnalysisAvailableProposalProjectionSchema,
  AnalysisAvailableProposalSchema,
  AnalysisCancelBodySchema,
  AnalysisDecisionBodySchema,
  AnalysisExpiredProposalSchema,
  AnalysisFailureQueuePageSchema,
  AnalysisForceOcrBodySchema,
  AnalysisProposalApplyAcceptedSchema,
  AnalysisProposalApplyBodySchema,
  AnalysisProposalPageSchema,
  AnalysisRetryBodySchema,
  AnalysisReviewQueuePageSchema,
  AnalysisRunAcceptedSchema,
  AnalysisRunListQuerySchema,
  AnalysisRunPageSchema,
  AnalysisRunSchema,
  AnalysisRunStartBodySchema,
  AnalysisSseEventSchema,
  RandomCycleResetBodySchema,
  RandomCycleSelectAcceptedSchema,
  RandomCycleSelectBodySchema,
} from "./analysis-contracts.js";
import {
  ApplyJournalSchema,
  CatalogActionAcceptedSchema,
  CatalogApplyAcceptedSchema,
  CatalogApplyBodySchema,
  CatalogCancelBodySchema,
  CatalogCandidatePageSchema,
  CatalogCurrentHashSchema,
  CatalogEpochAcceptedSchema,
  CatalogEpochListQuerySchema,
  CatalogEpochPageSchema,
  CatalogEpochSchema,
  CatalogEpochStartBodySchema,
  CatalogProposalApplyProjectionSchema,
  CatalogProposalDecisionBodySchema,
  CatalogProposalDecisionProjectionSchema,
  CatalogProposalEvidenceAvailableSchema,
  CatalogProposalEvidenceExpiredSchema,
  CatalogProposalPageSchema,
  CatalogSseEventSchema,
  CompactChairDecisionLedgerContractSchema,
  CouncilEvidencePageSchema,
} from "./catalog-contracts.js";
import {
  ApiErrorSchema,
  ApiValidationIssueSchema,
  ProviderMalformedErrorSchema,
  StalePreconditionErrorSchema,
  TypedApiErrorSchema,
  UnavailableErrorSchema,
} from "./errors.js";
import { HealthResponseSchema } from "./health-schemas.js";
import {
  PaperlessBulkOperationRequestSchema,
  PaperlessCapabilityDescriptorSchema,
  PaperlessContentRefSchema,
  PaperlessDocumentPageSchema,
  PaperlessDocumentSnapshotSchema,
  PaperlessMutationRereadSchema,
  PaperlessNoteRefSchema,
  PaperlessTaskSchema,
} from "./paperless-capability-contract.js";
import {
  ApprovePendingBodySchema,
  BlockSuggestionBodySchema,
  BootstrapSkipBodySchema,
  BootstrapStartBodySchema,
  BulkIngestBodySchema,
  BulkOcrStartBodySchema,
  BulkPendingBodySchema,
  CaseAnswerBodySchema,
  CaseRunBodySchema,
  CatalogRunBodySchema,
  ChatBodySchema,
  CleanupApproveBodySchema,
  CleanupTagsBodySchema,
  CustomFieldBulkUpdateBodySchema,
  CustomFieldUpdateBodySchema,
  CatalogDecisionBodySchema as LegacyCatalogDecisionBodySchema,
  LockReleaseBodySchema,
  MergePendingBodySchema,
  PendingBlockedSuggestionBodySchema,
  ProcessingCancelBodySchema,
  ProcessingStartBodySchema,
  RejectPendingBodySchema,
  RejectWithFeedbackBodySchema,
  ScheduleUpdateBodySchema,
  SelectedFieldIdsBodySchema,
  SelectedTagIdsBodySchema,
  SelectedTypeIdsBodySchema,
  SettingsUpdateBodySchema,
  TagBulkUpdateBodySchema,
  TagOptimizeBodySchema,
  TagTranslateBodySchema,
  TagTranslationBodySchema,
  TagUpdateBodySchema,
  TranslateBodySchema,
  TranslationClearBodySchema,
  WorkflowTagsBodySchema,
} from "./request-schemas.js";
import { StorageArtifactEnvelopeSchema, StorageLedgerEntrySchema } from "./storage-contracts.js";
import {
  CodexChairStructuredOutputSchema,
  CodexDocumentStructuredOutputSchema,
  CodexReviewerStructuredOutputSchema,
} from "./structured-output-contracts.js";
import { SystemReadinessSchema } from "./system-contracts.js";

export const apiContractSchemas = {
  ApiValidationIssue: ApiValidationIssueSchema,
  ApiError: ApiErrorSchema,
  TypedApiError: TypedApiErrorSchema,
  StalePreconditionError: StalePreconditionErrorSchema,
  ProviderMalformedError: ProviderMalformedErrorSchema,
  UnavailableError: UnavailableErrorSchema,
  HealthResponse: HealthResponseSchema,
  SystemReadiness: SystemReadinessSchema,
  SettingsUpdateBody: SettingsUpdateBodySchema,
  WorkflowTagsBody: WorkflowTagsBodySchema,
  MergePendingBody: MergePendingBodySchema,
  BulkPendingBody: BulkPendingBodySchema,
  ApprovePendingBody: ApprovePendingBodySchema,
  RejectPendingBody: RejectPendingBodySchema,
  RejectWithFeedbackBody: RejectWithFeedbackBodySchema,
  CleanupApproveBody: CleanupApproveBodySchema,
  PendingBlockedSuggestionBody: PendingBlockedSuggestionBodySchema,
  BootstrapStartBody: BootstrapStartBodySchema,
  BootstrapSkipBody: BootstrapSkipBodySchema,
  BulkOcrStartBody: BulkOcrStartBodySchema,
  BulkIngestBody: BulkIngestBodySchema,
  ScheduleUpdateBody: ScheduleUpdateBodySchema,
  SelectedTypeIdsBody: SelectedTypeIdsBodySchema,
  SelectedFieldIdsBody: SelectedFieldIdsBodySchema,
  SelectedTagIdsBody: SelectedTagIdsBodySchema,
  CleanupTagsBody: CleanupTagsBodySchema,
  ProcessingStartBody: ProcessingStartBodySchema,
  ProcessingCancelBody: ProcessingCancelBodySchema,
  LockReleaseBody: LockReleaseBodySchema,
  CaseRunBody: CaseRunBodySchema,
  CaseAnswerBody: CaseAnswerBodySchema,
  CatalogRunBody: CatalogRunBodySchema,
  CatalogDecisionBody: LegacyCatalogDecisionBodySchema,
  TagUpdateBody: TagUpdateBodySchema,
  TagBulkUpdateBody: TagBulkUpdateBodySchema,
  TagTranslationBody: TagTranslationBodySchema,
  TagOptimizeBody: TagOptimizeBodySchema,
  TagTranslateBody: TagTranslateBodySchema,
  CustomFieldUpdateBody: CustomFieldUpdateBodySchema,
  CustomFieldBulkUpdateBody: CustomFieldBulkUpdateBodySchema,
  BlockSuggestionBody: BlockSuggestionBodySchema,
  TranslateBody: TranslateBodySchema,
  TranslationClearBody: TranslationClearBodySchema,
  ChatBody: ChatBodySchema,
  AnalysisRunStartBody: AnalysisRunStartBodySchema,
  AnalysisRunAccepted: AnalysisRunAcceptedSchema,
  AnalysisRun: AnalysisRunSchema,
  AnalysisRunListQuery: AnalysisRunListQuerySchema,
  AnalysisRunPage: AnalysisRunPageSchema,
  AnalysisAvailableProposal: AnalysisAvailableProposalSchema,
  AnalysisAvailableProposalProjection: AnalysisAvailableProposalProjectionSchema,
  AnalysisExpiredProposal: AnalysisExpiredProposalSchema,
  AnalysisProposalPage: AnalysisProposalPageSchema,
  AnalysisReviewQueuePage: AnalysisReviewQueuePageSchema,
  AnalysisFailureQueuePage: AnalysisFailureQueuePageSchema,
  AnalysisDecisionBody: AnalysisDecisionBodySchema,
  AnalysisRetryBody: AnalysisRetryBodySchema,
  AnalysisCancelBody: AnalysisCancelBodySchema,
  AnalysisForceOcrBody: AnalysisForceOcrBodySchema,
  AnalysisActionAccepted: AnalysisActionAcceptedSchema,
  AnalysisProposalApplyBody: AnalysisProposalApplyBodySchema,
  AnalysisProposalApplyAccepted: AnalysisProposalApplyAcceptedSchema,
  AnalysisSseEvent: AnalysisSseEventSchema,
  RandomCycleSelectBody: RandomCycleSelectBodySchema,
  RandomCycleResetBody: RandomCycleResetBodySchema,
  RandomCycleSelectAccepted: RandomCycleSelectAcceptedSchema,
  CatalogEpochStartBody: CatalogEpochStartBodySchema,
  CatalogEpochAccepted: CatalogEpochAcceptedSchema,
  CatalogEpoch: CatalogEpochSchema,
  CatalogEpochListQuery: CatalogEpochListQuerySchema,
  CatalogEpochPage: CatalogEpochPageSchema,
  CatalogCurrentHash: CatalogCurrentHashSchema,
  CatalogCandidatePage: CatalogCandidatePageSchema,
  CouncilEvidencePage: CouncilEvidencePageSchema,
  CompactChairDecisionLedgerContract: CompactChairDecisionLedgerContractSchema,
  CatalogProposalEvidenceAvailable: CatalogProposalEvidenceAvailableSchema,
  CatalogProposalEvidenceExpired: CatalogProposalEvidenceExpiredSchema,
  CatalogProposalDecisionProjection: CatalogProposalDecisionProjectionSchema,
  CatalogProposalApplyProjection: CatalogProposalApplyProjectionSchema,
  CatalogProposalPage: CatalogProposalPageSchema,
  CatalogProposalDecisionBody: CatalogProposalDecisionBodySchema,
  CatalogCancelBody: CatalogCancelBodySchema,
  CatalogApplyBody: CatalogApplyBodySchema,
  CatalogActionAccepted: CatalogActionAcceptedSchema,
  CatalogApplyAccepted: CatalogApplyAcceptedSchema,
  ApplyJournal: ApplyJournalSchema,
  CatalogSseEvent: CatalogSseEventSchema,
  StorageArtifactEnvelope: StorageArtifactEnvelopeSchema,
  StorageLedgerEntry: StorageLedgerEntrySchema,
  PaperlessCapabilityDescriptor: PaperlessCapabilityDescriptorSchema,
  PaperlessDocumentSnapshot: PaperlessDocumentSnapshotSchema,
  PaperlessDocumentPage: PaperlessDocumentPageSchema,
  PaperlessContentRef: PaperlessContentRefSchema,
  PaperlessBulkOperationRequest: PaperlessBulkOperationRequestSchema,
  PaperlessTask: PaperlessTaskSchema,
  PaperlessNoteRef: PaperlessNoteRefSchema,
  PaperlessMutationReread: PaperlessMutationRereadSchema,
  CodexDocumentStructuredOutput: CodexDocumentStructuredOutputSchema,
  CodexReviewerStructuredOutput: CodexReviewerStructuredOutputSchema,
  CodexChairStructuredOutput: CodexChairStructuredOutputSchema,
} as const;

export type ApiContractSchemaName = keyof typeof apiContractSchemas;
export type OpenApiHttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

export interface ApiRouteParameter {
  name: string;
  in: "path" | "query";
  required?: boolean;
  schema: Record<string, unknown>;
  description?: string;
}

export interface ApiRouteContract {
  method: OpenApiHttpMethod;
  path: string;
  requestBody?: ApiContractSchemaName;
  responseBody?: ApiContractSchemaName;
  response?: string;
  successStatus?: 200 | 202;
  responseContentType?: "application/json" | "text/event-stream";
  additionalResponses?: Record<
    number,
    { description: string; responseBody?: ApiContractSchemaName }
  >;
  summary?: string;
  tags?: string[];
  operationId?: string;
  queryParameters?: ApiRouteParameter[];
}

const paperlessFirstErrorResponses = {
  409: {
    description: "Stale hash precondition or conflicting compare-and-set state transition",
    responseBody: "StalePreconditionError",
  },
  502: {
    description: "Provider returned malformed structured output or failed after retries",
    responseBody: "ProviderMalformedError",
  },
  503: {
    description: "Paperless, storage, or provider dependency unavailable",
    responseBody: "UnavailableError",
  },
} as const satisfies ApiRouteContract["additionalResponses"];

export const apiRouteContracts: ApiRouteContract[] = [
  { method: "GET", path: "/", summary: "Backend service metadata", tags: ["system"] },
  {
    method: "GET",
    path: "/health",
    summary: "Backend dependency health status",
    tags: ["system"],
    response: "All required dependencies are reachable",
    responseBody: "HealthResponse",
    additionalResponses: {
      503: {
        description: "One or more required dependencies are unavailable",
        responseBody: "HealthResponse",
      },
    },
  },
  {
    method: "GET",
    path: "/api/system/readiness",
    summary: "Describe Paperless-first runtime and local tool readiness",
    tags: ["system"],
    responseBody: "SystemReadiness",
  },
  { method: "GET", path: "/openapi.json", summary: "Generated OpenAPI document", tags: ["system"] },
  { method: "GET", path: "/api/settings", summary: "Get settings", tags: ["settings"] },
  {
    method: "PATCH",
    path: "/api/settings",
    requestBody: "SettingsUpdateBody",
    summary: "Update settings",
    tags: ["settings"],
  },
  {
    method: "POST",
    path: "/api/settings/test-connection/{service}",
    summary: "Create or run settings test connection service",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/ollama/models",
    summary: "Get settings ollama models",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/ollama/status",
    summary: "Get settings ollama status",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/mistral/models",
    summary: "Get settings mistral models",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/openai-codex/models",
    summary: "Get settings openai codex models",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/tags/status",
    summary: "Get settings tags status",
    tags: ["settings"],
  },
  {
    method: "POST",
    path: "/api/settings/tags/create",
    requestBody: "WorkflowTagsBody",
    summary: "Create or run settings tags create",
    tags: ["settings"],
  },
  {
    method: "POST",
    path: "/api/settings/tags/fix-colors",
    summary: "Create or run settings tags fix colors",
    tags: ["settings"],
  },
  {
    method: "POST",
    path: "/api/settings/import-config",
    summary: "Create or run settings import config",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/check-import",
    summary: "Get settings check import",
    tags: ["settings"],
  },
  {
    method: "POST",
    path: "/api/settings/clear-database",
    summary: "Create or run settings clear database",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/processing-logs/stats",
    summary: "Get settings processing logs stats",
    tags: ["settings"],
  },
  {
    method: "DELETE",
    path: "/api/settings/processing-logs",
    summary: "Delete settings processing logs",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/pending",
    summary: "Get pending",
    tags: ["pending"],
    queryParameters: [
      {
        name: "type",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter pending items by suggestion type",
      },
    ],
  },
  { method: "GET", path: "/api/pending/counts", summary: "Get pending counts", tags: ["pending"] },
  {
    method: "GET",
    path: "/api/pending/similar",
    summary: "Get pending similar",
    tags: ["pending"],
  },
  {
    method: "GET",
    path: "/api/pending/search-entities",
    summary: "Get pending search entities",
    tags: ["pending"],
  },
  {
    method: "GET",
    path: "/api/pending/blocked",
    summary: "Get pending blocked",
    tags: ["pending"],
  },
  {
    method: "POST",
    path: "/api/pending/merge",
    requestBody: "MergePendingBody",
    summary: "Create or run pending merge",
    tags: ["pending"],
  },
  {
    method: "POST",
    path: "/api/pending/bulk",
    requestBody: "BulkPendingBody",
    summary: "Create or run pending bulk",
    tags: ["pending"],
  },
  { method: "GET", path: "/api/pending/{id}", summary: "Get pending id", tags: ["pending"] },
  {
    method: "POST",
    path: "/api/pending/{id}/approve",
    requestBody: "ApprovePendingBody",
    summary: "Create or run pending id approve",
    tags: ["pending"],
  },
  {
    method: "POST",
    path: "/api/pending/{id}/reject",
    requestBody: "RejectPendingBody",
    summary: "Create or run pending id reject",
    tags: ["pending"],
  },
  {
    method: "POST",
    path: "/api/pending/{id}/reject-with-feedback",
    requestBody: "RejectWithFeedbackBody",
    summary: "Create or run pending id reject with feedback",
    tags: ["pending"],
  },
  {
    method: "POST",
    path: "/api/pending/{id}/approve-cleanup",
    requestBody: "CleanupApproveBody",
    summary: "Create or run pending id approve cleanup",
    tags: ["pending"],
  },
  {
    method: "DELETE",
    path: "/api/pending/blocked/{blockId}",
    summary: "Delete pending blocked blockId",
    tags: ["pending"],
  },
  {
    method: "POST",
    path: "/api/pending/blocked",
    requestBody: "PendingBlockedSuggestionBody",
    summary: "Create or run pending blocked",
    tags: ["pending"],
  },
  { method: "GET", path: "/api/jobs/status", summary: "Get jobs status", tags: ["jobs"] },
  {
    method: "GET",
    path: "/api/jobs/status/{jobName}",
    summary: "Get jobs status jobName",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bootstrap/start",
    requestBody: "BootstrapStartBody",
    summary: "Create or run jobs bootstrap start",
    tags: ["jobs"],
  },
  {
    method: "GET",
    path: "/api/jobs/bootstrap/status",
    summary: "Get jobs bootstrap status",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bootstrap/cancel",
    summary: "Create or run jobs bootstrap cancel",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bootstrap/skip",
    requestBody: "BootstrapSkipBody",
    summary: "Create or run jobs bootstrap skip",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/schema-cleanup/run",
    summary: "Create or run jobs schema cleanup run",
    tags: ["jobs"],
  },
  {
    method: "GET",
    path: "/api/jobs/schema-cleanup/status",
    summary: "Get jobs schema cleanup status",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bulk-ocr/start",
    requestBody: "BulkOcrStartBody",
    summary: "Create or run jobs bulk ocr start",
    tags: ["jobs"],
  },
  {
    method: "GET",
    path: "/api/jobs/bulk-ocr/status",
    summary: "Get jobs bulk ocr status",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bulk-ocr/cancel",
    summary: "Create or run jobs bulk ocr cancel",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bulk-ingest/start",
    requestBody: "BulkIngestBody",
    summary: "Create or run jobs bulk ingest start",
    tags: ["jobs"],
  },
  {
    method: "GET",
    path: "/api/jobs/bulk-ingest/status",
    summary: "Get jobs bulk ingest status",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/bulk-ingest/cancel",
    summary: "Create or run jobs bulk ingest cancel",
    tags: ["jobs"],
  },
  {
    method: "POST",
    path: "/api/jobs/metadata-enhancement/run",
    summary: "Create or run jobs metadata enhancement run",
    tags: ["jobs"],
  },
  { method: "GET", path: "/api/jobs/schedule", summary: "Get jobs schedule", tags: ["jobs"] },
  {
    method: "PATCH",
    path: "/api/jobs/schedule",
    requestBody: "ScheduleUpdateBody",
    summary: "Update jobs schedule",
    tags: ["jobs"],
  },
  {
    method: "GET",
    path: "/api/settings/ai-document-types",
    summary: "Get settings ai document types",
    tags: ["settings"],
  },
  {
    method: "PATCH",
    path: "/api/settings/ai-document-types",
    requestBody: "SelectedTypeIdsBody",
    summary: "Update settings ai document types",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/custom-fields",
    summary: "Get settings custom fields",
    tags: ["settings"],
  },
  {
    method: "PATCH",
    path: "/api/settings/custom-fields",
    requestBody: "SelectedFieldIdsBody",
    summary: "Update settings custom fields",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/settings/ai-tags",
    summary: "Get settings ai tags",
    tags: ["settings"],
  },
  {
    method: "PATCH",
    path: "/api/settings/ai-tags",
    requestBody: "SelectedTagIdsBody",
    summary: "Update settings ai tags",
    tags: ["settings"],
  },
  {
    method: "GET",
    path: "/api/documents/queue",
    summary: "Get documents queue",
    tags: ["documents"],
  },
  {
    method: "GET",
    path: "/api/documents",
    summary: "List current Paperless documents",
    tags: ["documents"],
    queryParameters: [
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "GET",
    path: "/api/documents/pending",
    summary: "Get documents pending",
    tags: ["documents"],
    queryParameters: [
      {
        name: "tag",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter pending documents by tag name",
      },
    ],
  },
  { method: "GET", path: "/api/documents/{id}", summary: "Get documents id", tags: ["documents"] },
  {
    method: "GET",
    path: "/api/documents/{id}/content",
    summary: "Get documents id content",
    tags: ["documents"],
  },
  {
    method: "GET",
    path: "/api/documents/{id}/pdf",
    summary: "Get documents id pdf",
    tags: ["documents"],
  },
  {
    method: "GET",
    path: "/api/paperless/capabilities",
    summary: "Describe required Paperless integration capabilities",
    tags: ["paperless"],
    responseBody: "PaperlessCapabilityDescriptor",
  },
  {
    method: "GET",
    path: "/api/paperless/documents",
    summary: "List Paperless document snapshots with full cursor pagination",
    tags: ["paperless"],
    responseBody: "PaperlessDocumentPage",
    queryParameters: [
      {
        name: "cursor",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Opaque pagination cursor",
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
        description: "Maximum documents to return",
      },
    ],
  },
  {
    method: "GET",
    path: "/api/paperless/documents/{docId}/snapshot",
    summary: "Reread a Paperless document state snapshot after mutations",
    tags: ["paperless"],
    responseBody: "PaperlessDocumentSnapshot",
  },
  {
    method: "GET",
    path: "/api/paperless/documents/{docId}/original",
    summary: "Fetch content-addressed original document content reference",
    tags: ["paperless"],
    responseBody: "PaperlessContentRef",
  },
  {
    method: "GET",
    path: "/api/paperless/documents/{docId}/versions/{versionId}/content",
    summary: "Fetch content-addressed version document content reference",
    tags: ["paperless"],
    responseBody: "PaperlessContentRef",
  },
  {
    method: "POST",
    path: "/api/paperless/bulk-operations",
    requestBody: "PaperlessBulkOperationRequest",
    responseBody: "PaperlessTask",
    successStatus: 202,
    summary: "Submit a conditional Paperless bulk operation",
    tags: ["paperless"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/paperless/tasks/{taskId}",
    summary: "Poll a Paperless task",
    tags: ["paperless"],
    responseBody: "PaperlessTask",
  },
  {
    method: "GET",
    path: "/api/paperless/documents/{docId}/notes/{noteId}",
    summary: "Fetch content-addressed Paperless note reference",
    tags: ["paperless"],
    responseBody: "PaperlessNoteRef",
  },
  {
    method: "POST",
    path: "/api/documents/{id}/cleanup-tags",
    requestBody: "CleanupTagsBody",
    summary: "Create or run documents id cleanup tags",
    tags: ["documents"],
  },
  {
    method: "POST",
    path: "/api/processing/{docId}/start",
    requestBody: "ProcessingStartBody",
    summary: "Create or run processing docId start",
    tags: ["processing"],
  },
  {
    method: "POST",
    path: "/api/processing/{docId}/confirm",
    summary: "Create or run processing docId confirm",
    tags: ["processing"],
  },
  {
    method: "POST",
    path: "/api/processing/{docId}/cancel",
    requestBody: "ProcessingCancelBody",
    summary: "Cancel an active document processing run",
    tags: ["processing"],
  },
  {
    method: "POST",
    path: "/api/processing/{docId}/release-lock",
    requestBody: "LockReleaseBody",
    summary: "Release a document processing lock",
    tags: ["processing"],
  },
  {
    method: "GET",
    path: "/api/processing/locks",
    summary: "List durable processing locks",
    tags: ["processing"],
  },
  {
    method: "POST",
    path: "/api/processing/locks/prune",
    summary: "Prune stale processing locks",
    tags: ["processing"],
  },
  {
    method: "GET",
    path: "/api/processing/status",
    summary: "Get processing status",
    tags: ["processing"],
  },
  {
    method: "GET",
    path: "/api/processing/{docId}/logs",
    summary: "Get processing docId logs",
    tags: ["processing"],
  },
  {
    method: "DELETE",
    path: "/api/processing/{docId}/logs",
    summary: "Delete processing docId logs",
    tags: ["processing"],
  },
  {
    method: "GET",
    path: "/api/processing/auto/status",
    summary: "Get processing auto status",
    tags: ["processing"],
  },
  {
    method: "POST",
    path: "/api/processing/auto/trigger",
    summary: "Create or run processing auto trigger",
    tags: ["processing"],
  },
  {
    method: "POST",
    path: "/api/analysis/runs",
    requestBody: "AnalysisRunStartBody",
    responseBody: "AnalysisRunAccepted",
    successStatus: 202,
    summary: "Start a Paperless-first document analysis run",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/analysis/runs",
    responseBody: "AnalysisRunPage",
    summary: "List document analysis runs",
    tags: ["analysis"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
      { name: "state", in: "query", required: false, schema: { type: "string" } },
      { name: "documentId", in: "query", required: false, schema: { type: "integer", minimum: 1 } },
    ],
  },
  {
    method: "GET",
    path: "/api/analysis/runs/{runId}",
    responseBody: "AnalysisRun",
    summary: "Get a document analysis run",
    tags: ["analysis"],
  },
  {
    method: "GET",
    path: "/api/analysis/runs/{runId}/progress",
    responseBody: "AnalysisSseEvent",
    responseContentType: "text/event-stream",
    summary: "Stream document analysis run progress",
    tags: ["analysis"],
  },
  {
    method: "GET",
    path: "/api/analysis/runs/{runId}/proposals",
    responseBody: "AnalysisProposalPage",
    summary: "List proposals for a document analysis run",
    tags: ["analysis"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "POST",
    path: "/api/analysis/runs/{runId}/apply",
    requestBody: "AnalysisProposalApplyBody",
    responseBody: "AnalysisProposalApplyAccepted",
    successStatus: 202,
    summary: "Apply the whole-bundle analysis proposal",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/analysis/runs/{runId}/reject",
    requestBody: "AnalysisDecisionBody",
    responseBody: "AnalysisActionAccepted",
    successStatus: 202,
    summary: "Reject a whole-bundle analysis proposal",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/analysis/runs/{runId}/retry",
    requestBody: "AnalysisRetryBody",
    responseBody: "AnalysisActionAccepted",
    successStatus: 202,
    summary: "Retry a document analysis run",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/analysis/runs/{runId}/cancel",
    requestBody: "AnalysisCancelBody",
    responseBody: "AnalysisActionAccepted",
    successStatus: 202,
    summary: "Cancel a document analysis run",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/analysis/runs/{runId}/force-ocr",
    requestBody: "AnalysisForceOcrBody",
    responseBody: "AnalysisActionAccepted",
    successStatus: 202,
    summary: "Request forced OCR for a document analysis run",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/analysis/review",
    responseBody: "AnalysisReviewQueuePage",
    summary: "List analysis proposals waiting for review",
    tags: ["analysis"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "GET",
    path: "/api/analysis/failed",
    responseBody: "AnalysisFailureQueuePage",
    summary: "List failed analysis runs",
    tags: ["analysis"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "POST",
    path: "/api/analysis/random-cycle/select",
    requestBody: "RandomCycleSelectBody",
    responseBody: "RandomCycleSelectAccepted",
    successStatus: 202,
    summary: "Select a document from a random analysis cycle",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/analysis/random-cycle/reset",
    requestBody: "RandomCycleResetBody",
    responseBody: "AnalysisActionAccepted",
    successStatus: 202,
    summary: "Reset a random analysis cycle",
    tags: ["analysis"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/cases",
    summary: "Get cases",
    tags: ["cases"],
    queryParameters: [
      {
        name: "status",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter cases by status",
      },
    ],
  },
  {
    method: "GET",
    path: "/api/cases/document/{docId}",
    summary: "Get cases document docId",
    tags: ["cases"],
  },
  {
    method: "POST",
    path: "/api/cases/document/{docId}/run",
    requestBody: "CaseRunBody",
    summary: "Create or run cases document docId run",
    tags: ["cases"],
  },
  {
    method: "GET",
    path: "/api/cases/document/{docId}/logs",
    summary: "Get cases document docId logs",
    tags: ["cases"],
  },
  {
    method: "POST",
    path: "/api/cases/questions/{questionId}/answer",
    requestBody: "CaseAnswerBody",
    summary: "Create or run cases questions questionId answer",
    tags: ["cases"],
  },
  { method: "GET", path: "/api/cases/{caseId}", summary: "Get cases caseId", tags: ["cases"] },
  {
    method: "POST",
    path: "/api/catalog/runs",
    requestBody: "CatalogRunBody",
    summary: "Create or run catalog runs",
    tags: ["catalog"],
  },
  {
    method: "POST",
    path: "/api/catalog/epochs",
    requestBody: "CatalogEpochStartBody",
    responseBody: "CatalogEpochAccepted",
    successStatus: 202,
    summary: "Start a Paperless catalog epoch",
    tags: ["catalog"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/catalog/epochs",
    responseBody: "CatalogEpochPage",
    summary: "List Paperless catalog epochs",
    tags: ["catalog"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
      { name: "state", in: "query", required: false, schema: { type: "string" } },
      { name: "kind", in: "query", required: false, schema: { type: "string" } },
    ],
  },
  {
    method: "GET",
    path: "/api/catalog/current-hash",
    responseBody: "CatalogCurrentHash",
    summary: "Observe the current Paperless catalog precondition hash (first-run epoch start)",
    tags: ["catalog"],
    queryParameters: [
      { name: "kind", in: "query", required: true, schema: { type: "string" } },
    ],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/catalog/epochs/{epochId}",
    responseBody: "CatalogEpoch",
    summary: "Get a Paperless catalog epoch",
    tags: ["catalog"],
  },
  {
    method: "POST",
    path: "/api/catalog/epochs/{epochId}/cancel",
    requestBody: "CatalogCancelBody",
    responseBody: "CatalogActionAccepted",
    successStatus: 202,
    summary: "Cancel a Paperless catalog epoch",
    tags: ["catalog"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/catalog/epochs/{epochId}/events",
    responseBody: "CatalogSseEvent",
    responseContentType: "text/event-stream",
    summary: "Stream catalog epoch events",
    tags: ["catalog"],
  },
  {
    method: "GET",
    path: "/api/catalog/epochs/{epochId}/candidates",
    responseBody: "CatalogCandidatePage",
    summary: "List catalog candidates for an epoch",
    tags: ["catalog"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "GET",
    path: "/api/catalog/epochs/{epochId}/evidence",
    responseBody: "CouncilEvidencePage",
    summary: "List council evidence for a catalog epoch",
    tags: ["catalog"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "GET",
    path: "/api/catalog/epochs/{epochId}/proposals",
    responseBody: "CatalogProposalPage",
    summary: "List catalog proposals for an epoch",
    tags: ["catalog"],
    queryParameters: [
      { name: "cursor", in: "query", required: false, schema: { type: "string" } },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer", minimum: 1, maximum: 250 },
      },
    ],
  },
  {
    method: "POST",
    path: "/api/catalog/proposals/{proposalId}/approve",
    requestBody: "CatalogProposalDecisionBody",
    responseBody: "CatalogActionAccepted",
    successStatus: 202,
    summary: "Approve a catalog proposal",
    tags: ["catalog"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/catalog/proposals/{proposalId}/reject",
    requestBody: "CatalogProposalDecisionBody",
    responseBody: "CatalogActionAccepted",
    successStatus: 202,
    summary: "Reject a catalog proposal",
    tags: ["catalog"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "POST",
    path: "/api/catalog/proposals/{proposalId}/apply",
    requestBody: "CatalogApplyBody",
    responseBody: "CatalogApplyAccepted",
    successStatus: 202,
    summary: "Apply an approved catalog proposal",
    tags: ["catalog"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/catalog/proposals/{proposalId}/apply-journal",
    responseBody: "ApplyJournal",
    summary: "Get the apply journal for a catalog proposal",
    tags: ["catalog"],
  },
  { method: "GET", path: "/api/catalog/runs", summary: "Get catalog runs", tags: ["catalog"] },
  {
    method: "GET",
    path: "/api/catalog/runs/{runId}",
    summary: "Get catalog runs runId",
    tags: ["catalog"],
  },
  {
    method: "GET",
    path: "/api/catalog/proposals",
    summary: "Get catalog proposals",
    tags: ["catalog"],
    queryParameters: [
      {
        name: "run_id",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter proposals by catalog run id",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/catalog/proposals/{proposalId}/decision",
    requestBody: "CatalogDecisionBody",
    summary: "Create or run catalog proposals proposalId decision",
    tags: ["catalog"],
  },
  {
    method: "POST",
    path: "/api/catalog/proposals/{proposalId}/apply",
    requestBody: "CatalogApplyBody",
    responseBody: "CatalogApplyAccepted",
    successStatus: 202,
    summary: "Apply an approved catalog proposal",
    tags: ["catalog"],
    additionalResponses: paperlessFirstErrorResponses,
  },
  {
    method: "GET",
    path: "/api/catalog/logs",
    summary: "Get catalog logs",
    tags: ["catalog"],
    queryParameters: [
      {
        name: "run_id",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter logs by catalog run id",
      },
    ],
  },
  { method: "GET", path: "/api/metadata/tags", summary: "Get metadata tags", tags: ["metadata"] },
  {
    method: "GET",
    path: "/api/metadata/tags/{tagId}",
    summary: "Get metadata tags tagId",
    tags: ["metadata"],
  },
  {
    method: "PUT",
    path: "/api/metadata/tags/{tagId}",
    requestBody: "TagUpdateBody",
    summary: "Replace metadata tags tagId",
    tags: ["metadata"],
  },
  {
    method: "DELETE",
    path: "/api/metadata/tags/{tagId}",
    summary: "Delete metadata tags tagId",
    tags: ["metadata"],
  },
  {
    method: "POST",
    path: "/api/metadata/tags/bulk",
    requestBody: "TagBulkUpdateBody",
    summary: "Create or run metadata tags bulk",
    tags: ["metadata"],
  },
  {
    method: "GET",
    path: "/api/metadata/tags/{tagId}/translations",
    summary: "Get metadata tags tagId translations",
    tags: ["metadata"],
  },
  {
    method: "PUT",
    path: "/api/metadata/tags/{tagId}/translations/{lang}",
    requestBody: "TagTranslationBody",
    summary: "Replace metadata tags tagId translations lang",
    tags: ["metadata"],
  },
  {
    method: "POST",
    path: "/api/metadata/tags/{tagId}/optimize-description",
    requestBody: "TagOptimizeBody",
    summary: "Create or run metadata tags tagId optimize description",
    tags: ["metadata"],
  },
  {
    method: "POST",
    path: "/api/metadata/tags/{tagId}/translate-description",
    requestBody: "TagTranslateBody",
    summary: "Create or run metadata tags tagId translate description",
    tags: ["metadata"],
  },
  {
    method: "GET",
    path: "/api/metadata/custom-fields",
    summary: "Get metadata custom fields",
    tags: ["metadata"],
  },
  {
    method: "GET",
    path: "/api/metadata/custom-fields/{fieldId}",
    summary: "Get metadata custom fields fieldId",
    tags: ["metadata"],
  },
  {
    method: "PUT",
    path: "/api/metadata/custom-fields/{fieldId}",
    requestBody: "CustomFieldUpdateBody",
    summary: "Replace metadata custom fields fieldId",
    tags: ["metadata"],
  },
  {
    method: "DELETE",
    path: "/api/metadata/custom-fields/{fieldId}",
    summary: "Delete metadata custom fields fieldId",
    tags: ["metadata"],
  },
  {
    method: "POST",
    path: "/api/metadata/custom-fields/bulk",
    requestBody: "CustomFieldBulkUpdateBody",
    summary: "Create or run metadata custom fields bulk",
    tags: ["metadata"],
  },
  {
    method: "GET",
    path: "/api/schema/blocked",
    summary: "Get schema blocked",
    tags: ["schema"],
    queryParameters: [
      {
        name: "block_type",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Filter blocked suggestions by type",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/schema/blocked",
    requestBody: "BlockSuggestionBody",
    summary: "Create or run schema blocked",
    tags: ["schema"],
  },
  {
    method: "DELETE",
    path: "/api/schema/blocked/{id}",
    summary: "Delete schema blocked id",
    tags: ["schema"],
  },
  {
    method: "GET",
    path: "/api/schema/blocked/check",
    summary: "Get schema blocked check",
    tags: ["schema"],
    queryParameters: [
      {
        name: "name",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Suggestion name to check",
      },
      {
        name: "block_type",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Suggestion block type",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/translation/translate",
    requestBody: "TranslateBody",
    summary: "Create or run translation translate",
    tags: ["translation"],
  },
  {
    method: "GET",
    path: "/api/translation/translations/{targetLang}",
    summary: "Get translation translations targetLang",
    tags: ["translation"],
  },
  {
    method: "POST",
    path: "/api/translation/cache/clear",
    requestBody: "TranslationClearBody",
    summary: "Create or run translation cache clear",
    tags: ["translation"],
  },
  {
    method: "GET",
    path: "/api/translation/languages",
    summary: "Get translation languages",
    tags: ["translation"],
  },
  {
    method: "GET",
    path: "/api/search",
    summary: "Get search",
    tags: ["search"],
    queryParameters: [
      {
        name: "q",
        in: "query",
        required: false,
        schema: { type: "string" },
        description: "Search query",
      },
      {
        name: "limit",
        in: "query",
        required: false,
        schema: { type: "integer" },
        description: "Maximum number of results (1-100)",
      },
    ],
  },
  {
    method: "POST",
    path: "/api/search/index/{docId}",
    summary: "Create or run search index docId",
    tags: ["search"],
  },
  {
    method: "POST",
    path: "/api/chat",
    requestBody: "ChatBody",
    summary: "Create or run chat",
    tags: ["chat"],
  },
  {
    method: "GET",
    path: "/api/docs",
    summary: "Development API documentation UI",
    tags: ["system"],
  },
  {
    method: "GET",
    path: "/api/processing/{docId}/stream",
    summary: "Get processing docId stream",
    tags: ["processing"],
  },
  {
    method: "GET",
    path: "/api/cases/document/{docId}/stream",
    summary: "Get cases document docId stream",
    tags: ["cases"],
  },
  {
    method: "GET",
    path: "/api/catalog/runs/{runId}/stream",
    summary: "Get catalog runs runId stream",
    tags: ["catalog"],
  },
];

export const toOpenApiSchema = (schema: Schema.Schema.Any) =>
  JSONSchema.make(schema, { target: "openApi3.1" });

export const apiContractJsonSchemas = () =>
  Object.fromEntries(
    Object.entries(apiContractSchemas).map(([name, schema]) => [name, toOpenApiSchema(schema)]),
  ) as Record<ApiContractSchemaName, ReturnType<typeof toOpenApiSchema>>;

const pathParameterPattern = /\{([^}]+)\}/g;

const positiveSafeIntegerParameterSchema = {
  type: "integer",
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
};

const numericPathParameterNames = new Set(["docId", "tagId", "fieldId", "blockId"]);

const pathParameterSchema = (path: string, name: string): Record<string, unknown> => {
  if (numericPathParameterNames.has(name)) return positiveSafeIntegerParameterSchema;
  if (
    name === "id" &&
    (path.startsWith("/api/documents/{id}") || path === "/api/schema/blocked/{id}")
  ) {
    return positiveSafeIntegerParameterSchema;
  }
  return { type: "string" };
};

const pathParameters = (path: string): ApiRouteParameter[] =>
  [...path.matchAll(pathParameterPattern)].map((match) => {
    const name = match[1] ?? "id";
    return {
      name,
      in: "path",
      required: true,
      schema: pathParameterSchema(path, name),
    };
  });

const operationIdForRoute = (route: ApiRouteContract) =>
  `${route.method.toLowerCase()}${
    route.path
      .split("/")
      .filter(Boolean)
      .map((segment) => segment.replace(/[{}]/g, ""))
      .map((segment) =>
        segment.replace(/[^a-zA-Z0-9]+(.)/g, (_, char: string) => char.toUpperCase()),
      )
      .map((segment) => segment.charAt(0).toUpperCase() + segment.slice(1))
      .join("") || "Root"
  }`;

export interface GenerateOpenApiDocumentOptions {
  title?: string;
  version?: string;
  description?: string;
}

export const generateOpenApiDocument = (options: GenerateOpenApiDocumentOptions = {}) => {
  const schemas = apiContractJsonSchemas();
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of apiRouteContracts) {
    const responseSchema = route.responseBody
      ? { $ref: `#/components/schemas/${route.responseBody}` }
      : {};
    const successStatus = route.successStatus ?? 200;
    const responseContentType = route.responseContentType ?? "application/json";
    const responses: Record<number, unknown> = {
      [successStatus]: {
        description: route.response ?? "Successful response",
        content: { [responseContentType]: { schema: responseSchema } },
      },
      400: {
        description: "Validation error",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
      },
      404: {
        description: "Not found",
        content: { "application/json": { schema: { $ref: "#/components/schemas/ApiError" } } },
      },
    };

    for (const [status, additionalResponse] of Object.entries(route.additionalResponses ?? {})) {
      responses[Number(status)] = {
        description: additionalResponse.description,
        content: {
          "application/json": {
            schema: additionalResponse.responseBody
              ? { $ref: `#/components/schemas/${additionalResponse.responseBody}` }
              : {},
          },
        },
      };
    }

    const operation: Record<string, unknown> = {
      tags: route.tags,
      summary: route.summary,
      operationId: route.operationId ?? operationIdForRoute(route),
      parameters: [...pathParameters(route.path), ...(route.queryParameters ?? [])],
      responses,
    };

    if (route.requestBody) {
      operation.requestBody = {
        required: true,
        content: {
          "application/json": {
            schema: { $ref: `#/components/schemas/${route.requestBody}` },
          },
        },
      };
    }

    paths[route.path] = {
      ...(paths[route.path] ?? {}),
      [route.method.toLowerCase()]: operation,
    };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: options.title ?? "Paperless Local LLM API",
      version: options.version ?? "0.1.0",
      description:
        options.description ??
        "Generated from shared @repo/api-contracts route metadata and Effect schemas.",
    },
    paths,
    components: {
      schemas,
    },
  };
};
