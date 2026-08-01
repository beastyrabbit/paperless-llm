/**
 * API router - maps HTTP requests to handlers.
 */

import type { IncomingMessage, ServerResponse } from "node:http";
import {
  ApprovePendingBodySchema,
  BlockedSuggestionIdFromStringSchema,
  BlockSuggestionBodySchema,
  BootstrapSkipBodySchema,
  BootstrapStartBodySchema,
  BulkIngestBodySchema,
  BulkOcrStartBodySchema,
  BulkPendingBodySchema,
  CaseAnswerBodySchema,
  CaseRunBodySchema,
  CatalogDecisionBodySchema,
  CatalogRunBodySchema,
  ChatBodySchema,
  CleanupApproveBodySchema,
  CleanupTagsBodySchema,
  CustomFieldBulkUpdateBodySchema,
  CustomFieldIdFromStringSchema,
  CustomFieldUpdateBodySchema,
  DocumentIdFromStringSchema,
  generateOpenApiDocument,
  LockReleaseBodySchema,
  MergePendingBodySchema,
  PendingBlockedSuggestionBodySchema,
  ProcessingCancelBodySchema,
  ProcessingStartBodySchema,
  RejectPendingBodySchema,
  RejectWithFeedbackBodySchema,
  ScheduleUpdateBodySchema,
  SearchQuerySchema,
  SelectedFieldIdsBodySchema,
  SelectedTagIdsBodySchema,
  SelectedTypeIdsBodySchema,
  SettingsUpdateBodySchema,
  TagBulkUpdateBodySchema,
  TagIdFromStringSchema,
  TagOptimizeBodySchema,
  TagTranslateBodySchema,
  TagTranslationBodySchema,
  TagUpdateBodySchema,
  TranslateBodySchema,
  TranslationClearBodySchema,
  WorkflowTagsBodySchema,
} from "@repo/api-contracts";
import { Effect, Either, type ParseResult, Schema } from "effect";
import { ConfigService } from "../config/index.js";
import { ValidationError } from "../errors/index.js";
import { PaperlessService } from "../services/PaperlessService.js";
import {
  makeAnalysisCommandHandlers,
  makeDaemonAnalysisCommandRuntime,
} from "./analysis/command-handlers.js";
import * as analysisQueryHandlers from "./analysis/query-handlers.js";
import * as casesHandlers from "./cases/handlers.js";
import {
  makeCatalogCommandHandlers,
  makeDaemonCatalogCommandRuntime,
} from "./catalog/command-handlers.js";
import * as catalogHandlers from "./catalog/handlers.js";
import * as catalogQueryHandlers from "./catalog/query-handlers.js";
import * as chatHandlers from "./chat/handlers.js";
import * as documentsHandlers from "./documents/handlers.js";
import * as healthHandlers from "./health/handlers.js";
import * as jobsHandlers from "./jobs/handlers.js";
import * as metadataHandlers from "./metadata/handlers.js";
import * as pendingHandlers from "./pending/handlers.js";
import * as processingHandlers from "./processing/handlers.js";
import * as schemaHandlers from "./schema/handlers.js";
import * as searchHandlers from "./search/handlers.js";
import * as settingsHandlers from "./settings/handlers.js";
import * as systemHandlers from "./system/handlers.js";
import * as translationHandlers from "./translation/handlers.js";

// ===========================================================================
// Types
// ===========================================================================

type HttpMethod = "GET" | "POST" | "PATCH" | "PUT" | "DELETE";

interface RouteMatch {
  handler: (
    params: Record<string, string>,
    body: unknown,
    url: URL,
  ) => Effect.Effect<unknown, unknown, unknown>;
  params: Record<string, string>;
}

interface Route {
  method: HttpMethod;
  path: string;
  pattern: RegExp;
  paramNames: string[];
  handler: (
    params: Record<string, string>,
    body: unknown,
    url: URL,
  ) => Effect.Effect<unknown, unknown, unknown>;
}

// ===========================================================================
// Route Registry
// ===========================================================================

const routes: Route[] = [];

const routeParam = (params: Record<string, string>, name: string): string => params[name] ?? "";

