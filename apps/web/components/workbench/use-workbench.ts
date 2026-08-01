/**
 * Client wiring for the analysis workbench: document selection (direct/random),
 * the analyze + progress SSE stream, live Paperless current values, the proposal
 * projection (with freshness), and the whole-bundle approve/reject/force-OCR
 * actions. State is ephemeral React state — no TinyBase persistence of Paperless
 * rows.
 */
"use client";

import type {
  AnalysisProposalProjection,
  AnalysisRun,
  DocumentDetail,
  DocumentId,
} from "@repo/api-contracts";
import { useCallback, useEffect, useRef, useState } from "react";
import { analysisApi, documentsApi, metadataApi } from "@/lib/api";
import {
  type CatalogIndex,
  computeRunStateHash,
  emptyCatalogIndex,
  newIdempotencyKey,
} from "./bundle-model";

const RANDOM_CYCLE_KEY = "workbench";

export type StreamStatus = "idle" | "connecting" | "open" | "error" | "closed";

export interface WorkbenchState {
  readonly runId: string | null;
  readonly run: AnalysisRun | null;
  readonly runs: readonly AnalysisRun[];
  readonly projection: AnalysisProposalProjection | null;
  readonly current: DocumentDetail | null;
  readonly currentLoading: boolean;
  readonly currentError: string | null;
  readonly catalogIndex: CatalogIndex;
  readonly streamStatus: StreamStatus;
  readonly busy: boolean;
  readonly error: string | null;
  readonly notice: string | null;
  readonly analyzeDirect: (documentId: number, forceOcr: boolean) => Promise<void>;
  readonly analyzeRandom: (forceOcr: boolean) => Promise<void>;
  readonly selectRun: (runId: string) => void;
  readonly approve: () => Promise<void>;
  readonly reject: () => Promise<void>;
  readonly forceOcr: () => Promise<void>;
  readonly refreshCurrent: () => Promise<void>;
  readonly clearNotice: () => void;
}

