/**
 * Provider-free rendered QA for the Paperless-first surfaces (I3 gate 10/11).
 *
 * Every `/api/**` call is mocked in the browser, so no backend / Mistral / Codex
 * / Ollama / Paperless is contacted. Each of the four new pages is exercised at
 * desktop AND narrow (mobile) widths, including the required states: analyze
 * (202) → proposal → stale conflict, review queue, failures retry (409), and
 * catalog run / decision / apply stale conflict.
 */
import { expect, type Page, test } from "@playwright/test";
import {
  catalogCandidates,
  catalogEpochs,
  catalogProposals,
  councilEvidence,
} from "../components/catalog-optimization/fixtures";

const hex = (seed: string): string => `${seed.replace(/[^a-f0-9]/g, "")}00000000`.slice(0, 8).repeat(8);

const DESKTOP = { width: 1440, height: 900 };
const NARROW = { width: 375, height: 800 };

const documentDetail = {
  id: 4821,
  title: "Scan_2026-07-18_0007.pdf",
  correspondent: null,
  correspondent_id: null,
  document_type: null,
  document_type_id: null,
  created: "2026-07-01T00:00:00Z",
  modified: "2026-07-20T10:00:00Z",
  added: "2026-07-01T00:00:00Z",
  tags: [],
  processing_status: null,
  custom_fields: [],
  content: null,
  original_file_name: null,
  archive_serial_number: null,
};

const run = (state: string, extra: Record<string, unknown> = {}) => ({
  runId: "ana_run_e2e",
  state,
  documentId: 4821,
  forceOcr: false,
  sourcePdfHash: hex("50urce01"),
  documentStateHash: hex("de11ad22"),
  createdAt: "2026-07-22T09:12:40Z",
  updatedAt: "2026-07-22T09:14:05Z",
  completedAt: null,
  retryCount: 0,
  failure: null,
  ...extra,
});

const projection = (stale: boolean) => ({
  proposalId: "prop_e2e",
  runId: "ana_run_e2e",
  documentId: 4821,
  proposalHash: hex("aa11bb22"),
  evidenceAvailability: "available",
  proposed: {
    title: "Stadtwerke München — Utility invoice 2026-06",
    correspondentId: null,
    documentTypeId: null,
    ordinaryTagIds: [],
    newTagCandidates: [],
    customFields: [],
  },
  ocrPreview: { descriptor: "Mistral OCR · 2 pages · 41 blocks", previewHash: hex("0c17ea90"), pageCount: 2, blockCount: 41 },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [{ pageNumber: 1, blockId: "blk_p1_head_02", quoteHash: hex("e1a2b3c4") }],
      rationale: "Header block names the issuer and billing period.",
      confidence: 0.9,
    },
  ],
  confidence: 0.82,
  review: { required: true, reasons: ["low_confidence"], rationale: "Below the auto-apply threshold." },
  rationale: "Issuer, period and totals are consistent across pages.",
  preconditions: [{ kind: "paperless_document_state", digest: hex("de11ad22") }],
  createdAt: "2026-07-22T09:14:05Z",
  freshness: stale
    ? {
        status: "stale",
        stale: true,
        currentMissing: false,
        expectedPreconditions: [{ kind: "paperless_document_state", digest: hex("de11ad22") }],
        currentPreconditions: [{ kind: "paperless_document_state", digest: hex("ffffffff") }],
      }
    : {
        status: "fresh",
        stale: false,
        currentMissing: false,
        expectedPreconditions: [{ kind: "paperless_document_state", digest: hex("de11ad22") }],
      },
});

const reviewItem = {
  runId: "ana_run_e2e",
  proposalId: "prop_e2e",
  documentId: 4821,
  reasons: ["low_confidence", "new_catalog_candidate"],
  proposalHash: hex("aa11bb22"),
  createdAt: "2026-07-22T09:14:05Z",
};

const failureItem = {
  runId: "ana_run_fail",
  documentId: 4790,
  failure: {
    code: "PROVIDER_MALFORMED",
    message: "OCR provider returned a response that failed schema validation.",
    failedAt: "2026-07-22T08:22:47Z",
    retryable: true,
    provider: "mistral-ocr",
  },
  retryCount: 1,
  updatedAt: "2026-07-22T08:22:47Z",
};