const analysisCommandRuntime = makeDaemonAnalysisCommandRuntime();
const withAnalysisCommandHandlers = <A, E, R>(
  use: (handlers: ReturnType<typeof makeAnalysisCommandHandlers>) => Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R | ConfigService> =>
  Effect.gen(function* () {
    const config = yield* ConfigService;
    const scanner = config.config.cutover.scanner;
    const handlers = makeAnalysisCommandHandlers(
      {
        configuredCustomFieldIds: [],
        parentTagIds: [],
        systemTagIds: [],
        workflowTagIds: [],
        aiAnalyseTagId: scanner.aiAnalyseTagId > 0 ? scanner.aiAnalyseTagId : undefined,
      },
      analysisCommandRuntime,
    );
    return yield* use(handlers);
  });
const catalogCommandHandlers = makeCatalogCommandHandlers({}, makeDaemonCatalogCommandRuntime());

const numericQueryParamNames = new Set(["limit", "documentId"]);

const queryRequest = (url: URL): Record<string, string | number> => {
  const request: Record<string, string | number> = {};
  for (const [key, value] of url.searchParams.entries()) {
    request[key] = numericQueryParamNames.has(key) ? Number(value) : value;
  }
  return request;
};

const isCatalogApplyCommandBody = (body: unknown): boolean =>
  typeof body === "object" &&
  body !== null &&
  !Array.isArray(body) &&
  ("expectedProposalFingerprint" in body ||
    "expectedEvidenceFingerprint" in body ||
    "expectedCatalogFingerprint" in body ||
    "idempotencyKey" in body);

const toPathArray = (path: ParseResult.Path): Array<string | number> =>
  (Array.isArray(path) ? path : [path]).map((segment) =>
    typeof segment === "symbol" ? segment.toString() : segment,
  );

const issueMessage = (issue: ParseResult.ParseIssue): string => {
  if ("message" in issue && typeof issue.message === "string" && issue.message.length > 0) {
    return issue.message;
  }
  return issue._tag;
};

const flattenParseIssues = (
  issue: ParseResult.ParseIssue,
  path: Array<string | number> = [],
): Array<{ path: Array<string | number>; message: string; code: string }> => {
  switch (issue._tag) {
    case "Pointer":
      return flattenParseIssues(issue.issue, [...path, ...toPathArray(issue.path)]);
    case "Composite": {
      const issues = Array.isArray(issue.issues) ? issue.issues : [issue.issues];
      return issues.flatMap((nested) => flattenParseIssues(nested, path));
    }
    case "Refinement":
    case "Transformation":
      return flattenParseIssues(issue.issue, path);
    default:
      return [{ path, message: issueMessage(issue), code: issue._tag }];
  }
};

const validationIssues = (error: ParseResult.ParseError) => {
  const issues = flattenParseIssues(error.issue);
  return issues.length > 0 ? issues : [{ path: [], message: error.message, code: "invalid_type" }];
};

const parseWithSchema = <A, I>(
  schema: Schema.Schema<A, I, never>,
  value: unknown,
  label: string,
): Effect.Effect<A, ValidationError> => {
  const result = Schema.decodeUnknownEither(schema)(value);
  if (Either.isRight(result)) return Effect.succeed(result.right);
  return Effect.fail(
    new ValidationError({
      message: `Invalid ${label}`,
      field: label,
      issues: validationIssues(result.left),
    }),
  );
};

const bodySchema = <A, I>(
  schema: Schema.Schema<A, I, never>,
  body: unknown,
): Effect.Effect<A, ValidationError> => parseWithSchema(schema, body, "request body");

const paramSchema = <A, I>(schema: Schema.Schema<A, I, never>, value: unknown, name: string) =>
  parseWithSchema(schema, value, `path parameter '${name}'`);

const documentIdParam = (params: Record<string, string>, name: string) =>
  paramSchema(DocumentIdFromStringSchema, routeParam(params, name), name);

const tagIdParam = (params: Record<string, string>, name: string) =>
  paramSchema(TagIdFromStringSchema, routeParam(params, name), name);

const customFieldIdParam = (params: Record<string, string>, name: string) =>
  paramSchema(CustomFieldIdFromStringSchema, routeParam(params, name), name);

const blockedSuggestionIdParam = (params: Record<string, string>, name: string) =>
  paramSchema(BlockedSuggestionIdFromStringSchema, routeParam(params, name), name);

const mutableStringArray = (values?: readonly string[]): string[] => (values ? [...values] : []);
const mutableNumberArray = (values?: readonly number[]): number[] => (values ? [...values] : []);

const toCaseAnswerHandlerBody = (request: {
  answer?: string;
  guidance?: string | null;
  selectedEntityId?: number | null;
  selectedEntityName?: string | null;
  metadataPatch?: {
    title?: string;
    correspondentId?: number | null;
    correspondentName?: string | null;
    documentTypeId?: number | null;
    documentTypeName?: string | null;
    tagIds?: readonly number[];
    tagNames?: readonly string[];
  } | null;
}) => ({
  ...request,
  metadataPatch: request.metadataPatch
    ? {
        ...request.metadataPatch,
        tagIds: request.metadataPatch.tagIds
          ? mutableNumberArray(request.metadataPatch.tagIds)
          : undefined,
        tagNames: request.metadataPatch.tagNames
          ? mutableStringArray(request.metadataPatch.tagNames)
          : undefined,
      }
    : request.metadataPatch,
});

const addRoute = (
  method: HttpMethod,
  path: string,
  handler: (
    params: Record<string, string>,
    body: unknown,
    url: URL,
  ) => Effect.Effect<unknown, unknown, unknown>,
) => {
  // Convert path pattern to regex
  const paramNames: string[] = [];
  const pattern = new RegExp(
    "^" +
      path.replace(/\//g, "\\/").replace(/:(\w+)/g, (_, name) => {
        paramNames.push(name);
        return "([^/]+)";
      }) +
      "$",
  );

  routes.push({ method, path, pattern, paramNames, handler });
};

export const getRegisteredRoutes = () => routes.map(({ method, path }) => ({ method, path }));

// ===========================================================================
// Health & Root
// ===========================================================================

addRoute("GET", "/", () =>
  Effect.succeed({
    name: "Paperless Local LLM (TypeScript)",
    version: "0.1.0",
    status: "running",
  }),
);

