"use client";

/**
 * Review queue — proposals held for a human decision (unusual metadata, stale
 * preconditions, more-than-5-tags, low confidence, new catalog candidates …).
 *
 * Wired to `GET /api/analysis/review`. Each entry is an evidence-first bundle
 * (see review-bundle.tsx): live Paperless title hydration, exact reasons, the
 * evidence/freshness bundle on demand, and whole-bundle approve/reject actions.
 * Loading / empty / error states are handled here so the page stays a thin shell.
 */
import { Button } from "@repo/ui";
import { AlertCircle, Inbox, Loader2, RefreshCw } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ReviewBundleRow } from "@/components/workbench/review-bundle";
import { EmptyState, Notice } from "@/components/workbench/ui";
import { usePaperlessHydration } from "@/components/workbench/use-paperless-hydration";
import { WorkbenchNav } from "@/components/workbench/workbench-nav";
import type { AnalysisReviewQueuePage } from "@/lib/api";
import { analysisApi } from "@/lib/api";

type ReviewItem = AnalysisReviewQueuePage["items"][number];

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; items: readonly ReviewItem[] };

export function ReviewQueueView() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  const load = useCallback(async (signal?: AbortSignal) => {
    setState({ status: "loading" });
    const response = await analysisApi.listReviewQueue({}, { signal });
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

  const items = state.status === "ready" ? state.items : [];
  const documentIds = useMemo(() => items.map((item) => item.documentId), [items]);
  const documents = usePaperlessHydration(documentIds);

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="px-6 py-5 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Review queue</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Proposals held for a human decision, with the reason each was flagged and the
                evidence behind it.
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
            <WorkbenchNav counts={{ "/workbench/review": items.length }} />
          </div>
        </div>
      </header>

      <main className="px-6 py-6 md:px-8">
        {state.status === "loading" ? (
          <div
            className="flex items-center justify-center gap-2 rounded-lg border border-zinc-200 bg-white py-12 text-sm text-zinc-500 dark:border-zinc-800 dark:bg-zinc-900"
            role="status"
          >
            <Loader2 className="h-4 w-4 animate-spin" />
            Loading review queue…
          </div>
        ) : state.status === "error" ? (
          <Notice
            tone="danger"
            title="Could not load the review queue"
            icon={<AlertCircle className="h-4 w-4" />}
          >
            <p className="mb-2">{state.message}</p>
            <Button size="sm" variant="outline" onClick={() => void load()}>
              Try again
            </Button>
          </Notice>
        ) : items.length === 0 ? (
          <EmptyState
            icon={<Inbox className="h-8 w-8" />}
            title="Nothing to review"
            description="Proposals that meet the auto-apply thresholds are applied without landing here."
          />
        ) : (
          <ul className="space-y-3">
            {items.map((item) => (
              <ReviewBundleRow
                key={item.proposalId}
                item={item}
                title={documents[item.documentId]?.title}
                onDecided={() => load()}
              />
            ))}
          </ul>
        )}
      </main>
    </div>
  );
}