const page1 = <T>(items: T[]) => ({ items, page: { nextCursor: null, hasNextPage: false, limit: 50 } });

interface MockOptions {
  readonly proposalStale?: boolean;
  readonly retryConflict?: boolean;
  readonly applyConflict?: boolean;
}

async function installApiMocks(page: Page, options: MockOptions = {}) {
  await page.route("**/api/**", async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    const path = url.pathname;
    const method = request.method();
    const json = (body: unknown, status = 200) =>
      route.fulfill({ status, contentType: "application/json", body: JSON.stringify(body) });

    // SSE streams: return an immediately-completing event stream (no events).
    if (path.endsWith("/progress") || path.endsWith("/events")) {
      return route.fulfill({ status: 200, contentType: "text/event-stream", body: ":\n\n" });
    }

    // --- analysis ---
    if (path === "/api/analysis/runs" && method === "POST") {
      return json(
        {
          status: 202,
          runId: "ana_run_e2e",
          state: "queued",
          acceptedAt: "2026-07-22T09:12:40Z",
          progressUrl: "/api/analysis/runs/ana_run_e2e/progress",
          statusUrl: "/api/analysis/runs/ana_run_e2e",
        },
        202,
      );
    }
    if (path === "/api/analysis/runs" && method === "GET") return json(page1([run("awaiting_review")]));
    if (path === "/api/analysis/runs/ana_run_e2e" && method === "GET")
      return json(run("awaiting_review"));
    if (path === "/api/analysis/runs/ana_run_fail" && method === "GET")
      return json(run("failed", { runId: "ana_run_fail", documentId: 4790, retryCount: 1, failure: failureItem.failure }));
    if (path.endsWith("/proposals") && path.includes("/analysis/runs/"))
      return json(page1([projection(options.proposalStale ?? false)]));
    if (path.endsWith("/apply") && path.includes("/analysis/runs/") && method === "POST")
      return json({ status: 202, runId: "ana_run_e2e", action: "apply", taskUrl: "/x", acceptedAt: "2026-07-22T09:14:05Z" }, 202);
    if (path.endsWith("/retry") && path.includes("/analysis/runs/") && method === "POST") {
      if (options.retryConflict) {
        return json({ status: 409, code: "STATE_TRANSITION_CONFLICT", message: "state token changed" }, 409);
      }
      return json({ status: 202, runId: "ana_run_fail", action: "retry", taskUrl: "/x", acceptedAt: "2026-07-22T09:14:05Z" }, 202);
    }
    if (path === "/api/analysis/review") return json(page1([reviewItem]));
    if (path === "/api/analysis/failed") return json(page1([failureItem]));

    // --- documents / metadata ---
    if (path.startsWith("/api/documents/")) return json({ ...documentDetail, id: Number(path.split("/").pop()) || 4821 });
    if (path === "/api/metadata/custom-fields") return json([]);
    if (path === "/api/metadata/tags") return json([]);

    // --- catalog (valid catalog_proposal_projection.v2 fixtures) ---
    if (path === "/api/catalog/epochs" && method === "GET") return json(page1([...catalogEpochs]));
    if (path.match(/\/api\/catalog\/epochs\/[^/]+$/) && method === "GET") {
      const id = path.split("/").pop();
      return json(catalogEpochs.find((epoch) => epoch.epochId === id) ?? catalogEpochs[0]);
    }
    if (path.endsWith("/proposals") && path.includes("/catalog/"))
      return json(page1([...catalogProposals]));
    if (path.endsWith("/evidence") && path.includes("/catalog/")) return json(page1([...councilEvidence]));
    if (path.endsWith("/candidates") && path.includes("/catalog/"))
      return json(page1([...catalogCandidates]));
    if (path.includes("/catalog/proposals/") && path.endsWith("/apply") && method === "POST") {
      if (options.applyConflict) {
        return json({ status: 409, code: "STALE_PRECONDITION", message: "catalog changed" }, 409);
      }
      return json({ status: 202, epochId: "cat_epoch_e2e", action: "apply", taskUrl: "/x", acceptedAt: "2026-07-22T09:14:05Z" }, 202);
    }
    if (path.includes("/catalog/proposals/") && method === "POST")
      return json({ status: 202, epochId: "cat_epoch_e2e", action: "approve", taskUrl: "/x", acceptedAt: "2026-07-22T09:14:05Z" }, 202);

    // Anything else: empty OK so no page crashes on an unmocked call.
    return json({});
  });
}