addRoute("GET", "/health", () => healthHandlers.getHealth);

addRoute("GET", "/openapi.json", () => Effect.succeed(generateOpenApiDocument()));

addRoute("GET", "/api/system/readiness", () => systemHandlers.getSystemReadiness);

// ===========================================================================
// Settings API - /api/settings
// ===========================================================================

addRoute("GET", "/api/settings", () => settingsHandlers.getSettings);

addRoute("PATCH", "/api/settings", (_, body) =>
  bodySchema(SettingsUpdateBodySchema, body).pipe(Effect.flatMap(settingsHandlers.updateSettings)),
);

addRoute("POST", "/api/settings/test-connection/:service", (params) => {
  switch (params.service) {
    case "paperless":
      return settingsHandlers.testPaperlessConnection;
    case "ollama":
      return settingsHandlers.testOllamaConnection;
    case "mistral":
      return settingsHandlers.testMistralConnection;
    case "qdrant":
      return settingsHandlers.testQdrantConnection;
    default:
      return Effect.succeed({
        status: "error",
        message: `Unknown service: ${params.service}`,
        details: null,
      });
  }
});

addRoute("GET", "/api/settings/ollama/models", () => settingsHandlers.getOllamaModels);

addRoute("GET", "/api/settings/ollama/status", () => settingsHandlers.getOllamaStatus);

addRoute("GET", "/api/settings/mistral/models", () => settingsHandlers.getMistralModels);

addRoute("GET", "/api/settings/openai-codex/models", () => settingsHandlers.getOpenAICodexModels);

addRoute("GET", "/api/settings/tags/status", () => settingsHandlers.getTagsStatus);

addRoute("POST", "/api/settings/tags/create", (_, body) => {
  return bodySchema(WorkflowTagsBodySchema, body).pipe(
    Effect.flatMap(({ tag_names }) =>
      settingsHandlers.createWorkflowTags(mutableStringArray(tag_names)),
    ),
  );
});

addRoute("POST", "/api/settings/tags/fix-colors", () => settingsHandlers.fixWorkflowTagColors);

addRoute("POST", "/api/settings/import-config", () => settingsHandlers.importConfigFromYaml);

addRoute("GET", "/api/settings/check-import", () => settingsHandlers.checkAndImportSettings);

addRoute("POST", "/api/settings/clear-database", () => settingsHandlers.clearDatabase);

// Processing Logs Settings
addRoute(
  "GET",
  "/api/settings/processing-logs/stats",
  () => settingsHandlers.getProcessingLogStats,
);

addRoute("DELETE", "/api/settings/processing-logs", () => settingsHandlers.clearAllProcessingLogs);

// ===========================================================================
// Pending Reviews API - /api/pending
// ===========================================================================

addRoute("GET", "/api/pending", () => pendingHandlers.listPendingItems());

addRoute("GET", "/api/pending/counts", () => pendingHandlers.getPendingCounts);

addRoute("GET", "/api/pending/similar", () => pendingHandlers.getSimilarItems);

addRoute("GET", "/api/pending/search-entities", () => pendingHandlers.getSearchEntities);

addRoute("GET", "/api/pending/blocked", () => pendingHandlers.getBlocked);

addRoute("POST", "/api/pending/merge", (_, body) =>
  bodySchema(MergePendingBodySchema, body).pipe(Effect.flatMap(pendingHandlers.mergeSimilarItems)),
);

addRoute("POST", "/api/pending/bulk", (_, body) =>
  bodySchema(BulkPendingBodySchema, body).pipe(Effect.flatMap(pendingHandlers.bulkAction)),
);

// Parameterized routes MUST come after specific routes
addRoute("GET", "/api/pending/:id", (params) =>
  pendingHandlers.getPendingItem(routeParam(params, "id")),
);

addRoute("POST", "/api/pending/:id/approve", (params, body) =>
  bodySchema(ApprovePendingBodySchema, body).pipe(
    Effect.flatMap((request) =>
      pendingHandlers.approvePendingItem(routeParam(params, "id"), request),
    ),
  ),
);

addRoute("POST", "/api/pending/:id/reject", (params, body) =>
  bodySchema(RejectPendingBodySchema, body).pipe(
    Effect.flatMap((request) =>
      pendingHandlers.rejectPendingItem(routeParam(params, "id"), request),
    ),
  ),
);

addRoute("POST", "/api/pending/:id/reject-with-feedback", (params, body) =>
  bodySchema(RejectWithFeedbackBodySchema, body).pipe(
    Effect.flatMap((request) =>
      pendingHandlers.rejectWithFeedback(routeParam(params, "id"), request),
    ),
  ),
);

addRoute("POST", "/api/pending/:id/approve-cleanup", (params, body) => {
  return bodySchema(CleanupApproveBodySchema, body).pipe(
    Effect.flatMap(({ final_name }) =>
      pendingHandlers.approveCleanup(routeParam(params, "id"), final_name),
    ),
  );
});

addRoute("DELETE", "/api/pending/blocked/:blockId", (params) =>
  blockedSuggestionIdParam(params, "blockId").pipe(Effect.flatMap(pendingHandlers.unblockItem)),
);

