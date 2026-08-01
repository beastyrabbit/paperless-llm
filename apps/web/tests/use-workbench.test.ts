import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AnalysisProposalProjection, AnalysisRun, Sha256Digest } from "@repo/api-contracts";

const h = (seed: string): Sha256Digest => {
  const base = `${seed.replace(/[^a-f0-9]/g, "")}00000000`.slice(0, 8);
  return base.repeat(8) as Sha256Digest;
};

const mocks = vi.hoisted(() => ({
  startRun: vi.fn(),
  listRuns: vi.fn(),
  getRun: vi.fn(),
  listProposals: vi.fn(),
  applyProposal: vi.fn(),
  rejectProposal: vi.fn(),
  forceOcr: vi.fn(),
  selectRandomCycle: vi.fn(),
  streamProgress: vi.fn(),
  documentsGet: vi.fn(),
  listCustomFields: vi.fn(),
  lastHandlers: null as { onEvent?: (e: unknown) => void } | null,
}));

vi.mock("@/lib/api", () => ({
  analysisApi: {
    startRun: mocks.startRun,
    listRuns: mocks.listRuns,
    getRun: mocks.getRun,
    listProposals: mocks.listProposals,
    applyProposal: mocks.applyProposal,
    rejectProposal: mocks.rejectProposal,
    forceOcr: mocks.forceOcr,
    selectRandomCycle: mocks.selectRandomCycle,
    streamProgress: (_runId: string, handlers: { onEvent?: (e: unknown) => void }) => {
      mocks.lastHandlers = handlers;
      return { close: vi.fn() } as unknown as EventSource;
    },
  },
  documentsApi: { get: mocks.documentsGet },
  metadataApi: { listCustomFields: mocks.listCustomFields },
}));

import { useWorkbench } from "../components/workbench/use-workbench";

const run: AnalysisRun = {
  runId: "ana_run_new",
  state: "awaiting_review",
  documentId: 4821 as AnalysisRun["documentId"],
  forceOcr: false,
  sourcePdfHash: h("50urce01"),
  documentStateHash: h("de11ad22"),
  createdAt: "2026-07-22T09:12:40Z",
  updatedAt: "2026-07-22T09:14:05Z",
  completedAt: null,
  retryCount: 0,
  failure: null,
};

const projection: AnalysisProposalProjection = {
  proposalId: "prop_new",
  runId: "ana_run_new",
  documentId: 4821 as AnalysisRun["documentId"],
  proposalHash: h("aa11bb22"),
  evidenceAvailability: "available",
  proposed: {
    title: "Utility invoice",
    correspondentId: null,
    documentTypeId: null,
    ordinaryTagIds: [],
    newTagCandidates: [],
    customFields: [],
  },
  ocrPreview: { descriptor: "OCR", previewHash: h("0c17ea90"), pageCount: 1, blockCount: 4 },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [{ pageNumber: 1, blockId: "b1", quoteHash: h("e1a2b3c4") }],
      rationale: "header",
      confidence: 0.9,
    },
  ],
  confidence: 0.82,
  review: { required: true, reasons: ["low_confidence"], rationale: "held" },
  rationale: "r",
  preconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  createdAt: "2026-07-22T09:14:05Z",
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  },
};

const ok = <T,>(data: T) => ({ ok: true as const, data, status: 200 });

beforeEach(() => {
  for (const value of Object.values(mocks)) {
    if (typeof value === "function") (value as ReturnType<typeof vi.fn>).mockReset?.();
  }
  mocks.lastHandlers = null;
  mocks.listRuns.mockResolvedValue(ok({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 20 } }));
  mocks.listCustomFields.mockResolvedValue(ok([{ id: 7, name: "Total", data_type: "string", extra_data: null }]));
  mocks.getRun.mockResolvedValue(ok(run));
  mocks.documentsGet.mockResolvedValue(ok({ id: 4821, tags: [], custom_fields: [] }));
  mocks.listProposals.mockResolvedValue(
    ok({ items: [projection], page: { nextCursor: null, hasNextPage: false, limit: 1 } }),
  );
  mocks.startRun.mockResolvedValue(ok({ status: 202, runId: "ana_run_new" }));
  mocks.selectRandomCycle.mockResolvedValue(ok({ status: 202, runId: "ana_run_new", documentId: 4821 }));
  mocks.applyProposal.mockResolvedValue(ok({ status: 202, runId: "ana_run_new", action: "apply" }));
  mocks.forceOcr.mockResolvedValue(ok({ status: 202, runId: "ana_run_new", action: "force_ocr" }));
});

describe("useWorkbench", () => {
  it("loads custom-field names and recent runs on mount", async () => {
    const { result } = renderHook(() => useWorkbench());
    await waitFor(() => {
      expect(mocks.listCustomFields).toHaveBeenCalled();
      expect(mocks.listRuns).toHaveBeenCalled();
      expect(result.current.catalogIndex.customFields.get(7)).toBe("Total");
    });
  });

  it("starts a direct run, hydrates it, and applies the whole bundle", async () => {
    const { result } = renderHook(() => useWorkbench());

    await act(async () => {
      await result.current.analyzeDirect(4821, false);
    });
    expect(mocks.startRun).toHaveBeenCalledWith({ documentId: 4821, forceOcr: false });

    await waitFor(() => {
      expect(result.current.run?.runId).toBe("ana_run_new");
      expect(result.current.projection?.proposalId).toBe("prop_new");
    });

    await act(async () => {
      await result.current.approve();
    });
    expect(mocks.applyProposal).toHaveBeenCalledTimes(1);
    const [runIdArg, body] = mocks.applyProposal.mock.calls[0] ?? [];
    expect(runIdArg).toBe("ana_run_new");
    expect(body.expectedProposalHash).toBe(projection.proposalHash);
    expect(typeof body.idempotencyKey).toBe("string");
    expect(result.current.notice).toMatch(/accepted/i);
  });

  it("force-OCR sends the computed run-state hash precondition", async () => {
    const { result } = renderHook(() => useWorkbench());
    await act(async () => {
      await result.current.analyzeDirect(4821, false);
    });
    await waitFor(() => expect(result.current.run?.runId).toBe("ana_run_new"));

    await act(async () => {
      await result.current.forceOcr();
    });
    expect(mocks.forceOcr).toHaveBeenCalledTimes(1);
    const [, body] = mocks.forceOcr.mock.calls[0] ?? [];
    expect(body.expectedRunStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(typeof body.idempotencyKey).toBe("string");
  });

  it("selects a random document via the random cycle", async () => {
    const { result } = renderHook(() => useWorkbench());
    await act(async () => {
      await result.current.analyzeRandom(true);
    });
    expect(mocks.selectRandomCycle).toHaveBeenCalledWith({
      cycleKey: "workbench",
      excludeDocumentIds: [],
      forceOcr: true,
    });
    await waitFor(() => expect(result.current.runId).toBe("ana_run_new"));
  });

  it("surfaces a start error", async () => {
    mocks.startRun.mockResolvedValue({ ok: false, error: "boom", status: 500 });
    const { result } = renderHook(() => useWorkbench());
    await act(async () => {
      await result.current.analyzeDirect(4821, false);
    });
    expect(result.current.error).toBe("boom");
  });
});
