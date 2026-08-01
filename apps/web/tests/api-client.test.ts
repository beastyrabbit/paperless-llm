import { afterEach, describe, expect, it, vi } from "vitest";
import type { Sha256Digest } from "../lib/api";
import {
  analysisApi,
  catalogWorkbenchApi,
  decodeAnalysisSseEvent,
  decodeCatalogSseEvent,
} from "../lib/api";

const digest = "a".repeat(64) as Sha256Digest;
const otherDigest = "b".repeat(64) as Sha256Digest;
const now = "2026-07-22T12:00:00Z";

const jsonResponse = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: {
      "content-type": "application/json",
      ...Object.fromEntries(new Headers(init.headers)),
    },
  });

const mockFetch = (body: unknown = { ok: true }, init: ResponseInit = {}) => {
  const fn = vi.fn().mockResolvedValue(jsonResponse(body, init));
  vi.stubGlobal("fetch", fn);
  return fn;
};

const lastFetch = (fetchMock: ReturnType<typeof mockFetch>) => {
  const call = fetchMock.mock.calls.at(-1);
  if (!call) throw new Error("expected fetch to be called");
  return call as [string, RequestInit];
};

describe("analysisApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses GET and pagination params for frozen analysis query routes", async () => {
    const fetchMock = mockFetch({
      items: [],
      page: { nextCursor: null, hasNextPage: false, limit: 25 },
    });

    await analysisApi.listRuns({
      cursor: "abc",
      limit: 25,
      state: "awaiting_review",
      documentId: 42,
    });
    await analysisApi.listReviewQueue({ limit: 10 });
    await analysisApi.listFailures({ cursor: "failed", limit: 5 });
    await analysisApi.listProposals("ana_run_review", { limit: 3 });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/analysis/runs?cursor=abc&limit=25&state=awaiting_review&documentId=42", "GET"],
      ["/api/analysis/review?limit=10", "GET"],
      ["/api/analysis/failed?cursor=failed&limit=5", "GET"],
      ["/api/analysis/runs/ana_run_review/proposals?limit=3", "GET"],
    ]);
  });

  it("sends expected fingerprints and idempotency keys on analysis commands", async () => {
    const fetchMock = mockFetch(
      { status: 202, runId: "ana_run_review", action: "apply", taskUrl: "/task", acceptedAt: now },
      { status: 202 },
    );
    const body = {
      expectedProposalHash: digest,
      idempotencyKey: "analysis-apply-key",
      reason: "approved by reviewer",
    };

    await analysisApi.applyProposal("ana_run_review", body);
    await analysisApi.rejectProposal("ana_run_review", body);
    await analysisApi.retryRun("ana_run_review", {
      expectedRunStateHash: otherDigest,
      idempotencyKey: "analysis-retry-key",
      forceOcr: true,
    });
    await analysisApi.cancelRun("ana_run_review", {
      expectedRunStateHash: otherDigest,
      idempotencyKey: "analysis-cancel-key",
    });
    await analysisApi.forceOcr("ana_run_review", {
      expectedRunStateHash: otherDigest,
      idempotencyKey: "analysis-force-key",
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/analysis/runs/ana_run_review/apply", "POST"],
      ["/api/analysis/runs/ana_run_review/reject", "POST"],
      ["/api/analysis/runs/ana_run_review/retry", "POST"],
      ["/api/analysis/runs/ana_run_review/cancel", "POST"],
      ["/api/analysis/runs/ana_run_review/force-ocr", "POST"],
    ]);
    expect(JSON.parse(String(lastFetch(fetchMock)[1].body))).toEqual({
      expectedRunStateHash: otherDigest,
      idempotencyKey: "analysis-force-key",
    });
  });

  it("passes AbortSignal through typed requests and preserves typed error status", async () => {
    const controller = new AbortController();
    const fetchMock = mockFetch(
      {
        status: 409,
        code: "STALE_PRECONDITION",
        message: "Run changed before apply.",
        issues: [{ path: ["expectedProposalHash"], message: "stale", code: "stale" }],
      },
      { status: 409 },
    );

    const result = await analysisApi.applyProposal(
      "ana_run_review",
      { expectedProposalHash: digest, idempotencyKey: "analysis-error-key" },
      { signal: controller.signal },
    );

    expect(lastFetch(fetchMock)?.[1].signal).toBe(controller.signal);
    expect(result).toMatchObject({
      ok: false,
      status: 409,
      typedError: { status: 409, code: "STALE_PRECONDITION" },
      issues: [{ path: ["expectedProposalHash"] }],
    });
  });
});