addRoute("POST", "/api/pending/blocked", (_, body) =>
  bodySchema(PendingBlockedSuggestionBodySchema, body).pipe(
    Effect.flatMap(pendingHandlers.addBlockedSuggestion),
  ),
);

// ===========================================================================
// Jobs API - /api/jobs
// ===========================================================================

addRoute("GET", "/api/jobs/status", () => jobsHandlers.getAllJobStatus);

addRoute("GET", "/api/jobs/status/:jobName", (params) =>
  jobsHandlers.getJobStatus(routeParam(params, "jobName")),
);

// Bootstrap
addRoute("POST", "/api/jobs/bootstrap/start", (_, body) => {
  return bodySchema(BootstrapStartBodySchema, body).pipe(
    Effect.flatMap(({ analysis_type }) => jobsHandlers.startBootstrap(analysis_type ?? "all")),
  );
});

addRoute("GET", "/api/jobs/bootstrap/status", () => jobsHandlers.getBootstrapStatus);

addRoute("POST", "/api/jobs/bootstrap/cancel", () => jobsHandlers.cancelBootstrap);

addRoute("POST", "/api/jobs/bootstrap/skip", (_, body) => {
  return bodySchema(BootstrapSkipBodySchema, body).pipe(
    Effect.flatMap(({ count }) => jobsHandlers.skipBootstrap(count ?? 1)),
  );
});

// Schema Cleanup
addRoute("POST", "/api/jobs/schema-cleanup/run", () => jobsHandlers.runSchemaCleanup);

addRoute("GET", "/api/jobs/schema-cleanup/status", () => jobsHandlers.getSchemaCleanupStatus);

// Bulk OCR
addRoute("POST", "/api/jobs/bulk-ocr/start", (_, body) => {
  return bodySchema(BulkOcrStartBodySchema, body).pipe(
    Effect.flatMap(({ docs_per_second, skip_existing }) =>
      jobsHandlers.startBulkOcr(docs_per_second ?? 1, skip_existing ?? true),
    ),
  );
});

addRoute("GET", "/api/jobs/bulk-ocr/status", () => jobsHandlers.getBulkOcrStatus);

addRoute("POST", "/api/jobs/bulk-ocr/cancel", () => jobsHandlers.cancelBulkOcr);

// Bulk Ingest (OCR + Vector DB)
addRoute("POST", "/api/jobs/bulk-ingest/start", (_, body) => {
  return bodySchema(BulkIngestBodySchema, body).pipe(Effect.flatMap(jobsHandlers.startBulkIngest));
});

addRoute("GET", "/api/jobs/bulk-ingest/status", () => jobsHandlers.getBulkIngestStatus);

addRoute("POST", "/api/jobs/bulk-ingest/cancel", () => jobsHandlers.cancelBulkIngest);

// Metadata Enhancement
addRoute("POST", "/api/jobs/metadata-enhancement/run", () =>
  Effect.succeed({ status: "started", message: "Metadata enhancement started" }),
);

// Job Schedules
addRoute("GET", "/api/jobs/schedule", () =>
  Effect.succeed({
    jobs: {
      schema_cleanup: { enabled: false, schedule: "daily", cron: "0 2 * * *" },
      metadata_enhancement: { enabled: false, schedule: "daily", cron: "0 3 * * *" },
      bulk_ocr: { enabled: false, schedule: "daily", cron: "0 4 * * *" },
    },
  }),
);

addRoute("PATCH", "/api/jobs/schedule", (_, body) =>
  bodySchema(ScheduleUpdateBodySchema, body).pipe(
    Effect.map((request) => ({ success: true, ...request })),
  ),
);

// ===========================================================================
// Settings API - AI Document Types
// ===========================================================================

addRoute("GET", "/api/settings/ai-document-types", () => settingsHandlers.getAiDocumentTypes);

addRoute("PATCH", "/api/settings/ai-document-types", (_, body) => {
  return bodySchema(SelectedTypeIdsBodySchema, body).pipe(
    Effect.flatMap(({ selected_type_ids }) =>
      settingsHandlers.updateAiDocumentTypes(mutableNumberArray(selected_type_ids)),
    ),
  );
});

// Custom fields settings
addRoute("GET", "/api/settings/custom-fields", () => settingsHandlers.getCustomFields);

addRoute("PATCH", "/api/settings/custom-fields", (_, body) => {
  return bodySchema(SelectedFieldIdsBodySchema, body).pipe(
    Effect.flatMap(({ selected_field_ids }) =>
      settingsHandlers.updateCustomFields(mutableNumberArray(selected_field_ids)),
    ),
  );
});

// AI Tags settings
addRoute("GET", "/api/settings/ai-tags", () => settingsHandlers.getAiTags);

addRoute("PATCH", "/api/settings/ai-tags", (_, body) => {
  return bodySchema(SelectedTagIdsBodySchema, body).pipe(
    Effect.flatMap(({ selected_tag_ids }) =>
      settingsHandlers.updateAiTags(mutableNumberArray(selected_tag_ids)),
    ),
  );
});

// ===========================================================================
// Documents API - /api/documents
// ===========================================================================

