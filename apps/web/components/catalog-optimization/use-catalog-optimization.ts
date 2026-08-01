/**
 * Live data + command hook for the catalog optimization workbench. All data is
 * loaded through the frozen typed `catalogWorkbenchApi` — no fixtures. Reads
 * (epochs, candidates, proposals, council evidence) are hydrated from the
 * backend; commands (start / cancel / approve / reject / apply) carry the
 * expected fingerprints and refetch on 202 acceptance or 409 conflict.
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ApiClientResponse,
  CatalogEpochListQuery,
} from "@/lib/api";
import { catalogWorkbenchApi } from "@/lib/api";
import {
  type CatalogCandidate,
  type CatalogEntityKind,
  type CatalogEpoch,
  type CatalogProposalContract,
  type CouncilEvidence,
  type PageRequest,
  type Sha256Digest,
  catalogEpochHash,
} from "@repo/api-contracts";

export type LoadState = "loading" | "ready" | "error" | "empty";

const newIdempotencyKey = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `idem-${Math.random().toString(36).slice(2)}${Math.random().toString(36).slice(2)}`;

/** Follow `nextCursor` to load every page of a small collection (bounded). */
async function collectAllPages<T>(
  fetchPage: (query: PageRequest) => Promise<ApiClientResponse<{ items: readonly T[]; page: { nextCursor: string | null; hasNextPage: boolean } }>>,
): Promise<{ ok: true; items: T[] } | { ok: false; error: string; status: number }> {
  const items: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < 25; page += 1) {
    const response = await fetchPage(cursor ? { cursor } : {});
    if (!response.ok) return { ok: false, error: response.error, status: response.status };
    items.push(...response.data.items);
    if (!response.data.page.hasNextPage || response.data.page.nextCursor == null) {
      return { ok: true, items };
    }
    cursor = response.data.page.nextCursor;
  }
  return { ok: true, items };
}

export interface CommandFeedback {
  readonly notice: string | null;
  readonly conflict: string | null;
  readonly error: string | null;
}

export interface EpochDetail {
  readonly state: LoadState;
  readonly error: string | null;
  readonly epoch: CatalogEpoch | null;
  readonly proposals: readonly CatalogProposalContract[];
  readonly evidence: readonly CouncilEvidence[];
  readonly candidates: readonly CatalogCandidate[];
  readonly candidatesLoading: boolean;
  readonly hasMoreCandidates: boolean;
}

const EMPTY_DETAIL: EpochDetail = {
  state: "loading",
  error: null,
  epoch: null,
  proposals: [],
  evidence: [],
  candidates: [],
  candidatesLoading: false,
  hasMoreCandidates: false,
};

export interface CatalogOptimizationController {
  readonly epochsState: LoadState;
  readonly epochsError: string | null;
  readonly epochs: readonly CatalogEpoch[];
  readonly selectedEpochId: string | null;
  readonly detail: EpochDetail;
  readonly busy: boolean;
  readonly feedback: CommandFeedback;
  readonly selectEpoch: (epochId: string) => void;
  readonly refresh: () => void;
  readonly loadMoreCandidates: () => void;
  readonly startEpoch: (scope: readonly CatalogEntityKind[]) => Promise<void>;
  readonly cancelEpoch: (reason: string) => Promise<void>;
  readonly approveProposal: (proposal: CatalogProposalContract, reason: string) => Promise<void>;
  readonly rejectProposal: (proposal: CatalogProposalContract, reason: string) => Promise<void>;
  readonly applyProposal: (proposal: CatalogProposalContract) => Promise<void>;
  readonly clearFeedback: () => void;
}

const NO_FEEDBACK: CommandFeedback = { notice: null, conflict: null, error: null };

const isConflict = (response: ApiClientErrorLike): boolean =>
  response.status === 409 || response.typedError?.code === "STATE_TRANSITION_CONFLICT";

interface ApiClientErrorLike {
  readonly status: number;
  readonly error: string;
  readonly typedError?: { readonly code: string } | undefined;
}

