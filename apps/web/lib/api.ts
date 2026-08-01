/**
 * API client for the Paperless Local LLM backend
 */

import type {
  AnalysisActionAccepted,
  AnalysisCancelBody,
  AnalysisDecisionBody,
  AnalysisFailureQueuePage,
  AnalysisForceOcrBody,
  AnalysisProposalApplyAccepted,
  AnalysisProposalApplyBody,
  AnalysisProposalPage,
  AnalysisRetryBody,
  AnalysisReviewQueuePage,
  AnalysisRun,
  AnalysisRunAccepted,
  AnalysisRunPage,
  AnalysisRunStartBody,
  AnalysisRunState,
  AnalysisSseEvent,
  ApiValidationIssue,
  ApplyJournal,
  CatalogActionAccepted,
  CatalogApplyAccepted,
  CatalogApplyBody,
  CatalogCancelBody,
  CatalogCandidatePage,
  CatalogCurrentHash,
  CatalogEntityKind,
  CatalogEpoch,
  CatalogEpochAccepted,
  CatalogEpochPage,
  CatalogEpochStartBody,
  CatalogProposalDecisionBody,
  CatalogProposalPage,
  CatalogSseEvent,
  CatalogState,
  ChatMessage,
  ChatResponse,
  ConnectionTest,
  CouncilEvidencePage,
  CustomFieldMetadata,
  DocumentDetail,
  DocumentSummary,
  PageRequest,
  PaperlessCapabilityDescriptor,
  RandomCycleResetBody,
  RandomCycleSelectAccepted,
  RandomCycleSelectBody,
  Settings,
  SystemReadiness,
  TypedApiError,
} from "@repo/api-contracts";

export type {
  AnalysisFailureQueuePage,
  AnalysisProposalProjection,
  AnalysisReviewQueuePage,
  ChatMessage,
  ConnectionTest,
  DocumentDetail,
  PaperlessCapabilityDescriptor,
  SearchResult,
  Settings,
  Sha256Digest,
  SystemReadiness,
} from "@repo/api-contracts";

export const API_BASE = "";

export type ApiClientErrorResponse = {
  ok: false;
  error: string;
  status: number;
  issues?: ApiValidationIssue[];
  typedError?: TypedApiError;
  data?: never;
};

export type ApiClientResponse<T> =
  | { ok: true; data: T; status: number; error?: never; issues?: never; typedError?: never }
  | ApiClientErrorResponse;

const readErrorResponse = async (
  response: Response,
): Promise<{ error: string; issues?: ApiValidationIssue[]; typedError?: TypedApiError }> => {
  const text = await response.text().catch(() => "");
  if (!text) return { error: `HTTP ${response.status}` };
  try {
    const payload = JSON.parse(text) as {
      error?: string;
      message?: string;
      issues?: ApiValidationIssue[];
      code?: string;
      status?: number;
      requestId?: string;
      retryAfterSeconds?: number;
      details?: Record<string, unknown>;
    };
    const message = payload.message ?? payload.error ?? text;
    const typedError =
      typeof payload.code === "string" && typeof payload.status === "number"
        ? ({
            status: payload.status,
            code: payload.code,
            message,
            requestId: payload.requestId,
            retryAfterSeconds: payload.retryAfterSeconds,
            issues: Array.isArray(payload.issues) ? payload.issues : undefined,
            details: payload.details,
          } as TypedApiError)
        : undefined;
    return {
      error: message,
      issues: Array.isArray(payload.issues) ? payload.issues : undefined,
      typedError,
    };
  } catch {
    return { error: text };
  }
};

async function fetchApi<T>(endpoint: string, options?: RequestInit): Promise<ApiClientResponse<T>> {
  try {
    const response = await fetch(`${API_BASE}${endpoint}`, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options?.headers,
      },
    });

    if (!response.ok) {
      const { error, issues, typedError } = await readErrorResponse(response);
      return { ok: false, error, status: response.status, issues, typedError };
    }

    const data = await response.json();
    return { ok: true, data, status: response.status };
  } catch (error) {
    return { ok: false, error: String(error), status: 0 };
  }
}

