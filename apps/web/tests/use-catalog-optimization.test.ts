import { act, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listEpochs: vi.fn(),
  getEpoch: vi.fn(),
  listProposals: vi.fn(),
  listEvidence: vi.fn(),
  listCandidates: vi.fn(),
  getCurrentCatalogHash: vi.fn(),
  startEpoch: vi.fn(),
  cancelEpoch: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  applyProposal: vi.fn(),
}));

vi.mock("@/lib/api", () => ({
  catalogWorkbenchApi: {
    listEpochs: mocks.listEpochs,
    getEpoch: mocks.getEpoch,
    listProposals: mocks.listProposals,
    listEvidence: mocks.listEvidence,
    listCandidates: mocks.listCandidates,
    getCurrentCatalogHash: mocks.getCurrentCatalogHash,
    startEpoch: mocks.startEpoch,
    cancelEpoch: mocks.cancelEpoch,
    approveProposal: mocks.approveProposal,
    rejectProposal: mocks.rejectProposal,
    applyProposal: mocks.applyProposal,
  },
}));

import { useCatalogOptimization } from "../components/catalog-optimization/use-catalog-optimization";
import { catalogEpochs } from "../components/catalog-optimization/fixtures";

const ok = <T,>(data: T) => ({ ok: true as const, data, status: 200 });
const emptyPage = () => ok({ items: [], page: { nextCursor: null, hasNextPage: false, limit: 50 } });
const FRESH_HASH = "f".repeat(64);

beforeEach(() => {
  for (const value of Object.values(mocks)) (value as ReturnType<typeof vi.fn>).mockReset();
  mocks.getEpoch.mockResolvedValue(ok(catalogEpochs[0]));
  mocks.listProposals.mockResolvedValue(emptyPage());
  mocks.listEvidence.mockResolvedValue(emptyPage());
  mocks.listCandidates.mockResolvedValue(emptyPage());
  mocks.getCurrentCatalogHash.mockResolvedValue(ok({ paperlessCatalogHash: FRESH_HASH, scope: ["tag"] }));
  mocks.startEpoch.mockResolvedValue(ok({ status: 202, epochId: "cat_epoch_new", state: "queued" }));
});

describe("useCatalogOptimization startEpoch (gate 1: always fresh scoped hash)", () => {
  it("first-ever run (no prior epoch) sources the hash from the current-hash endpoint", async () => {
    mocks.listEpochs.mockResolvedValue(emptyPage());
    const { result } = renderHook(() => useCatalogOptimization());
    await waitFor(() => expect(mocks.listEpochs).toHaveBeenCalled());

    await act(async () => {
      await result.current.startEpoch(["tag"]);
    });

    expect(mocks.getCurrentCatalogHash).toHaveBeenCalledWith(["tag"]);
    expect(mocks.startEpoch).toHaveBeenCalledTimes(1);
    expect(mocks.startEpoch.mock.calls[0]?.[0]).toMatchObject({
      scope: ["tag"],
      expectedPaperlessCatalogHash: FRESH_HASH,
    });
  });

  it("changed-since-last-epoch uses the fresh hash, never the prior epoch's stale hash", async () => {
    // A prior epoch exists with its own (now stale) catalog hash.
    mocks.listEpochs.mockResolvedValue(
      ok({ items: [catalogEpochs[0]], page: { nextCursor: null, hasNextPage: false, limit: 50 } }),
    );
    const { result } = renderHook(() => useCatalogOptimization());
    await waitFor(() => expect(mocks.listEpochs).toHaveBeenCalled());

    await act(async () => {
      await result.current.startEpoch(["tag"]);
    });

    expect(mocks.getCurrentCatalogHash).toHaveBeenCalledWith(["tag"]);
    const body = mocks.startEpoch.mock.calls[0]?.[0];
    expect(body?.expectedPaperlessCatalogHash).toBe(FRESH_HASH);
    expect(body?.expectedPaperlessCatalogHash).not.toBe(catalogEpochs[0]?.paperlessCatalogHash);
  });

  it("surfaces a current-hash failure instead of starting the epoch", async () => {
    mocks.listEpochs.mockResolvedValue(emptyPage());
    mocks.getCurrentCatalogHash.mockResolvedValue({ ok: false, error: "catalog unavailable", status: 503 });
    const { result } = renderHook(() => useCatalogOptimization());
    await waitFor(() => expect(mocks.listEpochs).toHaveBeenCalled());

    await act(async () => {
      await result.current.startEpoch(["tag"]);
    });

    expect(mocks.startEpoch).not.toHaveBeenCalled();
    expect(result.current.feedback.error).toMatch(/could not read the current catalog hash/i);
  });
});