addRoute("GET", "/api/documents/queue", () => documentsHandlers.getQueueStats);

addRoute("GET", "/api/documents", (_, __, url) =>
  documentsHandlers.listDocuments(Number(url.searchParams.get("limit") ?? "50")),
);

// NOTE: tag query param is handled in handleRequest() below
addRoute("GET", "/api/documents/pending", () => documentsHandlers.getPendingDocuments());

addRoute("GET", "/api/documents/:id", (params) =>
  documentIdParam(params, "id").pipe(Effect.flatMap(documentsHandlers.getDocument)),
);

addRoute("GET", "/api/documents/:id/content", (params) =>
  documentIdParam(params, "id").pipe(Effect.flatMap(documentsHandlers.getDocumentContent)),
);

addRoute("GET", "/api/documents/:id/pdf", (params) =>
  documentIdParam(params, "id").pipe(Effect.flatMap(documentsHandlers.getDocumentPdf)),
);

addRoute("GET", "/api/paperless/capabilities", () =>
  Effect.gen(function* () {
    const paperless = yield* PaperlessService;
    return paperless.capability.descriptor;
  }),
);

addRoute("POST", "/api/documents/:id/cleanup-tags", (params, body) => {
  return Effect.all({
    docId: documentIdParam(params, "id"),
    request: bodySchema(CleanupTagsBodySchema, body),
  }).pipe(
    Effect.flatMap(({ docId, request }) =>
      documentsHandlers.cleanupDocumentTags(docId, request.keep_llm_tag),
    ),
  );
});

// ===========================================================================
// Processing API - /api/processing
// ===========================================================================

addRoute("POST", "/api/processing/:docId/start", (params, body) => {
  return Effect.all({
    docId: documentIdParam(params, "docId"),
    request: bodySchema(ProcessingStartBodySchema, body),
  }).pipe(
    Effect.flatMap(({ docId, request }) =>
      processingHandlers.startProcessing(docId, request.step, request.dryRun),
    ),
  );
});

addRoute("POST", "/api/processing/:docId/confirm", (params) => {
  const confirmed = true; // Default to true for confirmation endpoint
  return documentIdParam(params, "docId").pipe(
    Effect.flatMap((docId) => processingHandlers.confirmProcessing(docId, confirmed)),
  );
});

addRoute("POST", "/api/processing/:docId/cancel", (params, body) => {
  return Effect.all({
    docId: documentIdParam(params, "docId"),
    request: bodySchema(ProcessingCancelBodySchema, body),
  }).pipe(
    Effect.flatMap(({ docId, request }) => processingHandlers.cancelProcessing(docId, request)),
  );
});

addRoute("POST", "/api/processing/:docId/release-lock", (params, body) => {
  return Effect.all({
    docId: documentIdParam(params, "docId"),
    request: bodySchema(LockReleaseBodySchema, body),
  }).pipe(
    Effect.flatMap(({ docId, request }) => processingHandlers.releaseDocumentLock(docId, request)),
  );
});

addRoute("GET", "/api/processing/locks", () => processingHandlers.listLocks);

addRoute("POST", "/api/processing/locks/prune", () => processingHandlers.pruneStaleLocks);

addRoute("GET", "/api/processing/status", () => processingHandlers.getProcessingStatus);

// Processing Logs
addRoute("GET", "/api/processing/:docId/logs", (params) =>
  documentIdParam(params, "docId").pipe(Effect.flatMap(processingHandlers.getProcessingLogs)),
);

addRoute("DELETE", "/api/processing/:docId/logs", (params) =>
  documentIdParam(params, "docId").pipe(Effect.flatMap(processingHandlers.clearProcessingLogs)),
);

// Auto Processing
addRoute("GET", "/api/processing/auto/status", () => processingHandlers.getAutoProcessingStatus);

addRoute("POST", "/api/processing/auto/trigger", () => processingHandlers.triggerAutoProcessing);

// ===========================================================================
// Document Cases API - /api/cases
// ===========================================================================

addRoute("GET", "/api/cases", () => casesHandlers.listCases());

addRoute("GET", "/api/cases/document/:docId", (params) =>
  documentIdParam(params, "docId").pipe(Effect.flatMap(casesHandlers.getOrCreateDocumentCase)),
);

addRoute("POST", "/api/cases/document/:docId/run", (params, body) =>
  Effect.all({
    docId: documentIdParam(params, "docId"),
    request: bodySchema(CaseRunBodySchema, body),
  }).pipe(Effect.flatMap(({ docId, request }) => casesHandlers.runCase(docId, request))),
);

addRoute("GET", "/api/cases/document/:docId/logs", (params) =>
  documentIdParam(params, "docId").pipe(Effect.flatMap(casesHandlers.getCaseLogs)),
);

addRoute("POST", "/api/cases/questions/:questionId/answer", (params, body) =>
  bodySchema(CaseAnswerBodySchema, body).pipe(
    Effect.flatMap((request) =>
      casesHandlers.answerQuestion(
        routeParam(params, "questionId"),
        toCaseAnswerHandlerBody(request),
      ),
    ),
  ),
);

addRoute("GET", "/api/cases/:caseId", (params) =>
  casesHandlers.getCase(routeParam(params, "caseId")),
);