export function useWorkbench(initialRunId?: string | null): WorkbenchState {
  const [runId, setRunId] = useState<string | null>(initialRunId?.trim() || null);
  const [run, setRun] = useState<AnalysisRun | null>(null);
  const [runs, setRuns] = useState<readonly AnalysisRun[]>([]);
  const [projection, setProjection] = useState<AnalysisProposalProjection | null>(null);
  const [current, setCurrent] = useState<DocumentDetail | null>(null);
  const [currentLoading, setCurrentLoading] = useState(false);
  const [currentError, setCurrentError] = useState<string | null>(null);
  const [catalogIndex, setCatalogIndex] = useState<CatalogIndex>(emptyCatalogIndex);
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("idle");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // Latest run kept in a ref so action callbacks read fresh state without
  // re-subscribing the stream.
  const runRef = useRef<AnalysisRun | null>(null);
  runRef.current = run;
  const projectionRef = useRef<AnalysisProposalProjection | null>(null);
  projectionRef.current = projection;

  useEffect(() => {
    if (initialRunId?.trim()) {
      setRunId(initialRunId.trim());
      return;
    }
    const queryRunId = new URLSearchParams(window.location.search).get("runId")?.trim();
    if (queryRunId) setRunId(queryRunId);
  }, [initialRunId]);

  const loadCurrent = useCallback(async (documentId: number) => {
    setCurrentLoading(true);
    setCurrentError(null);
    const response = await documentsApi.get(documentId);
    if (response.ok) {
      setCurrent(response.data);
    } else {
      setCurrentError(response.error);
    }
    setCurrentLoading(false);
  }, []);

  const loadProjection = useCallback(async (id: string) => {
    const response = await analysisApi.listProposals(id, { limit: 1 });
    if (response.ok && response.data.items.length > 0) {
      setProjection(response.data.items[0] ?? null);
    }
  }, []);

  const refreshRuns = useCallback(async () => {
    const response = await analysisApi.listRuns({ limit: 20 });
    if (response.ok) setRuns(response.data.items);
  }, []);

  // Custom-field names + recent runs, once. Tag / correspondent / document-type
  // names are resolved from the live document detail (no bulk name endpoint),
  // with a `#id` fallback in the renderer.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fields = await metadataApi.listCustomFields();
      if (cancelled) return;
      const fieldMap = new Map<number, string>();
      if (fields.ok) {
        for (const field of fields.data) {
          if (field.id != null) fieldMap.set(field.id, field.name);
        }
      }
      setCatalogIndex((previous) => ({ ...previous, customFields: fieldMap }));
    })();
    void refreshRuns();
    return () => {
      cancelled = true;
    };
  }, [refreshRuns]);

  // Subscribe to the selected run's progress stream + hydrate run/current/projection.
  useEffect(() => {
    if (!runId) return;
    let cancelled = false;
    let source: EventSource | null = null;
    setStreamStatus("connecting");
    setProjection(null);

    void (async () => {
      const response = await analysisApi.getRun(runId);
      if (cancelled) return;
      if (!response.ok) {
        setError(response.error);
        setStreamStatus("error");
        return;
      }
      setRun(response.data);
      void loadCurrent(response.data.documentId);
      if (response.data.state === "awaiting_review") void loadProjection(runId);

      source = analysisApi.streamProgress(runId, {
        onEvent: (event) => {
          if (cancelled) return;
          switch (event.event) {
            case "analysis.run.state":
              setRun(event.data);
              if (event.data.state === "awaiting_review") void loadProjection(runId);
              break;
            case "analysis.proposal.bundle":
              void loadProjection(runId);
              break;
            case "analysis.failure":
              setRun((previous) =>
                previous ? { ...previous, state: "failed", failure: event.data } : previous,
              );
              break;
            case "analysis.heartbeat":
              setStreamStatus("open");
              break;
          }
        },
        onError: () => {
          if (!cancelled) setStreamStatus("error");
        },
      });
      setStreamStatus("open");
    })();

    return () => {
      cancelled = true;
      source?.close();
      setStreamStatus("closed");
    };
  }, [runId, loadCurrent, loadProjection]);

  const analyzeDirect = useCallback(
    async (documentId: number, forceOcr: boolean) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      const response = await analysisApi.startRun({
        documentId: documentId as DocumentId,
        forceOcr,
      });
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRun(null);
      setCurrent(null);
      setRunId(response.data.runId);
      void refreshRuns();
    },
    [refreshRuns],
  );

  const analyzeRandom = useCallback(
    async (forceOcr: boolean) => {
      setError(null);
      setNotice(null);
      setBusy(true);
      const response = await analysisApi.selectRandomCycle({
        cycleKey: RANDOM_CYCLE_KEY,
        excludeDocumentIds: runs.map((item) => item.documentId),
        forceOcr,
      });
      setBusy(false);
      if (!response.ok) {
        setError(response.error);
        return;
      }
      setRun(null);
      setCurrent(null);
      setRunId(response.data.runId);
      void refreshRuns();
    },
    [runs, refreshRuns],
  );

  const selectRun = useCallback((id: string) => {
    setError(null);
    setNotice(null);
    setRun(null);
    setCurrent(null);
    setRunId(id);
  }, []);

  const runAction = useCallback(
    async (
      label: string,
      action: (run: AnalysisRun) => Promise<{ ok: boolean; error?: string }>,
    ) => {
      const activeRun = runRef.current;
      if (!activeRun) return;
      setError(null);
      setNotice(null);
      setBusy(true);
      const response = await action(activeRun);
      setBusy(false);
      if (response.ok) {
        setNotice(`${label} accepted.`);
      } else {
        setError(response.error ?? `${label} failed.`);
      }
    },
    [],
  );

  const approve = useCallback(
    () =>
      runAction("Apply", async (activeRun) => {
        const proposal = projectionRef.current;
        if (!proposal) return { ok: false, error: "No proposal to apply." };
        return analysisApi.applyProposal(activeRun.runId, {
          expectedProposalHash: proposal.proposalHash,
          idempotencyKey: newIdempotencyKey(),
        });
      }),
    [runAction],
  );

  const reject = useCallback(
    () =>
      runAction("Reject", async (activeRun) => {
        const proposal = projectionRef.current;
        if (!proposal) return { ok: false, error: "No proposal to reject." };
        return analysisApi.rejectProposal(activeRun.runId, {
          expectedProposalHash: proposal.proposalHash,
          idempotencyKey: newIdempotencyKey(),
        });
      }),
    [runAction],
  );

  const forceOcr = useCallback(
    () =>
      runAction("Force OCR", async (activeRun) =>
        analysisApi.forceOcr(activeRun.runId, {
          expectedRunStateHash: computeRunStateHash(activeRun),
          idempotencyKey: newIdempotencyKey(),
        }),
      ),
    [runAction],
  );

  const refreshCurrent = useCallback(async () => {
    const activeRun = runRef.current;
    if (activeRun) await loadCurrent(activeRun.documentId);
  }, [loadCurrent]);

  const clearNotice = useCallback(() => setNotice(null), []);

  return {
    runId,
    run,
    runs,
    projection,
    current,
    currentLoading,
    currentError,
    catalogIndex,
    streamStatus,
    busy,
    error,
    notice,
    analyzeDirect,
    analyzeRandom,
    selectRun,
    approve,
    reject,
    forceOcr,
    refreshCurrent,
    clearNotice,
  };
}