const assertNoHorizontalOverflow = async (page: Page) => {
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return doc.scrollWidth - doc.clientWidth;
  });
  // Allow a 1px rounding tolerance.
  expect(overflow).toBeLessThanOrEqual(1);
};

// --- Workbench ---------------------------------------------------------------
test.describe("workbench", () => {
  test("selects a run and shows the fresh proposal bundle with an enabled decision", async ({ page }) => {
    await installApiMocks(page);
    await page.setViewportSize(DESKTOP);
    await page.goto("/workbench");

    await expect(page.getByRole("heading", { name: "Analysis workbench" })).toBeVisible();
    await page.getByRole("button", { name: /#4821/ }).first().click();

    await expect(page.getByRole("heading", { name: "Proposal bundle" })).toBeVisible();
    await expect(page.getByText("Stadtwerke München — Utility invoice 2026-06")).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve & apply/ })).toBeEnabled();
    await assertNoHorizontalOverflow(page);
  });

  test("surfaces a stale conflict and blocks approval", async ({ page }) => {
    await installApiMocks(page, { proposalStale: true });
    await page.setViewportSize(DESKTOP);
    await page.goto("/workbench");
    await page.getByRole("button", { name: /#4821/ }).first().click();

    await expect(page.getByText(/Document changed since analysis/)).toBeVisible();
    await expect(page.getByRole("button", { name: /Approve & apply/ })).toBeDisabled();
  });

  test("accepts a direct analyze request (202) without error", async ({ page }) => {
    await installApiMocks(page);
    await page.setViewportSize(NARROW);
    await page.goto("/workbench");
    await page.getByLabel("Document ID").fill("4821");
    await page.getByRole("button", { name: "Analyze", exact: true }).click();
    await expect(page.getByText(/Action failed/)).toHaveCount(0);
    await assertNoHorizontalOverflow(page);
  });
});

// --- Review queue ------------------------------------------------------------
test.describe("workbench review queue", () => {
  for (const viewport of [DESKTOP, NARROW]) {
    test(`renders queued proposals at ${viewport.width}px`, async ({ page }) => {
      await installApiMocks(page);
      await page.setViewportSize(viewport);
      await page.goto("/workbench/review");
      await expect(page.getByRole("heading", { name: /Review/ })).toBeVisible();
      await expect(page.getByText("#4821").first()).toBeVisible();
      await assertNoHorizontalOverflow(page);
    });
  }
});

// --- Failures ----------------------------------------------------------------
test.describe("workbench failures", () => {
  test("shows a retry conflict (409) inline", async ({ page }) => {
    await installApiMocks(page, { retryConflict: true });
    await page.setViewportSize(DESKTOP);
    await page.goto("/workbench/failures");

    await expect(page.getByRole("heading", { name: /Failure/ })).toBeVisible();
    await expect(page.getByText("#4790").first()).toBeVisible();
    await page.getByRole("button", { name: /Retry/ }).first().click();
    await expect(page.getByText(/conflict/i).first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("renders at narrow width without overflow", async ({ page }) => {
    await installApiMocks(page);
    await page.setViewportSize(NARROW);
    await page.goto("/workbench/failures");
    await expect(page.getByText("#4790").first()).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});

// --- Catalog optimization ----------------------------------------------------
test.describe("catalog optimization", () => {
  test("renders proposals and surfaces an apply stale conflict (409)", async ({ page }) => {
    await installApiMocks(page, { applyConflict: true });
    await page.setViewportSize(DESKTOP);
    await page.goto("/catalog/optimization");

    await expect(page.getByRole("heading", { name: "Catalog optimization" })).toBeVisible();
    const applyButton = page.getByRole("button", { name: "Delete", exact: true }).first();
    await expect(applyButton).toBeEnabled();
    await applyButton.click();
    await page.getByRole("button", { name: /Delete now/i }).click();
    await expect(page.getByText(/Conflict \(409\)/)).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });

  test("renders at narrow width without overflow", async ({ page }) => {
    await installApiMocks(page);
    await page.setViewportSize(NARROW);
    await page.goto("/catalog/optimization");
    await expect(page.getByRole("heading", { name: "Catalog optimization" })).toBeVisible();
    await assertNoHorizontalOverflow(page);
  });
});
