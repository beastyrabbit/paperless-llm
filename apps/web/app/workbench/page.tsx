"use client";

import { Button, Input } from "@repo/ui";
import { CheckCircle2, FileText, Loader2, Play, Shuffle, X } from "lucide-react";
import { useEffect, useId, useState } from "react";
import type { AnalysisRun } from "@repo/api-contracts";
import {
  outcomeTone,
  runOutcome,
  stateLabel,
} from "@/components/workbench/analysis-model";
import { failureMeta } from "@/components/workbench/failure-model";
import { ProposalDetail } from "@/components/workbench/proposal-detail";
import { RunTimeline } from "@/components/workbench/run-timeline";
import { EmptyState, HashChip, Notice, SectionHeader, StatusBadge } from "@/components/workbench/ui";
import { useWorkbench } from "@/components/workbench/use-workbench";
import { WorkbenchNav } from "@/components/workbench/workbench-nav";

function RunListItem({
  run,
  selected,
  onSelect,
}: {
  run: AnalysisRun;
  selected: boolean;
  onSelect: () => void;
}) {
  const outcome = runOutcome(run);
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={`w-full shrink-0 rounded-lg border px-3 py-2.5 text-left transition-colors lg:w-auto ${
        selected
          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700"
      }`}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-xs text-zinc-500 dark:text-zinc-400">#{run.documentId}</span>
        <StatusBadge tone={outcomeTone(outcome)}>{stateLabel(run.state)}</StatusBadge>
      </div>
      <p className="mt-1 truncate font-mono text-[11px] text-zinc-400 dark:text-zinc-600">{run.runId}</p>
    </button>
  );
}

