/**
 * Paginated list of an epoch's raw candidates (pre-council). Mirrors the
 * cursor-paged `catalogWorkbenchApi.listCandidates` shape with a fixture-backed
 * "load more" that reveals one page at a time.
 */
"use client";

import { Button } from "@repo/ui";
import type { CatalogCandidate } from "@repo/api-contracts";
import { HashChip, StatusBadge } from "@/components/workbench/ui";
import { operationLabel, operationTone } from "./council-model";

/**
 * Candidate entity display prefers the live Paperless name hydrated on the
 * transient receipt (`x.name` / `y.name`), keeping the id visible; falls back to
 * `#id` when the name is unknown.
 */
const receiptLabel = (receipt: CatalogCandidate["x"]): string =>
  receipt.name ? `${receipt.name} (#${receipt.entityId})` : `#${receipt.entityId}`;

function CandidateRow({ candidate }: { candidate: CatalogCandidate }) {
  const source = receiptLabel(candidate.x);
  const target =
    candidate.y != null
      ? `${source} → ${receiptLabel(candidate.y)}`
      : candidate.proposedValue != null
        ? `${source} → “${candidate.proposedValue}”`
        : source;

  return (
    <li className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge tone={operationTone(candidate.intendedAction)}>
            {operationLabel(candidate.intendedAction)}
          </StatusBadge>
          <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">{target}</span>
          <span className="text-xs uppercase tracking-wide text-zinc-400">{candidate.kind}</span>
        </div>
        <span className="font-mono text-[11px] text-zinc-400">{candidate.candidateId}</span>
      </div>
      <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">{candidate.rationale}</p>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
        <span className="tabular-nums">
          {candidate.x.receiptCount} receipts{candidate.y != null ? ` · ${candidate.y.receiptCount} target` : ""}
        </span>
        <HashChip hash={candidate.expectedProposalFingerprint} label="expectedProposalFingerprint" />
      </div>
    </li>
  );
}

/**
 * Presentational candidate list. Pagination is server-driven: the parent loads
 * additional pages via `catalogWorkbenchApi.listCandidates` and passes
 * `hasMore` / `loading` / `onLoadMore` through.
 */
export function CandidateList({
  candidates,
  hasMore,
  loading = false,
  onLoadMore,
}: {
  candidates: readonly CatalogCandidate[];
  hasMore: boolean;
  loading?: boolean;
  onLoadMore: () => void;
}) {
  if (candidates.length === 0) {
    return (
      <p className="rounded-lg border border-dashed border-zinc-300 px-3 py-4 text-center text-xs text-zinc-500 dark:border-zinc-700">
        No candidates were generated for this epoch.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <ul className="space-y-2">
        {candidates.map((candidate) => (
          <CandidateRow key={candidate.candidateId} candidate={candidate} />
        ))}
      </ul>
      <div className="flex items-center justify-between text-xs text-zinc-500">
        <span className="tabular-nums">{candidates.length} loaded</span>
        {hasMore ? (
          <Button size="sm" variant="outline" onClick={onLoadMore} disabled={loading}>
            {loading ? "Loading…" : "Load more"}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