// ===========================================================================
// Catalog Agent API - /api/catalog
// ===========================================================================

addRoute("POST", "/api/analysis/runs", (_, body) =>
  withAnalysisCommandHandlers((handlers) => handlers.startAnalysis(body)),
);

addRoute("GET", "/api/analysis/runs", (_, __, url) =>
  analysisQueryHandlers.listAnalysisRuns(queryRequest(url)),
);

addRoute("GET", "/api/analysis/runs/:runId", (params) =>
  analysisQueryHandlers.getAnalysisRun(routeParam(params, "runId")),
);

addRoute("GET", "/api/analysis/runs/:runId/progress", (params) =>
  Effect.succeed({
    status: 503,
    error: "SSE endpoint",
    code: "CAPABILITY_UNAVAILABLE",
    message: `Analysis progress for ${routeParam(params, "runId")} is served by the HTTP SSE runtime.`,
  }),
);

addRoute("GET", "/api/analysis/runs/:runId/proposals", (params, _, url) =>
  analysisQueryHandlers.listAnalysisProposals(routeParam(params, "runId"), queryRequest(url)),
);

addRoute("POST", "/api/analysis/runs/:runId/apply", (params, body) =>
  withAnalysisCommandHandlers((handlers) =>
    handlers.applyAnalysisRun(routeParam(params, "runId"), body),
  ),
);

addRoute("POST", "/api/analysis/runs/:runId/reject", (params, body) =>
  withAnalysisCommandHandlers((handlers) =>
    handlers.rejectAnalysisRun(routeParam(params, "runId"), body),
  ),
);

addRoute("POST", "/api/analysis/runs/:runId/retry", (params, body) =>
  withAnalysisCommandHandlers((handlers) =>
    handlers.retryAnalysisRun(routeParam(params, "runId"), body),
  ),
);

addRoute("POST", "/api/analysis/runs/:runId/cancel", (params, body) =>
  withAnalysisCommandHandlers((handlers) =>
    handlers.cancelAnalysisRun(routeParam(params, "runId"), body),
  ),
);

addRoute("POST", "/api/analysis/runs/:runId/force-ocr", (params, body) =>
  withAnalysisCommandHandlers((handlers) =>
    handlers.forceOcrAnalysisRun(routeParam(params, "runId"), body),
  ),
);

addRoute("GET", "/api/analysis/review", (_, __, url) =>
  analysisQueryHandlers.listAnalysisReviewQueue(queryRequest(url)),
);

addRoute("GET", "/api/analysis/failed", (_, __, url) =>
  analysisQueryHandlers.listAnalysisFailures(queryRequest(url)),
);

addRoute("POST", "/api/analysis/random-cycle/select", (_, body) =>
  withAnalysisCommandHandlers((handlers) => handlers.selectRandomCycle(body)),
);

addRoute("POST", "/api/analysis/random-cycle/reset", (_, body) =>
  withAnalysisCommandHandlers((handlers) => handlers.resetRandomCycle(body)),
);

addRoute("POST", "/api/catalog/runs", (_, body) =>
  bodySchema(CatalogRunBodySchema, body).pipe(Effect.flatMap(catalogHandlers.startCatalogRun)),
);

addRoute("POST", "/api/catalog/epochs", (_, body) =>
  catalogCommandHandlers.startCatalogOptimization(body),
);

addRoute("GET", "/api/catalog/epochs", (_, __, url) =>
  catalogQueryHandlers.listCatalogEpochs(queryRequest(url)),
);

// Side-effect-free hydration of the current catalog precondition (first-run start).
addRoute("GET", "/api/catalog/current-hash", (_, __, url) =>
  catalogQueryHandlers.getCurrentCatalogHash(url.searchParams.getAll("kind")),
);

addRoute("GET", "/api/catalog/epochs/:epochId", (params) =>
  catalogQueryHandlers.getCatalogEpoch(routeParam(params, "epochId")),
);

addRoute("POST", "/api/catalog/epochs/:epochId/cancel", (params, body) =>
  catalogCommandHandlers.cancelCatalogOptimization(routeParam(params, "epochId"), body),
);

addRoute("GET", "/api/catalog/epochs/:epochId/events", (params) =>
  Effect.succeed({
    status: 503,
    error: "SSE endpoint",
    code: "CAPABILITY_UNAVAILABLE",
    message: `Catalog events for ${routeParam(params, "epochId")} are served by the HTTP SSE runtime.`,
  }),
);

addRoute("GET", "/api/catalog/epochs/:epochId/candidates", (params, _, url) =>
  catalogQueryHandlers.listCatalogCandidates(routeParam(params, "epochId"), queryRequest(url)),
);

addRoute("GET", "/api/catalog/epochs/:epochId/evidence", (params, _, url) =>
  catalogQueryHandlers.listCatalogEvidence(routeParam(params, "epochId"), queryRequest(url)),
);

addRoute("GET", "/api/catalog/epochs/:epochId/proposals", (params, _, url) =>
  catalogQueryHandlers.listCatalogProposals(routeParam(params, "epochId"), queryRequest(url)),
);

addRoute("POST", "/api/catalog/proposals/:proposalId/approve", (params, body) =>
  catalogCommandHandlers.approveCatalogProposal(routeParam(params, "proposalId"), body),
);