export default function WorkbenchPage() {
  const workbench = useWorkbench();
  const [docIdInput, setDocIdInput] = useState("");
  const [forceOcr, setForceOcr] = useState(false);
  const docIdFieldId = useId();
  const forceOcrId = useId();

  useEffect(() => {
    const initialDocumentId = new URLSearchParams(window.location.search).get("documentId");
    if (initialDocumentId && /^\d+$/.test(initialDocumentId)) {
      setDocIdInput(initialDocumentId);
    }
  }, []);

  const parsedDocId = /^\d+$/.test(docIdInput.trim()) ? Number(docIdInput.trim()) : null;
  const { run, projection, streamStatus } = workbench;
  const outcome = run ? runOutcome(run) : null;

  const submitDirect = () => {
    if (parsedDocId != null) void workbench.analyzeDirect(parsedDocId, forceOcr);
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="px-6 py-5 md:px-8">
          <h1 className="text-2xl font-semibold tracking-tight">Analysis workbench</h1>
          <p className="mt-1 text-sm text-zinc-500">
            Analyze a document, watch progress live, and approve or reject the whole proposal bundle
            against the current Paperless state.
          </p>
          <div className="mt-4">
            <WorkbenchNav />
          </div>
        </div>
      </header>

      <main className="px-6 py-6 md:px-8">
        {/* Selection controls */}
        <div className="mb-6 flex flex-wrap items-end gap-3 rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
          <div className="flex flex-col gap-1">
            <label htmlFor={docIdFieldId} className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Document ID
            </label>
            <Input
              id={docIdFieldId}
              inputMode="numeric"
              placeholder="e.g. 4821"
              value={docIdInput}
              onChange={(event) => setDocIdInput(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") submitDirect();
              }}
              className="w-40"
            />
          </div>
          <label htmlFor={forceOcrId} className="flex items-center gap-2 pb-2 text-sm text-zinc-600 dark:text-zinc-300">
            <input
              id={forceOcrId}
              type="checkbox"
              checked={forceOcr}
              onChange={(event) => setForceOcr(event.target.checked)}
              className="h-4 w-4 rounded border-zinc-300 accent-emerald-600"
            />
            Force fresh OCR
          </label>
          <Button onClick={submitDirect} disabled={parsedDocId == null || workbench.busy}>
            <Play className="mr-1.5 h-4 w-4" />
            Analyze
          </Button>
          <Button
            variant="outline"
            onClick={() => void workbench.analyzeRandom(forceOcr)}
            disabled={workbench.busy}
          >
            <Shuffle className="mr-1.5 h-4 w-4" />
            Analyze random
          </Button>
          <span
            className="ml-auto flex items-center gap-1.5 text-xs text-zinc-400"
            role="status"
            aria-live="polite"
          >
            <span
              className={`inline-block h-2 w-2 rounded-full ${
                streamStatus === "open"
                  ? "bg-emerald-500"
                  : streamStatus === "error"
                    ? "bg-red-500"
                    : streamStatus === "connecting"
                      ? "bg-amber-500"
                      : "bg-zinc-400"
              }`}
              aria-hidden="true"
            />
            stream: {streamStatus}
          </span>
        </div>

        {workbench.error ? (
          <div className="mb-4">
            <Notice tone="danger" title="Action failed" icon={<X className="h-4 w-4" />}>
              {workbench.error}
            </Notice>
          </div>
        ) : null}
        {workbench.notice ? (
          <div className="mb-4">
            <Notice tone="success" title={workbench.notice} icon={<CheckCircle2 className="h-4 w-4" />}>
              The stream will reflect the resulting state changes.
            </Notice>
          </div>
        ) : null}

        <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
          {/* Run rail */}
          <aside aria-label="Analysis runs" className="order-2 lg:order-first">
            <SectionHeader title="Recent runs" description={`${workbench.runs.length} loaded`} />
            <div className="mt-3 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
              {workbench.runs.length === 0 ? (
                <p className="text-xs text-zinc-400">No runs yet. Analyze a document to begin.</p>
              ) : (
                workbench.runs.map((item) => (
                  <RunListItem
                    key={item.runId}
                    run={item}
                    selected={item.runId === workbench.runId}
                    onSelect={() => workbench.selectRun(item.runId)}
                  />
                ))
              )}
            </div>
          </aside>

          {/* Detail */}
          <section className="order-1 min-w-0 space-y-6 lg:order-none">
            {!workbench.runId ? (
              <EmptyState
                icon={<FileText className="h-8 w-8" />}
                title="No run selected"
                description="Enter a document ID and Analyze, pick a random document, or choose a recent run."
              />
            ) : !run ? (
              <div className="flex items-center gap-2 py-10 text-sm text-zinc-500" role="status" aria-live="polite">
                <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                Loading run…
              </div>
            ) : (
              <>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="flex items-center gap-2 text-lg font-semibold">
                      <FileText className="h-5 w-5 text-zinc-400" />
                      Document #{run.documentId}
                    </h2>
                    <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                      <span className="font-mono">{run.runId}</span>
                      <span aria-hidden="true">·</span>
                      {outcome ? (
                        <StatusBadge tone={outcomeTone(outcome)}>{stateLabel(run.state)}</StatusBadge>
                      ) : null}
                      {run.forceOcr ? <StatusBadge tone="info">forced OCR</StatusBadge> : null}
                    </p>
                  </div>
                </div>

                {run.failure ? (
                  <Notice
                    tone="danger"
                    title={`${failureMeta(run.failure.code).label} · ${run.failure.code}`}
                    icon={<X className="h-4 w-4" />}
                  >
                    <p>{run.failure.message}</p>
                    <p className="mt-1">{failureMeta(run.failure.code).hint}</p>
                  </Notice>
                ) : null}

                <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
                  <div className="min-w-0 space-y-6">
                    {projection ? (
                      <ProposalDetail
                        run={run}
                        projection={projection}
                        current={workbench.current}
                        catalogIndex={workbench.catalogIndex}
                        currentLoading={workbench.currentLoading}
                        currentError={workbench.currentError}
                        busy={workbench.busy}
                        onApprove={() => void workbench.approve()}
                        onReject={() => void workbench.reject()}
                        onForceOcr={() => void workbench.forceOcr()}
                        onRefreshCurrent={() => void workbench.refreshCurrent()}
                      />
                    ) : (
                      <div className="rounded-lg border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-zinc-700">
                        {run.state === "awaiting_review"
                          ? "Loading proposal bundle…"
                          : "No proposal yet. The timeline shows the run's current progress."}
                      </div>
                    )}
                  </div>

                  <aside aria-label="Run progress" className="space-y-4">
                    <SectionHeader title="Progress" />
                    <RunTimeline run={run} />
                    <div className="space-y-1 border-t border-zinc-200 pt-3 text-xs text-zinc-500 dark:border-zinc-800">
                      <div className="flex items-center justify-between gap-2">
                        <span>Document state</span>
                        <HashChip hash={run.documentStateHash} label="documentStateHash" />
                      </div>
                      {run.sourcePdfHash ? (
                        <div className="flex items-center justify-between gap-2">
                          <span>Source PDF</span>
                          <HashChip hash={run.sourcePdfHash} label="sourcePdfHash" />
                        </div>
                      ) : null}
                      <div className="flex items-center justify-between gap-2">
                        <span>Retries</span>
                        <span className="tabular-nums text-zinc-700 dark:text-zinc-300">
                          {run.retryCount}
                        </span>
                      </div>
                    </div>
                  </aside>
                </div>
              </>
            )}
          </section>
        </div>
      </main>
    </div>
  );
}
