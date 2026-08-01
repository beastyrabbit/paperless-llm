import { expect, type Page, test } from "@playwright/test";

const readiness = {
  status: "ready",
  analysisReady: true,
  configurationSource: "environment",
  mutationMode: "paperless_first",
  scanner: {
    scope: "disabled",
    aiAnalyseTagId: 115,
    canaryDocumentCount: 0,
  },
  providers: {
    paperless: { configured: true, url: "http://paperless.test" },
    mistral: { configured: true, model: "mistral-ocr-latest" },
    ollama: {
      configured: true,
      url: "http://ollama.test",
      model: "gpt-oss:120b",
      embeddingModel: "qwen3-embedding:8b",
    },
    qdrant: {
      configured: true,
      url: "http://qdrant.test",
      collection: "paperless-documents",
      embeddingDimension: 4096,
    },
  },
  codex: {
    model: "gpt-5.6-sol",
    documentReasoningEffort: "medium",
    catalogReviewerReasoningEffort: "high",
    catalogChairReasoningEffort: "xhigh",
  },
  tools: {
    codex: { status: "available", version: "codex 0.145.0", authenticated: true },
    ocrmypdf: { status: "available", version: "17.8.0" },
  },
  blockers: [],
  checkedAt: "2026-07-23T18:00:00.000Z",
};

const capabilities = {
  supportsOriginalContent: true,
  supportsVersionContent: true,
  supportsFullPagination: true,
  supportsBulkOperations: true,
  supportsTaskPolling: true,
  supportsNotes: true,
  supportsMutationRereads: true,
  supportsConditionalPreconditions: true,
};

const settings = {
  paperless_url: "http://paperless.test",
  paperless_external_url: "http://paperless.test",
  paperless_token_configured: true,
  ollama_url: "http://ollama.test",
  ollama_model: "gpt-oss:120b",
  ollama_embedding_model: "qwen3-embedding:8b",
  qdrant_url: "http://qdrant.test",
  qdrant_collection: "paperless-documents",
  qdrant_embedding_dimension: 4096,
  mistral_api_key_configured: true,
  mistral_model: "mistral-ocr-latest",
};

async function installApiMocks(page: Page) {
  await page.route("**/api/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    if (path === "/api/system/readiness") return json(readiness);
    if (path === "/api/paperless/capabilities") return json(capabilities);
    if (path === "/api/settings") return json(settings);
    if (path.startsWith("/api/settings/test-connection/")) {
      return json({ status: "success", message: "Connected", details: null });
    }
    if (path === "/api/analysis/runs") {
      return json({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 20 } });
    }
    if (path === "/api/analysis/runs/run_canary_1") {
      return json({
        runId: "run_canary_1",
        state: "analyzing",
        documentId: 73,
        forceOcr: false,
        sourcePdfHash: "ab".repeat(32),
        documentStateHash: "cd".repeat(32),
        createdAt: "2026-07-24T09:00:00Z",
        updatedAt: "2026-07-24T09:01:00Z",
        completedAt: null,
        retryCount: 0,
        failure: null,
      });
    }
    if (path === "/api/analysis/runs/run_canary_1/proposals") {
      return json({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 1 } });
    }
    if (path === "/api/analysis/runs/run_canary_1/progress") {
      return route.fulfill({
        status: 200,
        contentType: "text/event-stream",
        body: 'event: analysis.heartbeat\ndata: {"event":"analysis.heartbeat","data":{"at":"2026-07-24T09:01:00Z"}}\n\n',
      });
    }
    if (path === "/api/documents/73") {
      return json({
        id: 73,
        title: "Canary utility invoice",
        correspondent: "Stadtwerke",
        correspondent_id: 12,
        document_type: "Invoice",
        document_type_id: 9,
        created: "2026-07-01T00:00:00Z",
        modified: "2026-07-24T09:00:00Z",
        added: "2026-07-01T00:00:00Z",
        tags: [{ id: 4, name: "Utilities" }],
        processing_status: null,
        custom_fields: [],
        content: "OCR content",
        original_file_name: "invoice.pdf",
        archive_serial_number: null,
      });
    }
    if (path === "/api/metadata/custom-fields") return json([]);
    if (path === "/api/catalog/epochs") {
      return json({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 5 } });
    }
    return json({ code: "NOT_FOUND", message: `Unhandled ${path}` }, 404);
  });
}

test("dashboard exposes the Paperless-first workflow and system test", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/");

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await expect(page.getByText("Paperless-first analysis is ready")).toBeVisible();
  await page.getByRole("link", { name: /Run system test/ }).click();
  await expect(page).toHaveURL(/\/system-test$/);
  await expect(page.getByRole("heading", { name: "System test" })).toBeVisible();
});

test("settings is read-only and contains only current runtime surfaces", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/settings");

  await expect(page.getByRole("heading", { name: "Settings" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Connections" })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Paperless-first runtime" })).toBeVisible();
  await expect(page.getByRole("button", { name: /save settings/i })).toHaveCount(0);
  await expect(page.getByText("gpt-oss:120b", { exact: false })).toBeVisible();
  await expect(page.getByText("paperless-documents", { exact: false })).toBeVisible();
});

test("system test runs all six provider-free preflight checks", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/system-test");

  await page.getByRole("button", { name: "Run all checks" }).click();
  await expect(page.getByText("6/6")).toBeVisible();
  await expect(page.getByRole("button", { name: "Pick random & start" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Start specific document" })).toBeDisabled();
  await page.getByLabel("Paperless document ID").fill("42");
  await expect(page.getByRole("button", { name: "Start specific document" })).toBeEnabled();
});

test("single canary run has a stable detailed validation page", async ({ page }) => {
  await installApiMocks(page);
  await page.goto("/workbench/runs/run_canary_1");

  await expect(page.getByRole("heading", { name: "Canary run validation" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Canary utility invoice" })).toBeVisible();
  await expect(page.getByText("Stadtwerke")).toBeVisible();
  await expect(page.getByText("Utilities")).toBeVisible();
  await expect(page.getByText(/Scanner scope:/)).toContainText("disabled");
  await expect(page.getByRole("heading", { name: "Pipeline progress" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Run facts" })).toBeVisible();
});

test("removed legacy UI routes stay removed", async ({ page }) => {
  for (const retiredRoute of [
    "/cases",
    "/pending",
    "/catalog",
    "/tags",
    "/settings/blocked",
    "/settings/custom-fields",
    "/settings/jobs",
    "/documents/42/log",
    "/documents/42/process",
  ]) {
    const response = await page.goto(retiredRoute);
    expect(response?.status(), retiredRoute).toBe(404);
  }
});