const appendQuery = (
  endpoint: string,
  query: Record<string, string | number | boolean | null | undefined>,
): string => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value === undefined || value === null || value === "") continue;
    params.set(key, String(value));
  }
  const text = params.toString();
  return text ? `${endpoint}?${text}` : endpoint;
};

type SseEventName<T extends { event: string }> = T["event"];
type SseEventMap<T extends { event: string; data: unknown }> = {
  readonly [EventName in SseEventName<T>]: Extract<T, { event: EventName }>["data"];
};

const parseSsePayload = <T extends { event: string; data: unknown }>(
  eventName: string,
  data: string,
  allowedEvents: readonly SseEventName<T>[],
): T => {
  const parsed = JSON.parse(data) as unknown;
  const event =
    typeof parsed === "object" && parsed !== null && "event" in parsed
      ? String((parsed as { event: unknown }).event)
      : eventName;
  if (!allowedEvents.includes(event as SseEventName<T>)) {
    throw new Error(`Unsupported SSE event: ${event}`);
  }
  const payload =
    typeof parsed === "object" && parsed !== null && "data" in parsed
      ? (parsed as { data: unknown }).data
      : parsed;
  return { event, data: payload } as T;
};

const addSseListeners = <T extends { event: string; data: unknown }>(
  source: EventSource,
  eventNames: readonly SseEventName<T>[],
  decode: (event: MessageEvent<string>) => T,
  handlers: {
    readonly onEvent?: (event: T) => void;
    readonly onError?: (error: Event | Error) => void;
    readonly signal?: AbortSignal;
  } = {},
): EventSource => {
  const onMessage = (event: MessageEvent<string>) => {
    try {
      handlers.onEvent?.(decode(event));
    } catch (error) {
      handlers.onError?.(error instanceof Error ? error : new Error(String(error)));
    }
  };
  for (const eventName of eventNames) {
    source.addEventListener(eventName, onMessage as EventListener);
  }
  source.onerror = (event) => {
    handlers.onError?.(event);
  };
  if (handlers.signal) {
    if (handlers.signal.aborted) {
      source.close();
    } else {
      handlers.signal.addEventListener("abort", () => source.close(), { once: true });
    }
  }
  return source;
};

// Settings API
export const settingsApi = {
  get: () => fetchApi<Settings>("/api/settings"),
  testConnection: (service: string) =>
    fetchApi<ConnectionTest>(`/api/settings/test-connection/${service}`, {
      method: "POST",
    }),
};

export const systemApi = {
  getReadiness: (options?: RequestInit) =>
    fetchApi<SystemReadiness>("/api/system/readiness", {
      ...options,
      method: "GET",
    }),
  getPaperlessCapabilities: (options?: RequestInit) =>
    fetchApi<PaperlessCapabilityDescriptor>("/api/paperless/capabilities", {
      ...options,
      method: "GET",
    }),
};

// Documents API
export const documentsApi = {
  list: (limit = 50, options?: RequestInit) =>
    fetchApi<DocumentSummary[]>(`/api/documents?limit=${encodeURIComponent(String(limit))}`, {
      ...options,
      method: "GET",
    }),
  get: (id: number, options?: RequestInit) =>
    fetchApi<DocumentDetail>(`/api/documents/${id}`, options),
  getContent: (id: number) =>
    fetchApi<{ id: number; content: string }>(`/api/documents/${id}/content`),
  getPdfUrl: (id: number) => `${API_BASE}/api/documents/${id}/pdf`,
};

export type AnalysisRunListQuery = PageRequest & {
  readonly state?: AnalysisRunState;
  readonly documentId?: number;
};

export type SseSubscriptionHandlers<T extends { event: string; data: unknown }> = {
  readonly onEvent?: (event: T) => void;
  readonly onError?: (error: Event | Error) => void;
  readonly signal?: AbortSignal;
};

export const analysisSseEventNames = [
  "analysis.run.state",
  "analysis.proposal.bundle",
  "analysis.failure",
  "analysis.heartbeat",
] as const satisfies readonly AnalysisSseEvent["event"][];

export type AnalysisSseEventMap = SseEventMap<AnalysisSseEvent>;

export const decodeAnalysisSseEvent = (event: MessageEvent<string>): AnalysisSseEvent =>
  parseSsePayload<AnalysisSseEvent>(event.type, event.data, analysisSseEventNames);