addRoute("POST", "/api/catalog/proposals/:proposalId/reject", (params, body) =>
  catalogCommandHandlers.rejectCatalogProposal(routeParam(params, "proposalId"), body),
);

addRoute("GET", "/api/catalog/runs", () => catalogHandlers.listCatalogRuns);

addRoute("GET", "/api/catalog/runs/:runId", (params) =>
  catalogHandlers.getCatalogRun(routeParam(params, "runId")),
);

addRoute("GET", "/api/catalog/proposals", () => catalogHandlers.listCatalogProposals());

addRoute("POST", "/api/catalog/proposals/:proposalId/decision", (params, body) =>
  bodySchema(CatalogDecisionBodySchema, body).pipe(
    Effect.flatMap((request) =>
      catalogHandlers.decideCatalogProposal(routeParam(params, "proposalId"), request),
    ),
  ),
);

addRoute("POST", "/api/catalog/proposals/:proposalId/apply", (params, body) =>
  isCatalogApplyCommandBody(body)
    ? catalogCommandHandlers.applyCatalogProposal(routeParam(params, "proposalId"), body)
    : catalogHandlers.applyCatalogProposal(routeParam(params, "proposalId")),
);

addRoute("GET", "/api/catalog/proposals/:proposalId/apply-journal", (params) =>
  catalogQueryHandlers.getCatalogApplyJournal(routeParam(params, "proposalId")),
);

addRoute("GET", "/api/catalog/logs", () => catalogHandlers.getCatalogLogs());

// ===========================================================================
// Metadata API - /api/metadata
// ===========================================================================

// Tags
addRoute("GET", "/api/metadata/tags", () => metadataHandlers.listTags);

addRoute("GET", "/api/metadata/tags/:tagId", (params) =>
  tagIdParam(params, "tagId").pipe(Effect.flatMap(metadataHandlers.getTag)),
);

addRoute("PUT", "/api/metadata/tags/:tagId", (params, body) =>
  Effect.all({
    tagId: tagIdParam(params, "tagId"),
    request: bodySchema(TagUpdateBodySchema, body),
  }).pipe(Effect.flatMap(({ tagId, request }) => metadataHandlers.updateTag(tagId, request))),
);

addRoute("DELETE", "/api/metadata/tags/:tagId", (params) =>
  tagIdParam(params, "tagId").pipe(Effect.flatMap(metadataHandlers.deleteTag)),
);

addRoute("POST", "/api/metadata/tags/bulk", (_, body) =>
  bodySchema(TagBulkUpdateBodySchema, body).pipe(
    Effect.flatMap((request) => metadataHandlers.bulkUpdateTags([...request])),
  ),
);

// Tag Translations
addRoute("GET", "/api/metadata/tags/:tagId/translations", (params) =>
  tagIdParam(params, "tagId").pipe(Effect.flatMap(metadataHandlers.getTagTranslations)),
);

addRoute("PUT", "/api/metadata/tags/:tagId/translations/:lang", (params, body) =>
  Effect.all({
    tagId: tagIdParam(params, "tagId"),
    request: bodySchema(TagTranslationBodySchema, body),
  }).pipe(
    Effect.flatMap(({ tagId, request }) =>
      metadataHandlers.updateTagTranslation(tagId, routeParam(params, "lang"), request),
    ),
  ),
);

// Tag AI Operations
addRoute("POST", "/api/metadata/tags/:tagId/optimize-description", (params, body) =>
  Effect.all({
    tagId: tagIdParam(params, "tagId"),
    request: bodySchema(TagOptimizeBodySchema, body),
  }).pipe(
    Effect.flatMap(({ tagId, request }) => metadataHandlers.optimizeTagDescription(tagId, request)),
  ),
);

addRoute("POST", "/api/metadata/tags/:tagId/translate-description", (params, body) =>
  Effect.all({
    tagId: tagIdParam(params, "tagId"),
    request: bodySchema(TagTranslateBodySchema, body),
  }).pipe(
    Effect.flatMap(({ tagId, request }) =>
      metadataHandlers.translateTagDescription(tagId, request),
    ),
  ),
);

// Custom Fields
addRoute("GET", "/api/metadata/custom-fields", () => metadataHandlers.listCustomFields);

addRoute("GET", "/api/metadata/custom-fields/:fieldId", (params) =>
  customFieldIdParam(params, "fieldId").pipe(Effect.flatMap(metadataHandlers.getCustomField)),
);

addRoute("PUT", "/api/metadata/custom-fields/:fieldId", (params, body) =>
  Effect.all({
    fieldId: customFieldIdParam(params, "fieldId"),
    request: bodySchema(CustomFieldUpdateBodySchema, body),
  }).pipe(
    Effect.flatMap(({ fieldId, request }) => metadataHandlers.updateCustomField(fieldId, request)),
  ),
);

addRoute("DELETE", "/api/metadata/custom-fields/:fieldId", (params) =>
  customFieldIdParam(params, "fieldId").pipe(Effect.flatMap(metadataHandlers.deleteCustomField)),
);

