/**
 * Async progress rail for an epoch. Projects the epoch's current state onto the
 * ordered lifecycle (queued → collecting → … → applied) so an in-flight epoch
 * reads as real progress — done / current / pending — rather than a spinner.
 */
import { Check, Loader, X } from "lucide-react";
import { cn } from "@repo/ui";
import type { CatalogEpoch } from "@repo/api-contracts";
import { epochProgress, isEpochInProgress } from "./council-model";

const DOT: Record<string, string> = {
  done: "border-emerald-500 bg-emerald-500 text-white",
  current: "border-sky-500 bg-sky-50 text-sky-600 dark:bg-sky-950",
  pending: "border-zinc-300 bg-white text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-600",
  failed: "border-red-500 bg-red-500 text-white",
  canceled: "border-zinc-400 bg-zinc-400 text-white",
};

export function EpochProgress({ epoch }: { epoch: CatalogEpoch }) {
  const steps = epochProgress(epoch.state);
  const inProgress = isEpochInProgress(epoch.state);

  return (
    <div>
      <ol className="space-y-2">
        {steps.map((cell) => (
          <li key={cell.step} className="flex items-center gap-2.5">
            <span
              className={cn(
                "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[10px]",
                DOT[cell.status],
              )}
              aria-hidden="true"
            >
              {cell.status === "done" ? (
                <Check className="h-3 w-3" />
              ) : cell.status === "failed" || cell.status === "canceled" ? (
                <X className="h-3 w-3" />
              ) : cell.status === "current" && inProgress ? (
                <Loader className="h-3 w-3 animate-spin" />
              ) : null}
            </span>
            <span
              className={cn(
                "text-xs",
                cell.status === "pending"
                  ? "text-zinc-400 dark:text-zinc-600"
                  : cell.status === "current"
                    ? "font-medium text-zinc-900 dark:text-zinc-100"
                    : "text-zinc-600 dark:text-zinc-400",
              )}
            >
              {cell.label}
            </span>
          </li>
        ))}
      </ol>
      <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-zinc-200 pt-3 text-center dark:border-zinc-800">
        {[
          ["Candidates", epoch.candidateCount],
          ["Evidence", epoch.evidenceCount],
          ["Proposals", epoch.proposalCount],
        ].map(([label, count]) => (
          <div key={label as string}>
            <dt className="text-[11px] text-zinc-500">{label}</dt>
            <dd className="text-sm font-semibold tabular-nums text-zinc-800 dark:text-zinc-200">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
