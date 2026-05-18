import { act, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../app/page";
import { GlobalStatusProvider } from "../lib/global-status";

const i18nMock = vi.hoisted(() => {
  const messages: Record<string, string> = {
    "common.apiKeyConfigured": "API key configured",
    "common.checking": "Checking",
    "common.connected": "Connected",
    "common.disconnected": "Disconnected",
    "common.notConfigured": "Not configured",
    "common.refresh": "Refresh",
    "dashboard.allSystemsOnline": "All systems online",
    "dashboard.casesNeedingInput": "Cases needing input",
    "dashboard.casesNeedingInputDesc": "Cases waiting for a human answer",
    "dashboard.currentlyProcessing": "Currently processing",
    "dashboard.documentCases": "Document cases",
    "dashboard.documentsBeingProcessed": "Documents being processed",
    "dashboard.failedToFetchQueue": "Failed to fetch queue",
    "dashboard.fullyProcessed": "Fully processed",
    "dashboard.inPaperless": "In Paperless",
    "dashboard.inPipeline": "In pipeline",
    "dashboard.model": "Model",
    "dashboard.ocr": "OCR",
    "dashboard.ollamaActive": "Ollama active",
    "dashboard.serviceConnections": "Service connections",
    "dashboard.someServicesOffline": "Some services offline",
    "dashboard.step": "Step",
    "dashboard.subtitle": "Document processing overview",
    "dashboard.title": "Dashboard",
    "dashboard.totalDocuments": "Total documents",
    "dashboard.unableToConnect": "Unable to connect",
    "dashboard.viewDocument": "View document",
    "services.mistral": "Mistral",
    "services.ollama": "Ollama",
    "services.paperless": "Paperless",
    "services.qdrant": "Qdrant",
  };
  const fns = new Map<string, (key: string, values?: Record<string, unknown>) => string>();
  return {
    useTranslations: (namespace: string) => {
      if (!fns.has(namespace)) {
        fns.set(namespace, (key: string, values?: Record<string, unknown>) => {
          const template = messages[`${namespace}.${key}`] ?? key;
          return values
            ? template.replace(/\{(\w+)\}/g, (_, name) => String(values[name] ?? ""))
            : template;
        });
      }
      return fns.get(namespace);
    },
  };
});

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("next-intl", () => ({
  useTranslations: i18nMock.useTranslations,
}));

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const okPayloads: Record<string, unknown> = {
  "/api/settings": {
    paperless_url: "http://paperless.local",
    ollama_url: "http://ollama.local",
    qdrant_url: "http://qdrant.local",
    mistral_api_key: "configured",
  },
  "/api/documents/queue": {
    pending: 2,
    ocr_done: 1,
    title_done: 0,
    correspondent_done: 0,
    document_type_done: 0,
    tags_done: 0,
    processed: 8,
    total_in_pipeline: 7,
    total_documents: 42,
  },
  "/api/cases": {
    cases: [
      {
        id: "case-1",
        docId: 10,
        docTitle: "Needs answer",
        phase: "metadata",
        automationStatus: "needs_input",
        activeRunId: null,
        lastRunId: null,
        lastFailure: null,
        questions: [{ id: "q1", status: "open" }],
        answers: [],
        finalDecisions: {},
        runSummaries: [],
        memory: {},
        transcript: [],
        createdAt: "2026-05-15T10:00:00.000Z",
        updatedAt: "2026-05-15T10:00:00.000Z",
      },
      {
        id: "case-2",
        docId: 11,
        docTitle: "Done",
        phase: "done",
        automationStatus: "done",
        activeRunId: null,
        lastRunId: null,
        lastFailure: null,
        questions: [],
        answers: [],
        finalDecisions: {},
        runSummaries: [],
        memory: {},
        transcript: [],
        createdAt: "2026-05-15T10:00:00.000Z",
        updatedAt: "2026-05-15T10:00:00.000Z",
      },
    ],
  },
  "/api/processing/auto/status": {
    running: true,
    enabled: true,
    interval_minutes: 5,
    include_untagged: false,
    queue_length: 7,
    last_check_at: "2026-05-15T10:00:00.000Z",
    currently_processing_doc_id: 99,
    currently_processing_doc_title: "Invoice 123",
    current_step: "metadata",
    processed_since_start: 4,
    errors_since_start: 0,
  },
  "/api/settings/ollama/status": {
    running: true,
    models: [
      {
        name: "llama3",
        model: "llama3",
        size: 1,
        size_vram: 1,
        expires_at: "2026-05-15T10:00:00.000Z",
        parameter_size: null,
        quantization: null,
      },
    ],
  },
};

const installDashboardFetch = (overrides: Record<string, Response> = {}) => {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const url = String(input);
    if (overrides[url]) return overrides[url];
    if (url.startsWith("/api/settings/test-connection/")) {
      return jsonResponse({ status: "success" });
    }
    const payload = okPayloads[url];
    if (payload) return jsonResponse(payload);
    return jsonResponse({ error: `Unhandled ${url}` }, 404);
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

describe("Dashboard", () => {
  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("loads queue, case, processing, and service state", async () => {
    installDashboardFetch();

    render(
      <GlobalStatusProvider>
        <Dashboard />
      </GlobalStatusProvider>,
    );

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("42")).toBeInTheDocument());
    expect(screen.getByText("7")).toBeInTheDocument();
    expect(screen.getByText("Invoice 123")).toBeInTheDocument();
    expect(screen.getByText("Cases needing input")).toBeInTheDocument();
    expect(screen.getAllByText("Connected")).toHaveLength(4);
  });

  it("does not duplicate centralized global status polling", async () => {
    vi.useFakeTimers();
    const fetchMock = installDashboardFetch();

    render(
      <GlobalStatusProvider>
        <Dashboard />
      </GlobalStatusProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/documents/queue")).toHaveLength(1);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/processing/auto/status")).toHaveLength(
      1,
    );
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/settings/ollama/status")).toHaveLength(
      1,
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/documents/queue")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/processing/auto/status")).toHaveLength(
      2,
    );
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/settings/ollama/status")).toHaveLength(
      2,
    );
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/cases")).toHaveLength(2);
  });

  it("surfaces a recoverable queue error banner", async () => {
    installDashboardFetch({
      "/api/documents/queue": jsonResponse({ error: "Paperless unavailable" }, 503),
    });

    render(
      <GlobalStatusProvider>
        <Dashboard />
      </GlobalStatusProvider>,
    );

    expect(await screen.findByText("Failed to fetch queue")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /refresh/i })).toBeEnabled();
  });
});