describe("catalogWorkbenchApi", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("uses GET and pagination params for frozen catalog query routes", async () => {
    const fetchMock = mockFetch({
      items: [],
      page: { nextCursor: null, hasNextPage: false, limit: 20 },
    });

    await catalogWorkbenchApi.listEpochs({
      cursor: "cat",
      limit: 20,
      state: "proposed",
      kind: "tag",
    });
    await catalogWorkbenchApi.getEpoch("cat_epoch_1");
    await catalogWorkbenchApi.listCandidates("cat_epoch_1", { limit: 5 });
    await catalogWorkbenchApi.listEvidence("cat_epoch_1", { cursor: "ev", limit: 6 });
    await catalogWorkbenchApi.listProposals("cat_epoch_1", { limit: 7 });
    await catalogWorkbenchApi.getApplyJournal("prop_1");

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/catalog/epochs?cursor=cat&limit=20&state=proposed&kind=tag", "GET"],
      ["/api/catalog/epochs/cat_epoch_1", "GET"],
      ["/api/catalog/epochs/cat_epoch_1/candidates?limit=5", "GET"],
      ["/api/catalog/epochs/cat_epoch_1/evidence?cursor=ev&limit=6", "GET"],
      ["/api/catalog/epochs/cat_epoch_1/proposals?limit=7", "GET"],
      ["/api/catalog/proposals/prop_1/apply-journal", "GET"],
    ]);
  });

  it("sends expected proposal and evidence fingerprints on catalog commands", async () => {
    const fetchMock = mockFetch(
      { status: 202, epochId: "cat_epoch_1", action: "apply", taskUrl: "/task", acceptedAt: now },
      { status: 202 },
    );

    await catalogWorkbenchApi.startEpoch({
      scope: ["tag", "correspondent"],
      expectedPaperlessCatalogHash: digest,
      runtime: "codex_cli",
      idempotencyKey: "catalog-start-key",
    });
    await catalogWorkbenchApi.cancelEpoch("cat_epoch_1", {
      expectedEpochStateHash: otherDigest,
      idempotencyKey: "catalog-cancel-key",
    });
    await catalogWorkbenchApi.approveProposal("prop_1", {
      expectedProposalFingerprint: digest,
      idempotencyKey: "catalog-approve-key",
    });
    await catalogWorkbenchApi.rejectProposal("prop_1", {
      expectedProposalFingerprint: digest,
      idempotencyKey: "catalog-reject-key",
    });
    await catalogWorkbenchApi.applyProposal("prop_1", {
      expectedProposalFingerprint: digest,
      expectedEvidenceFingerprint: otherDigest,
      idempotencyKey: "catalog-apply-key",
      dryRun: true,
    });

    expect(fetchMock.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      ["/api/catalog/epochs", "POST"],
      ["/api/catalog/epochs/cat_epoch_1/cancel", "POST"],
      ["/api/catalog/proposals/prop_1/approve", "POST"],
      ["/api/catalog/proposals/prop_1/reject", "POST"],
      ["/api/catalog/proposals/prop_1/apply", "POST"],
    ]);
    expect(JSON.parse(String(lastFetch(fetchMock)[1].body))).toEqual({
      expectedProposalFingerprint: digest,
      expectedEvidenceFingerprint: otherDigest,
      idempotencyKey: "catalog-apply-key",
      dryRun: true,
    });
  });
});

describe("SSE decoding", () => {
  it("decodes named analysis and catalog events from raw or enveloped payloads", () => {
    expect(
      decodeAnalysisSseEvent({
        type: "analysis.heartbeat",
        data: JSON.stringify({ runId: "ana_run_1", emittedAt: now }),
      } as MessageEvent<string>),
    ).toEqual({
      event: "analysis.heartbeat",
      data: { runId: "ana_run_1", emittedAt: now },
    });

    expect(
      decodeCatalogSseEvent({
        type: "message",
        data: JSON.stringify({
          event: "catalog.heartbeat",
          data: { epochId: "cat_epoch_1", emittedAt: now },
        }),
      } as MessageEvent<string>),
    ).toEqual({
      event: "catalog.heartbeat",
      data: { epochId: "cat_epoch_1", emittedAt: now },
    });
  });

  it("closes subscribed EventSource streams when aborted", () => {
    const close = vi.fn();
    class TestEventSource {
      onerror: ((event: Event) => void) | null = null;
      readonly url: string;
      constructor(url: string) {
        this.url = url;
      }
      addEventListener() {}
      close = close;
    }
    vi.stubGlobal("EventSource", TestEventSource);
    const controller = new AbortController();

    const source = analysisApi.streamProgress("ana_run_1", { signal: controller.signal });
    expect((source as EventSource & { url: string }).url).toBe(
      "/api/analysis/runs/ana_run_1/progress",
    );
    const catalogSource = catalogWorkbenchApi.streamEpochEvents("cat_epoch_1", {
      signal: controller.signal,
    });
    expect((catalogSource as EventSource & { url: string }).url).toBe(
      "/api/catalog/epochs/cat_epoch_1/events",
    );
    controller.abort();

    expect(close).toHaveBeenCalledTimes(2);
  });
});