export const analysisApi = {
  startRun: (body: AnalysisRunStartBody, options?: RequestInit) =>
    fetchApi<AnalysisRunAccepted>("/api/analysis/runs", {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  listRuns: (query: AnalysisRunListQuery = {}, options?: RequestInit) =>
    fetchApi<AnalysisRunPage>(
      appendQuery("/api/analysis/runs", {
        cursor: query.cursor,
        limit: query.limit,
        state: query.state,
        documentId: query.documentId,
      }),
      { ...options, method: "GET" },
    ),
  getRun: (runId: string, options?: RequestInit) =>
    fetchApi<AnalysisRun>(`/api/analysis/runs/${encodeURIComponent(runId)}`, {
      ...options,
      method: "GET",
    }),
  listProposals: (runId: string, query: PageRequest = {}, options?: RequestInit) =>
    fetchApi<AnalysisProposalPage>(
      appendQuery(`/api/analysis/runs/${encodeURIComponent(runId)}/proposals`, query),
      { ...options, method: "GET" },
    ),
  applyProposal: (runId: string, body: AnalysisProposalApplyBody, options?: RequestInit) =>
    fetchApi<AnalysisProposalApplyAccepted>(
      `/api/analysis/runs/${encodeURIComponent(runId)}/apply`,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  rejectProposal: (runId: string, body: AnalysisDecisionBody, options?: RequestInit) =>
    fetchApi<AnalysisActionAccepted>(`/api/analysis/runs/${encodeURIComponent(runId)}/reject`, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  retryRun: (runId: string, body: AnalysisRetryBody, options?: RequestInit) =>
    fetchApi<AnalysisActionAccepted>(`/api/analysis/runs/${encodeURIComponent(runId)}/retry`, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  cancelRun: (runId: string, body: AnalysisCancelBody, options?: RequestInit) =>
    fetchApi<AnalysisActionAccepted>(`/api/analysis/runs/${encodeURIComponent(runId)}/cancel`, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  forceOcr: (runId: string, body: AnalysisForceOcrBody, options?: RequestInit) =>
    fetchApi<AnalysisActionAccepted>(`/api/analysis/runs/${encodeURIComponent(runId)}/force-ocr`, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  listReviewQueue: (query: PageRequest = {}, options?: RequestInit) =>
    fetchApi<AnalysisReviewQueuePage>(appendQuery("/api/analysis/review", query), {
      ...options,
      method: "GET",
    }),
  listFailures: (query: PageRequest = {}, options?: RequestInit) =>
    fetchApi<AnalysisFailureQueuePage>(appendQuery("/api/analysis/failed", query), {
      ...options,
      method: "GET",
    }),
  selectRandomCycle: (body: RandomCycleSelectBody, options?: RequestInit) =>
    fetchApi<RandomCycleSelectAccepted>("/api/analysis/random-cycle/select", {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  resetRandomCycle: (body: RandomCycleResetBody, options?: RequestInit) =>
    fetchApi<AnalysisActionAccepted>("/api/analysis/random-cycle/reset", {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  streamProgress: (
    runId: string,
    handlers: SseSubscriptionHandlers<AnalysisSseEvent> = {},
  ): EventSource => {
    const source = new EventSource(
      `${API_BASE}/api/analysis/runs/${encodeURIComponent(runId)}/progress`,
    );
    return addSseListeners(source, analysisSseEventNames, decodeAnalysisSseEvent, handlers);
  },
};

export type CatalogEpochListQuery = PageRequest & {
  readonly state?: CatalogState;
  readonly kind?: CatalogEntityKind;
};

export const catalogSseEventNames = [
  "catalog.epoch.state",
  "catalog.candidate.created",
  "catalog.evidence.recorded",
  "catalog.apply.journal",
  "catalog.heartbeat",
] as const satisfies readonly CatalogSseEvent["event"][];

export type CatalogSseEventMap = SseEventMap<CatalogSseEvent>;

export const decodeCatalogSseEvent = (event: MessageEvent<string>): CatalogSseEvent =>
  parseSsePayload<CatalogSseEvent>(event.type, event.data, catalogSseEventNames);

export const catalogWorkbenchApi = {
  startEpoch: (body: CatalogEpochStartBody, options?: RequestInit) =>
    fetchApi<CatalogEpochAccepted>("/api/catalog/epochs", {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  // Side-effect-free hydration of the current catalog precondition, so the first
  // manual epoch (no prior epoch) can source its expectedPaperlessCatalogHash.
  getCurrentCatalogHash: (scope: readonly CatalogEntityKind[], options?: RequestInit) =>
    fetchApi<CatalogCurrentHash>(
      `/api/catalog/current-hash?${scope.map((kind) => `kind=${encodeURIComponent(kind)}`).join("&")}`,
      { ...options, method: "GET" },
    ),
  listEpochs: (query: CatalogEpochListQuery = {}, options?: RequestInit) =>
    fetchApi<CatalogEpochPage>(
      appendQuery("/api/catalog/epochs", {
        cursor: query.cursor,
        limit: query.limit,
        state: query.state,
        kind: query.kind,
      }),
      { ...options, method: "GET" },
    ),
  getEpoch: (epochId: string, options?: RequestInit) =>
    fetchApi<CatalogEpoch>(`/api/catalog/epochs/${encodeURIComponent(epochId)}`, {
      ...options,
      method: "GET",
    }),
  cancelEpoch: (epochId: string, body: CatalogCancelBody, options?: RequestInit) =>
    fetchApi<CatalogActionAccepted>(`/api/catalog/epochs/${encodeURIComponent(epochId)}/cancel`, {
      ...options,
      method: "POST",
      body: JSON.stringify(body),
    }),
  listCandidates: (epochId: string, query: PageRequest = {}, options?: RequestInit) =>
    fetchApi<CatalogCandidatePage>(
      appendQuery(`/api/catalog/epochs/${encodeURIComponent(epochId)}/candidates`, query),
      { ...options, method: "GET" },
    ),
  listEvidence: (epochId: string, query: PageRequest = {}, options?: RequestInit) =>
    fetchApi<CouncilEvidencePage>(
      appendQuery(`/api/catalog/epochs/${encodeURIComponent(epochId)}/evidence`, query),
      { ...options, method: "GET" },
    ),
  listProposals: (epochId: string, query: PageRequest = {}, options?: RequestInit) =>
    fetchApi<CatalogProposalPage>(
      appendQuery(`/api/catalog/epochs/${encodeURIComponent(epochId)}/proposals`, query),
      { ...options, method: "GET" },
    ),
  approveProposal: (proposalId: string, body: CatalogProposalDecisionBody, options?: RequestInit) =>
    fetchApi<CatalogActionAccepted>(
      `/api/catalog/proposals/${encodeURIComponent(proposalId)}/approve`,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  rejectProposal: (proposalId: string, body: CatalogProposalDecisionBody, options?: RequestInit) =>
    fetchApi<CatalogActionAccepted>(
      `/api/catalog/proposals/${encodeURIComponent(proposalId)}/reject`,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  applyProposal: (proposalId: string, body: CatalogApplyBody, options?: RequestInit) =>
    fetchApi<CatalogApplyAccepted>(
      `/api/catalog/proposals/${encodeURIComponent(proposalId)}/apply`,
      {
        ...options,
        method: "POST",
        body: JSON.stringify(body),
      },
    ),
  getApplyJournal: (proposalId: string, options?: RequestInit) =>
    fetchApi<ApplyJournal>(
      `/api/catalog/proposals/${encodeURIComponent(proposalId)}/apply-journal`,
      {
        ...options,
        method: "GET",
      },
    ),
  streamEpochEvents: (
    epochId: string,
    handlers: SseSubscriptionHandlers<CatalogSseEvent> = {},
  ): EventSource => {
    const source = new EventSource(
      `${API_BASE}/api/catalog/epochs/${encodeURIComponent(epochId)}/events`,
    );
    return addSseListeners(source, catalogSseEventNames, decodeCatalogSseEvent, handlers);
  },
};

// Metadata API
export const metadataApi = {
  listCustomFields: () => fetchApi<CustomFieldMetadata[]>("/api/metadata/custom-fields"),
};

// Chat API
export const chatApi = {
  send: (messages: ChatMessage[]) =>
    fetchApi<ChatResponse>("/api/chat", {
      method: "POST",
      body: JSON.stringify({ messages }),
    }),
};

// Types
