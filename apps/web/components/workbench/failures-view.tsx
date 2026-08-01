"use client";

/**
 * Failure recovery — failed analysis runs grouped by whether a retry can recover
 * them, with sanitized cause / stage / retry history and the recovery actions
 * that apply to each.
 *
 * Wired to `GET /api/analysis/failed`. Retry / force-OCR / cancel are issued
 * against the command API; each needs the run's optimistic-concurrency token,
 * which we recompute from a fresh `GET /api/analysis/runs/{id}` at action time.
 * A stale token comes back as 409 and is surfaced as a "run changed — refresh"
 * conflict rather than a silent no-op. Document titles hydrate live from Paperless.
 */
import { Button } from "@repo/ui";
import {
  AlertCircle,
  CheckCircle2,
  Loader2,
  PartyPopper,
  PauseCircle,
  RefreshCw,
  RotateCw,
  ScanLine,
} from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  bucketFailures,
  failureMeta,
  getRecoveryOptions,
  isRecoverable,
  type RecoveryAction,
  severityTone,
} from "@/components/workbench/failure-model";
import { analysisRunStateHash, newIdempotencyKey } from "@/components/workbench/run-state-hash";
import { EmptyState, HashChip, Notice, StatusBadge } from "@/components/workbench/ui";
import { usePaperlessHydration } from "@/components/workbench/use-paperless-hydration";
import { WorkbenchNav } from "@/components/workbench/workbench-nav";
import type { AnalysisFailureQueuePage } from "@/lib/api";
import { analysisApi } from "@/lib/api";

type FailureItem = AnalysisFailureQueuePage["items"][number];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: readonly FailureItem[] };

/** Per-run action feedback so a conflict or a pending retry is shown inline. */
interface RunFeedback {
  readonly pending?: RecoveryAction;
  readonly error?: string;
  readonly notice?: string;
}

const RETRY_HISTORY = (retryCount: number): string =>
  retryCount === 0
    ? "No prior retries"
    : `${retryCount} prior retr${retryCount === 1 ? "y" : "ies"}`;

/** Explicit runtime-condition chip so degraded / stale runs read at a glance. */
const STATE_CHIP: Partial<Record<string, { label: string; tone: "warn" | "info" }>> = {
  degraded: { label: "Degraded dependency", tone: "warn" },
  stale: { label: "Stale state", tone: "warn" },
  transient: { label: "Transient", tone: "info" },
};