export function useCatalogOptimization(): CatalogOptimizationController {
  const [epochsState, setEpochsState] = useState<LoadState>("loading");
  const [epochsError, setEpochsError] = useState<string | null>(null);
  const [epochs, setEpochs] = useState<readonly CatalogEpoch[]>([]);
  const [selectedEpochId, setSelectedEpochId] = useState<string | null>(null);
  const [detail, setDetail] = useState<EpochDetail>(EMPTY_DETAIL);
  const [busy, setBusy] = useState(false);
  const [feedback, setFeedback] = useState<CommandFeedback>(NO_FEEDBACK);

  // Cursor for incremental candidate pagination on the selected epoch.
  const candidateCursor = useRef<string | null>(null);
  // Guards against stale detail responses overwriting a newer selection.
  const detailToken = useRef(0);

  const loadEpochs = useCallback(async (preserveSelection: boolean) => {
    setEpochsState("loading");
    const query: CatalogEpochListQuery = {};
    const response = await catalogWorkbenchApi.listEpochs(query);
    if (!response.ok) {
      setEpochsError(response.error);
      setEpochsState("error");
      return;
    }
    const items = response.data.items;
    setEpochs(items);
    setEpochsError(null);
    setEpochsState(items.length === 0 ? "empty" : "ready");
    setSelectedEpochId((current) => {
      if (preserveSelection && current && items.some((e) => e.epochId === current)) return current;
      return items[0]?.epochId ?? null;
    });
  }, []);

  const loadDetail = useCallback(async (epochId: string) => {
    detailToken.current += 1;
    const token = detailToken.current;
    candidateCursor.current = null;
    setDetail({ ...EMPTY_DETAIL, state: "loading" });

    const [epochResponse, proposalsResult, evidenceResult, candidatesResponse] = await Promise.all([
      catalogWorkbenchApi.getEpoch(epochId),
      collectAllPages<CatalogProposalContract>((q) => catalogWorkbenchApi.listProposals(epochId, q)),
      collectAllPages<CouncilEvidence>((q) => catalogWorkbenchApi.listEvidence(epochId, q)),
      catalogWorkbenchApi.listCandidates(epochId, {}),
    ]);

    if (token !== detailToken.current) return; // superseded by a newer selection

    if (!epochResponse.ok) {
      setDetail({ ...EMPTY_DETAIL, state: "error", error: epochResponse.error });
      return;
    }
    if (!proposalsResult.ok) {
      setDetail({ ...EMPTY_DETAIL, state: "error", error: proposalsResult.error });
      return;
    }
    if (!evidenceResult.ok) {
      setDetail({ ...EMPTY_DETAIL, state: "error", error: evidenceResult.error });
      return;
    }
    if (!candidatesResponse.ok) {
      setDetail({ ...EMPTY_DETAIL, state: "error", error: candidatesResponse.error });
      return;
    }

    candidateCursor.current = candidatesResponse.data.page.nextCursor;
    setDetail({
      state: "ready",
      error: null,
      epoch: epochResponse.data,
      proposals: proposalsResult.items,
      evidence: evidenceResult.items,
      candidates: candidatesResponse.data.items,
      candidatesLoading: false,
      hasMoreCandidates: candidatesResponse.data.page.hasNextPage,
    });
  }, []);

  useEffect(() => {
    void loadEpochs(false);
  }, [loadEpochs]);

  useEffect(() => {
    if (selectedEpochId) void loadDetail(selectedEpochId);
    else setDetail(EMPTY_DETAIL);
  }, [selectedEpochId, loadDetail]);

  const selectEpoch = useCallback((epochId: string) => {
    setFeedback(NO_FEEDBACK);
    setSelectedEpochId(epochId);
  }, []);

  const refresh = useCallback(() => {
    void loadEpochs(true);
    if (selectedEpochId) void loadDetail(selectedEpochId);
  }, [loadEpochs, loadDetail, selectedEpochId]);

  const loadMoreCandidates = useCallback(async () => {
    const cursor = candidateCursor.current;
    if (!selectedEpochId || cursor == null) return;
    setDetail((current) => ({ ...current, candidatesLoading: true }));
    const response = await catalogWorkbenchApi.listCandidates(selectedEpochId, { cursor });
    if (!response.ok) {
      setDetail((current) => ({ ...current, candidatesLoading: false }));
      setFeedback({ notice: null, conflict: null, error: response.error });
      return;
    }
    candidateCursor.current = response.data.page.nextCursor;
    setDetail((current) => ({
      ...current,
      candidates: [...current.candidates, ...response.data.items],
      candidatesLoading: false,
      hasMoreCandidates: response.data.page.hasNextPage,
    }));
  }, [selectedEpochId]);

  // Shared command runner: reports the accepted/conflict/error outcome and
  // always refetches so decision/apply fingerprints re-hydrate from the server.
  const runCommand = useCallback(
    async (
      label: string,
      call: () => Promise<ApiClientResponse<unknown>>,
    ): Promise<void> => {
      setBusy(true);
      setFeedback(NO_FEEDBACK);
      try {
        const response = await call();
        if (response.ok) {
          setFeedback({ notice: `${label} accepted — refreshing…`, conflict: null, error: null });
          await loadEpochs(true);
          if (selectedEpochId) await loadDetail(selectedEpochId);
          return;
        }
        if (isConflict(response)) {
          setFeedback({
            notice: null,
            conflict: `${label} rejected: the catalog state changed (409). Re-hydrated fingerprints — review and retry.`,
            error: null,
          });
          // Refetch so the operator sees the current, non-stale state.
          await loadEpochs(true);
          if (selectedEpochId) await loadDetail(selectedEpochId);
          return;
        }
        setFeedback({ notice: null, conflict: null, error: `${label} failed: ${response.error}` });
      } finally {
        setBusy(false);
      }
    },
    [loadEpochs, loadDetail, selectedEpochId],
  );

  const startEpoch = useCallback(
    async (scope: readonly CatalogEntityKind[]) => {
      if (scope.length === 0) {
        setFeedback({ notice: null, conflict: null, error: "Select at least one entity kind to scope the epoch." });
        return;
      }
      // Always hydrate the CURRENT scoped Paperless catalog hash immediately
      // before every Start. A prior epoch's hash is stale by definition once the
      // catalog changed and would trap every subsequent start in a 409, so we
      // never reuse it. The GET is side-effect-free; a real drift between this
      // observation and the epoch scan is still reported by the backend as a 409.
      const hashResponse = await catalogWorkbenchApi.getCurrentCatalogHash(scope);
      if (!hashResponse.ok) {
        setFeedback({
          notice: null,
          conflict: null,
          error: `Cannot start an epoch: could not read the current catalog hash (${hashResponse.error}).`,
        });
        return;
      }
      await runCommand("Start epoch", () =>
        catalogWorkbenchApi.startEpoch({
          scope: [...scope],
          expectedPaperlessCatalogHash: hashResponse.data.paperlessCatalogHash,
          idempotencyKey: newIdempotencyKey(),
        }),
      );
    },
    [runCommand],
  );

  const cancelEpoch = useCallback(
    async (reason: string) => {
      const epoch = detail.epoch;
      if (!epoch) return;
      const expectedEpochStateHash = catalogEpochHash(epoch) as Sha256Digest;
      await runCommand("Cancel epoch", () =>
        catalogWorkbenchApi.cancelEpoch(epoch.epochId, {
          expectedEpochStateHash,
          reason: reason.trim() ? reason.trim() : undefined,
          idempotencyKey: newIdempotencyKey(),
        }),
      );
    },
    [detail.epoch, runCommand],
  );

  const approveProposal = useCallback(
    async (proposal: CatalogProposalContract, reason: string) => {
      await runCommand("Approve", () =>
        catalogWorkbenchApi.approveProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposal.expectedProposalFingerprint,
          reason: reason.trim() ? reason.trim() : undefined,
          idempotencyKey: newIdempotencyKey(),
        }),
      );
    },
    [runCommand],
  );

  const rejectProposal = useCallback(
    async (proposal: CatalogProposalContract, reason: string) => {
      await runCommand("Reject", () =>
        catalogWorkbenchApi.rejectProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposal.expectedProposalFingerprint,
          reason: reason.trim() ? reason.trim() : undefined,
          idempotencyKey: newIdempotencyKey(),
        }),
      );
    },
    [runCommand],
  );

  const applyProposal = useCallback(
    async (proposal: CatalogProposalContract) => {
      await runCommand("Apply", () =>
        catalogWorkbenchApi.applyProposal(proposal.proposalId, {
          expectedProposalFingerprint: proposal.expectedProposalFingerprint,
          expectedEvidenceFingerprint: proposal.expectedEvidenceFingerprint,
          idempotencyKey: newIdempotencyKey(),
        }),
      );
    },
    [runCommand],
  );

  const clearFeedback = useCallback(() => setFeedback(NO_FEEDBACK), []);

  return useMemo(
    () => ({
      epochsState,
      epochsError,
      epochs,
      selectedEpochId,
      detail,
      busy,
      feedback,
      selectEpoch,
      refresh,
      loadMoreCandidates: () => void loadMoreCandidates(),
      startEpoch,
      cancelEpoch,
      approveProposal,
      rejectProposal,
      applyProposal,
      clearFeedback,
    }),
    [
      epochsState,
      epochsError,
      epochs,
      selectedEpochId,
      detail,
      busy,
      feedback,
      selectEpoch,
      refresh,
      loadMoreCandidates,
      startEpoch,
      cancelEpoch,
      approveProposal,
      rejectProposal,
      applyProposal,
      clearFeedback,
    ],
  );
}
