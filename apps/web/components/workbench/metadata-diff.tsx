/**
 * Dense metadata / OCR diff between the document's current Paperless metadata
 * and the proposed values. Before → after per field, with per-field confidence
 * and evidence counts. Reads legibly without color (labels, not just tints).
 */

import type { AnalysisProposal, AnalysisProposalProjection } from "@repo/api-contracts";
import { cn } from "@repo/ui";
import { ArrowRight } from "lucide-react";
import {
  confidenceTone,
  type DiffValue,
  formatConfidence,
  getMetadataDiffRows,
  type MetadataDiffRow,
} from "./analysis-model";
import { Meter } from "./ui";
import type { DocumentBaseline, EntityLabels } from "./view-types";

const KIND_LABEL: Record<MetadataDiffRow["kind"], string> = {
  unchanged: "Unchanged",
  changed: "Changed",
  added: "Added",
  removed: "Removed",
};

const KIND_CLASS: Record<MetadataDiffRow["kind"], string> = {
  unchanged: "text-zinc-400 dark:text-zinc-500",
  changed: "text-amber-700 dark:text-amber-400",
  added: "text-emerald-700 dark:text-emerald-400",
  removed: "text-red-700 dark:text-red-400",
};

function ValueList({ values, side }: { values: readonly DiffValue[]; side: "before" | "after" }) {
  if (values.length === 0) {
    return <span className="text-xs italic text-zinc-400 dark:text-zinc-600">none</span>;
  }
  // Tag-style chips when values carry ids; plain text otherwise.
  if (values.every((value) => value.id != null)) {
    return (
      <div className="flex flex-wrap gap-1">
        {values.map((value) => (
          <span
            key={value.id}
            className={cn(
              "inline-flex items-center rounded border px-1.5 py-0.5 text-xs",
              side === "after" && value.isNew
                ? "border-emerald-300 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300"
                : "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
            )}
          >
            {value.display}
          </span>
        ))}
      </div>
    );
  }
  return (
    <span
      className={cn(
        "text-sm",
        side === "before" ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-800 dark:text-zinc-100",
      )}
    >
      {values.map((value) => value.display).join(", ")}
    </span>
  );
}

export function MetadataDiff({
  baseline,
  proposal,
  labels,
}: {
  baseline: DocumentBaseline;
  proposal: AnalysisProposal | AnalysisProposalProjection;
  labels: EntityLabels;
}) {
  const rows = getMetadataDiffRows(baseline, proposal, labels);

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[36rem] border-collapse text-left">
        <thead>
          <tr className="border-b border-zinc-200 text-xs uppercase tracking-wide text-zinc-500 dark:border-zinc-800 dark:text-zinc-400">
            <th scope="col" className="py-2 pr-3 font-medium">
              Field
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Current
            </th>
            <th scope="col" className="w-6 py-2">
              <span className="sr-only">Change</span>
            </th>
            <th scope="col" className="px-3 py-2 font-medium">
              Proposed
            </th>
            <th scope="col" className="py-2 pl-3 font-medium">
              Confidence
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100 dark:divide-zinc-800/70">
          {rows.map((row) => (
            <tr key={row.key} className="align-top">
              <th scope="row" className="py-3 pr-3 font-medium text-zinc-700 dark:text-zinc-300">
                <span>{row.label}</span>
                <span className={cn("mt-1 block text-xs font-normal", KIND_CLASS[row.kind])}>
                  {KIND_LABEL[row.kind]}
                  {row.evidenceCount > 0 ? (
                    <span className="text-zinc-400 dark:text-zinc-600">
                      {" "}
                      · {row.evidenceCount} evidence
                    </span>
                  ) : null}
                </span>
              </th>
              <td className="px-3 py-3">
                <ValueList values={row.before} side="before" />
              </td>
              <td className="py-3 text-zinc-300 dark:text-zinc-600" aria-hidden="true">
                {row.kind !== "unchanged" ? <ArrowRight className="h-4 w-4" /> : null}
              </td>
              <td className="px-3 py-3">
                <ValueList values={row.after} side="after" />
              </td>
              <td className="py-3 pl-3">
                {row.confidence == null ? (
                  <span className="text-xs text-zinc-400 dark:text-zinc-600">—</span>
                ) : (
                  <div className="w-24">
                    <Meter
                      percent={Math.round(row.confidence * 100)}
                      tone={confidenceTone(row.confidence)}
                      label="conf."
                      valueLabel={formatConfidence(row.confidence)}
                    />
                  </div>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