function RecoveryActions({
  item,
  feedback,
  onAction,
}: {
  item: FailureItem;
  feedback: RunFeedback;
  onAction: (item: FailureItem, action: RecoveryAction) => void;
}) {
  const options = getRecoveryOptions(item);
  const busy = feedback.pending !== undefined;

  return (
    <div className="flex flex-wrap gap-2">
      {options.map((option) => {
        if (option.action === "inspect") {
          return (
            <Button key={option.action} asChild size="sm" variant="ghost">
              <Link href={`/workbench/runs/${encodeURIComponent(item.runId)}`}>{option.label}</Link>
            </Button>
          );
        }
        if (option.destructive) {
          return (
            <ConfirmActionDialog
              key={option.action}
              title="Cancel this run?"
              description={`${option.description} This cannot be undone.`}
              confirmLabel="Cancel run"
              cancelLabel="Keep run"
              confirmVariant="destructive"
              disabled={busy}
              onConfirm={() => onAction(item, option.action)}
            >
              <Button size="sm" variant="outline" disabled={busy}>
                {option.label}
              </Button>
            </ConfirmActionDialog>
          );
        }
        const isPending = feedback.pending === option.action;
        return (
          <Button
            key={option.action}
            size="sm"
            variant={option.primary ? "default" : "outline"}
            title={option.description}
            disabled={busy}
            onClick={() => onAction(item, option.action)}
          >
            {isPending ? (
              <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
            ) : option.action === "force_ocr" ? (
              <ScanLine className="mr-1.5 h-4 w-4" />
            ) : (
              <RotateCw className="mr-1.5 h-4 w-4" />
            )}
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function FailureCard({
  item,
  title,
  feedback,
  onAction,
}: {
  item: FailureItem;
  title?: string;
  feedback: RunFeedback;
  onAction: (item: FailureItem, action: RecoveryAction) => void;
}) {
  const meta = failureMeta(item.failure.code);
  const paused = !isRecoverable(item);
  const stateChip = STATE_CHIP[meta.severity];

  return (
    <li className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-medium text-zinc-800 dark:text-zinc-200">
              {title ?? `#${item.documentId}`}
            </span>
            <StatusBadge tone={severityTone(meta.severity)}>{meta.label}</StatusBadge>
            {stateChip ? <StatusBadge tone={stateChip.tone}>{stateChip.label}</StatusBadge> : null}
            {paused ? (
              <StatusBadge tone="neutral">
                <PauseCircle className="h-3.5 w-3.5" />
                Paused
              </StatusBadge>
            ) : null}
            <code className="font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
              {item.failure.code}
            </code>
            {item.failure.provider ? (
              <span className="text-xs text-zinc-400">stage: {item.failure.provider}</span>
            ) : null}
          </div>
          <p className="mt-1 font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
            #{item.documentId} · {item.runId}
          </p>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{item.failure.message}</p>
          <p className="mt-1 text-xs text-zinc-500">
            {meta.hint} · {RETRY_HISTORY(item.retryCount)}
          </p>
          {item.failure.preconditions?.length ? (
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-zinc-400">Preconditions:</span>
              {item.failure.preconditions.map((precondition) => (
                <HashChip
                  key={precondition.digest}
                  hash={precondition.digest}
                  label={precondition.kind}
                />
              ))}
            </div>
          ) : null}
        </div>
      </div>

      {paused ? (
        <div className="mt-3 rounded-md border border-zinc-200 bg-zinc-50 px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-800/40">
          <div className="flex flex-wrap items-center gap-1.5">
            <PauseCircle className="h-3.5 w-3.5 text-zinc-400" />
            <span className="font-medium text-zinc-600 dark:text-zinc-300">
              Paused — no automatic retry
            </span>
          </div>
          <p className="mt-1 text-zinc-500">
            Pause trigger:{" "}
            <code className="font-mono text-[11px] text-zinc-600 dark:text-zinc-400">
              {item.failure.code}
            </code>{" "}
            · {meta.hint}
          </p>
          {item.failure.preconditions?.length ? (
            <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
              <span className="text-zinc-400">Locks held:</span>
              {item.failure.preconditions.map((precondition) => (
                <HashChip
                  key={precondition.digest}
                  hash={precondition.digest}
                  label={precondition.kind}
                />
              ))}
            </div>
          ) : (
            <p className="mt-1 text-zinc-400">No identity locks recorded for this pause.</p>
          )}
        </div>
      ) : null}

      {feedback.notice ? (
        <div className="mt-3">
          <Notice tone="info" title={feedback.notice} icon={<CheckCircle2 className="h-4 w-4" />} />
        </div>
      ) : null}
      {feedback.error ? (
        <div className="mt-3">
          <Notice tone="danger" title={feedback.error} icon={<AlertCircle className="h-4 w-4" />} />
        </div>
      ) : null}

      <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        <RecoveryActions item={item} feedback={feedback} onAction={onAction} />
      </div>
    </li>
  );
}

export function FailuresView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [feedback, setFeedback] = useState<Record<string, RunFeedback>>({});

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading" });
    const response = await analysisApi.listFailures({}, { signal });
    if (signal?.aborted) return;
    if (response.ok) {
      setState({ status: "ready", items: response.data.items });
    } else {
      setState({ status: "error", message: response.error });
    }
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const runRecovery = useCallback(
    async (item: FailureItem, action: RecoveryAction) => {
      setFeedback((current) => ({
        ...current,
        [item.runId]: { pending: action },
      }));

      // Recompute the optimistic-concurrency token from the live run so the
      // command is checked against the current state, not a stale queue row.
      const runResponse = await analysisApi.getRun(item.runId);
      if (!runResponse.ok) {
        setFeedback((current) => ({
          ...current,
          [item.runId]: {
            error:
              runResponse.status === 404
                ? "This run no longer exists. Refreshing the queue."
                : `Could not read the run: ${runResponse.error}`,
          },
        }));
        await load();
        return;
      }

      const expectedRunStateHash = analysisRunStateHash(runResponse.data);
      const idempotencyKey = newIdempotencyKey();

      const result =
        action === "retry"
          ? await analysisApi.retryRun(item.runId, { expectedRunStateHash, idempotencyKey })
          : action === "force_ocr"
            ? await analysisApi.forceOcr(item.runId, { expectedRunStateHash, idempotencyKey })
            : action === "cancel"
              ? await analysisApi.cancelRun(item.runId, { expectedRunStateHash, idempotencyKey })
              : null;

      if (!result) {
        setFeedback((current) => ({ ...current, [item.runId]: {} }));
        return;
      }

      if (result.ok) {
        const label =
          action === "retry"
            ? "Retry accepted"
            : action === "force_ocr"
              ? "Fresh OCR accepted"
              : "Cancellation accepted";
        setFeedback((current) => ({ ...current, [item.runId]: { notice: label } }));
        await load();
        return;
      }

      const conflict = result.status === 409;
      setFeedback((current) => ({
        ...current,
        [item.runId]: {
          error: conflict
            ? "Expected-identity conflict: the run's state token changed since this view loaded. Refreshed — check the current state and try again."
            : `Action failed: ${result.error}`,
        },
      }));
      if (conflict) await load();
    },
    [load],
  );

  const items = state.status === "ready" ? state.items : [];
  const documentIds = useMemo(() => items.map((item) => item.documentId), [items]);
  const documents = usePaperlessHydration(documentIds);
  const buckets = useMemo(() => bucketFailures(items), [items]);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="px-6 py-5 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Failure recovery</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Failed runs grouped by whether a retry can recover them.
              </p>
            </div>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void load()}
              disabled={state.status === "loading"}
            >
              <RefreshCw
                className={`mr-1.5 h-4 w-4 ${state.status === "loading" ? "animate-spin" : ""}`}
              />
              Refresh
            </Button>
          </div>
          <div className="mt-4">
            <WorkbenchNav counts={{ "/workbench/failures": items.length }} />
          </div>
        </div>
      </header>

      <main className="space-y-5 px-6 py-6 md:px-8">
        {state.status === "loading" ? (
          <div
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white py-12 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading failed runs…
          </div>
        ) : state.status === "error" ? (
          <Notice
            tone="danger"
            title="Could not load failed runs"
            icon={<AlertCircle className="h-4 w-4" />}
          >
            <p className="mb-2">{state.message}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </Notice>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<PartyPopper className="h-8 w-8" />}
            title="No failed runs"
            description="Every run has completed or is still in progress."
          />
        ) : (
          <>
            <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <dt className="text-xs text-zinc-500">Recoverable</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
                  {buckets.recoverable}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <dt className="text-xs text-zinc-500">Stale state</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-amber-600 dark:text-amber-400">
                  {buckets.stale}
                </dd>
              </div>
              <div className="rounded-lg border border-zinc-200 bg-white p-3 dark:border-zinc-800 dark:bg-zinc-900">
                <dt className="text-xs text-zinc-500">Permanent</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums text-red-600 dark:text-red-400">
                  {buckets.permanent}
                </dd>
              </div>
            </dl>

            <ul className="space-y-3">
              {items.map((item) => (
                <FailureCard
                  key={item.runId}
                  item={item}
                  title={documents[item.documentId]?.title}
                  feedback={feedback[item.runId] ?? {}}
                  onAction={(target, action) => void runRecovery(target, action)}
                />
              ))}
            </ul>

            {buckets.stale > 0 ? (
              <Notice
                tone="warn"
                title="Stale runs need a fresh read"
                icon={<ScanLine className="h-4 w-4" />}
              >
                Runs marked stale were computed against a document state that has since changed.
                Retrying recomputes them against the current state; forcing OCR also re-reads the
                source PDF.
              </Notice>
            ) : null}
          </>
        )}
      </main>
    </div>
  );
}