addRoute("POST", "/api/metadata/custom-fields/bulk", (_, body) =>
  bodySchema(CustomFieldBulkUpdateBodySchema, body).pipe(
    Effect.flatMap((request) => metadataHandlers.bulkUpdateCustomFields([...request])),
  ),
);

// ===========================================================================
// Schema API - /api/schema (Blocked Suggestions)
// ===========================================================================

addRoute("GET", "/api/schema/blocked", () => schemaHandlers.getBlocked());

addRoute("POST", "/api/schema/blocked", (_, body) =>
  bodySchema(BlockSuggestionBodySchema, body).pipe(Effect.flatMap(schemaHandlers.blockSuggestion)),
);

addRoute("DELETE", "/api/schema/blocked/:id", (params) =>
  blockedSuggestionIdParam(params, "id").pipe(Effect.flatMap(schemaHandlers.unblock)),
);

addRoute("GET", "/api/schema/blocked/check", () => {
  // Query params would be handled in request handler
  return schemaHandlers.checkBlocked("", "");
});

// ===========================================================================
// Translation API - /api/translation
// ===========================================================================

addRoute("POST", "/api/translation/translate", (_, body) =>
  bodySchema(TranslateBodySchema, body).pipe(Effect.flatMap(translationHandlers.translate)),
);

addRoute("GET", "/api/translation/translations/:targetLang", (params) =>
  translationHandlers.getTranslations(routeParam(params, "targetLang")),
);

addRoute("POST", "/api/translation/cache/clear", (_, body) => {
  return bodySchema(TranslationClearBodySchema, body).pipe(
    Effect.flatMap(({ target_lang, content_type }) =>
      translationHandlers.clearCache(target_lang, content_type),
    ),
  );
});

addRoute("GET", "/api/translation/languages", () => translationHandlers.getLanguages);

// ===========================================================================
// Search API - /api/search
// ===========================================================================

// NOTE: query params (q, limit) are handled in handleRequest() below
addRoute("GET", "/api/search", () => searchHandlers.searchDocuments(""));
addRoute("POST", "/api/search/index/:docId", (params) =>
  documentIdParam(params, "docId").pipe(Effect.flatMap(searchHandlers.indexDocument)),
);

// ===========================================================================
// Chat API - /api/chat
// ===========================================================================

addRoute("POST", "/api/chat", (_, body) => {
  return bodySchema(ChatBodySchema, body).pipe(
    Effect.flatMap(({ messages }) => chatHandlers.chatWithDocuments(messages ? [...messages] : [])),
  );
});

// ===========================================================================
// Route Matching
// ===========================================================================

const matchRoute = (method: string, path: string): RouteMatch | null => {
  for (const route of routes) {
    if (route.method !== method) continue;

    const match = path.match(route.pattern);
    if (match) {
      const params: Record<string, string> = {};
      route.paramNames.forEach((name, i) => {
        params[name] = match[i + 1] ?? "";
      });
      return { handler: route.handler, params };
    }
  }
  return null;
};

// ===========================================================================
// Request Handler
// ===========================================================================

export const handleRequest = (
  req: IncomingMessage,
  _res: ServerResponse,
  body: unknown,
): Effect.Effect<unknown, unknown, unknown> => {
  const method = req.method as HttpMethod;
  const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
  const path = url.pathname;

  // Add query params handling
  const queryType = url.searchParams.get("type");

  const match = matchRoute(method, path);

  if (!match) {
    return Effect.succeed({
      status: 404,
      error: "Not Found",
      message: `No handler for ${method} ${path}`,
    });
  }

  // Inject query params if applicable
  if (queryType && path === "/api/pending") {
    return pendingHandlers.listPendingItems(queryType);
  }

  // Handle tag filter for documents/pending
  const queryTag = url.searchParams.get("tag");
  if (path === "/api/documents/pending" && queryTag) {
    return documentsHandlers.getPendingDocuments(queryTag);
  }

  // Handle search query params
  if (path === "/api/search") {
    const parsedLimit = Number.parseInt(url.searchParams.get("limit") ?? "10", 10);
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? Math.min(parsedLimit, 100) : 10;
    return parseWithSchema(
      SearchQuerySchema,
      url.searchParams.get("q") ?? "",
      "query parameter 'q'",
    ).pipe(Effect.flatMap((q) => searchHandlers.searchDocuments(q, limit)));
  }

  if (path === "/api/cases" && method === "GET") {
    return casesHandlers.listCases(url.searchParams.get("status") ?? undefined);
  }

  if (path === "/api/catalog/proposals" && method === "GET") {
    return catalogHandlers.listCatalogProposals(url.searchParams.get("run_id") ?? undefined);
  }

  if (path === "/api/catalog/logs" && method === "GET") {
    return catalogHandlers.getCatalogLogs(url.searchParams.get("run_id") ?? undefined);
  }

  if (path === "/api/schema/blocked" && method === "GET") {
    return schemaHandlers.getBlocked(url.searchParams.get("block_type") ?? undefined);
  }

  if (path === "/api/schema/blocked/check" && method === "GET") {
    return schemaHandlers.checkBlocked(
      url.searchParams.get("name") ?? "",
      url.searchParams.get("block_type") ?? "",
    );
  }

  return match.handler(match.params, body, url);
};
