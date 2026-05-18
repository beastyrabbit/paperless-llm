import { expect, type Page, type Route, test } from "@playwright/test";

const caseWithQuestion = {
  id: "case-10",
  docId: 10,
  docTitle: "Needs answer",
  phase: "metadata",
  automationStatus: "needs_input",
  activeRunId: null,
  lastRunId: null,
  lastFailure: null,
  questions: [
    {
      id: "q1",
      caseId: "case-10",
      docId: 10,
      kind: "metadata_proposal",
      entityKind: "tag",
      candidate: { id: null, name: "Tax", exists: false, metadata: {} },
      alternatives: [],
      requestedAction: "create",
      evidence: "The document mentions tax filing.",
      status: "open",
      source: "agent",
      metadata: {},
      createdAt: "2026-05-15T10:00:00.000Z",
      answeredAt: null,
    },
  ],
  answers: [],
  finalDecisions: {},
  runSummaries: [],
  memory: {},
  transcript: [],
  createdAt: "2026-05-15T10:00:00.000Z",
  updatedAt: "2026-05-15T10:00:00.000Z",
};

const answeredCase = {
  ...caseWithQuestion,
  automationStatus: "done",
  questions: [{ ...caseWithQuestion.questions[0], status: "answered" }],
  answers: [
    {
      id: "answer-1",
      caseId: "case-10",
      questionId: "q1",
      docId: 10,
      answer: "apply",
      guidance: null,
      selectedCandidate: caseWithQuestion.questions[0].candidate,
      metadataPatch: null,
      createdAt: "2026-05-15T10:01:00.000Z",
    },
  ],
};

const documentDetail = {
  id: 10,
  title: "Needs answer",
  correspondent: "Example Corp",
  correspondent_id: 1,
  document_type: "Invoice",
  document_type_id: 1,
  created: "2026-05-15",
  modified: "2026-05-15",
  added: "2026-05-15",
  tags: [{ id: 1, name: "llm-metadata" }],
  processing_status: "metadata",
  custom_fields: [],
  content: "Tax filing document content",
  original_file_name: "tax.pdf",
  archive_serial_number: null,
};

const fulfillJson = (route: Route, body: unknown, status = 200) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

const mockApi = async (page: Page) => {
  let answered = false;
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;

    if (path === "/api/settings") {
      return fulfillJson(route, {
        paperless_url: "http://paperless.local",
        paperless_external_url: "http://paperless.local",
        ollama_url: "http://ollama.local",
        qdrant_url: "http://qdrant.local",
        mistral_api_key: "configured",
      });
    }
    if (path === "/api/documents/queue") {
      return fulfillJson(route, {
        pending: 1,
        ocr_done: 0,
        title_done: 0,
        correspondent_done: 0,
        document_type_done: 0,
        tags_done: 0,
        processed: 0,
        total_in_pipeline: 1,
        total_documents: 1,
      });
    }
    if (path === "/api/settings/ollama/status") {
      return fulfillJson(route, { running: false, models: [] });
    }
    if (path === "/api/processing/auto/status") {
      return fulfillJson(route, {
        running: true,
        enabled: true,
        interval_minutes: 5,
        include_untagged: false,
        queue_length: 1,
        last_check_at: "2026-05-15T10:00:00.000Z",
        currently_processing_doc_id: null,
        currently_processing_doc_title: null,
        current_step: null,
        processed_since_start: 0,
        errors_since_start: 0,
      });
    }
    if (path.startsWith("/api/settings/test-connection/")) {
      return fulfillJson(route, { status: "success" });
    }
    if (path === "/api/cases") {
      return fulfillJson(route, {
        cases: url.searchParams.get("status") === "needs_input" ? [] : [caseWithQuestion],
      });
    }
    if (path === "/api/documents/10") {
      return fulfillJson(route, documentDetail);
    }
    if (path === "/api/cases/document/10") {
      return fulfillJson(route, answered ? answeredCase : caseWithQuestion);
    }
    if (path === "/api/pending/search-entities") {
      return fulfillJson(route, { correspondents: [], document_types: [], tags: [] });
    }
    if (path === "/api/cases/questions/q1/answer" && request.method() === "POST") {
      expect(request.postDataJSON()).toMatchObject({ answer: "apply" });
      answered = true;
      return fulfillJson(route, answeredCase);
    }
    if (path === "/api/cases/document/10/run" && request.method() === "POST") {
      expect(request.postDataJSON()).toMatchObject({ resume: true });
      return fulfillJson(route, { case: answeredCase, result: { status: "done" } });
    }

    return fulfillJson(route, { error: `Unhandled ${path}` }, 404);
  });
};

test("dashboard queue drill-down opens the filtered cases view", async ({ page }) => {
  await mockApi(page);

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible();
  await page.getByRole("link", { name: /Document Cases/ }).click();

  await expect(page).toHaveURL(/\/cases\?status=open/);
  await expect(page.getByRole("heading", { name: "Cases" })).toBeVisible();
  await expect(page.getByText("Needs answer")).toBeVisible();
});

test("manual review flow answers an open case question", async ({ page }) => {
  await mockApi(page);

  await page.goto("/documents/10?review=1#case");
  await expect(page.getByText("Fast Review On")).toBeVisible();
  await expect(page.getByText("Tax", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Apply" }).click();

  await expect(
    page.getByText("No more document questions in the fast review queue."),
  ).toBeVisible();
  await expect(page.getByText("0 open")).toBeVisible();
});
