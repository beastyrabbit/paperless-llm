/**
 * Vertical progress timeline for an analysis run. Renders the real pipeline
 * milestones derived from the run state machine — not an animated/fake bar.
 */
import { cn } from "@repo/ui";
import { Check, Minus, X } from "lucide-react";
import type { AnalysisRun } from "@repo/api-contracts";
import { getRunTimeline, type TimelineStepStatus } from "./analysis-model";

const STATUS_MARKER: Record<TimelineStepStatus, string> = {
  done: "border-emerald-500 bg-emerald-500 text-white",
  current: "border-emerald-500 bg-white text-emerald-600 dark:bg-zinc-900",
  pending: "border-zinc-300 bg-white text-transparent dark:border-zinc-700 dark:bg-zinc-900",
  failed: "border-red-500 bg-red-500 text-white",
  canceled: "border-zinc-400 bg-zinc-400 text-white dark:border-zinc-600 dark:bg-zinc-600",
  skipped: "border-dashed border-zinc-300 bg-white text-zinc-300 dark:border-zinc-700 dark:bg-zinc-900",
};

const STATUS_LABEL: Record<TimelineStepStatus, string> = {
  done: "done",
  current: "in progress",
  pending: "pending",
  failed: "failed",
  canceled: "canceled",
  skipped: "skipped",
};

function StepIcon({ status }: { status: TimelineStepStatus }) {
  if (status === "done") return <Check className="h-3 w-3" aria-hidden="true" />;
  if (status === "failed") return <X className="h-3 w-3" aria-hidden="true" />;
  if (status === "skipped") return <Minus className="h-3 w-3" aria-hidden="true" />;
  if (status === "current") return <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" aria-hidden="true" />;
  return null;
}

export function RunTimeline({ run }: { run: Pick<AnalysisRun, "state" | "forceOcr"> }) {
  const steps = getRunTimeline(run);

  return (
    <ol className="space-y-0">
      {steps.map((step, index) => {
        const isLast = index === steps.length - 1;
        const muted = step.status === "pending" || step.status === "skipped";
        return (
          <li key={step.key} className="flex gap-3">
            <div className="flex flex-col items-center">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2",
                  STATUS_MARKER[step.status],
                )}
              >
                <StepIcon status={step.status} />
              </span>
              {!isLast ? (
                <span
                  className={cn(
                    "w-0.5 flex-1 min-h-4",
                    step.status === "done" ? "bg-emerald-500" : "bg-zinc-200 dark:bg-zinc-800",
                  )}
                  aria-hidden="true"
                />
              ) : null}
            </div>
            <div className={cn("pb-4 pt-0.5 text-sm", muted && "text-zinc-400 dark:text-zinc-600")}>
              <span className={cn("font-medium", !muted && "text-zinc-800 dark:text-zinc-200")}>
                {step.label}
              </span>
              <span className="sr-only"> — {STATUS_LABEL[step.status]}</span>
              {step.status !== "pending" && step.status !== "done" ? (
                <span className="ml-2 text-xs uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                  {STATUS_LABEL[step.status]}
                </span>
              ) : null}
            </div>
          </li>
        );
      })}
    </ol>
  );
}
