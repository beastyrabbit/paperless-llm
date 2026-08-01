/**
 * Small presentational primitives shared across the workbench and catalog
 * optimization shells. Grounded, product-normal styling: one emerald accent,
 * restrained borders and radii, no glow/gradient/blur, no decorative status dots.
 */
import { cn } from "@repo/ui";
import type { ReactNode } from "react";
import type { Tone } from "./analysis-model";

const TONE_BADGE: Record<Tone, string> = {
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-700 dark:bg-zinc-800/60 dark:text-zinc-300",
  info: "border-sky-200 bg-sky-50 text-sky-800 dark:border-sky-900 dark:bg-sky-950/50 dark:text-sky-300",
  warn: "border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900 dark:bg-amber-950/50 dark:text-amber-300",
  danger: "border-red-200 bg-red-50 text-red-800 dark:border-red-900 dark:bg-red-950/50 dark:text-red-300",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900 dark:bg-emerald-950/50 dark:text-emerald-300",
};

export function StatusBadge({
  tone = "neutral",
  children,
  className,
}: {
  tone?: Tone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium",
        TONE_BADGE[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

const TONE_BAR: Record<Tone, string> = {
  neutral: "bg-zinc-400 dark:bg-zinc-500",
  info: "bg-sky-500",
  warn: "bg-amber-500",
  danger: "bg-red-500",
  success: "bg-emerald-500",
};

/**
 * A labeled meter for a real bounded value (confidence, coverage). Renders a
 * value track — never a fake/animated progress bar. `valueLabel` is always shown
 * as text so the meter is legible without color.
 */
export function Meter({
  percent,
  tone = "info",
  label,
  valueLabel,
  className,
}: {
  percent: number;
  tone?: Tone;
  label: string;
  valueLabel: string;
  className?: string;
}) {
  const clamped = Math.max(0, Math.min(100, percent));
  return (
    <div className={cn("space-y-1", className)}>
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="text-zinc-500 dark:text-zinc-400">{label}</span>
        <span className="font-medium tabular-nums text-zinc-800 dark:text-zinc-200">{valueLabel}</span>
      </div>
      <meter className="sr-only" min={0} max={100} value={clamped} aria-label={`${label}: ${valueLabel}`}>
        {valueLabel}
      </meter>
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-200 dark:bg-zinc-800"
        aria-hidden="true"
      >
        <div className={cn("h-full rounded-full", TONE_BAR[tone])} style={{ width: `${clamped}%` }} />
      </div>
    </div>
  );
}

export function SectionHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div className="min-w-0">
        <h2 className="text-sm font-semibold tracking-tight text-zinc-900 dark:text-zinc-100">{title}</h2>
        {description ? <p className="mt-0.5 text-xs text-zinc-500 dark:text-zinc-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}

export function EmptyState({
  title,
  description,
  icon,
  action,
}: {
  title: string;
  description?: string;
  icon?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-zinc-300 bg-white px-6 py-12 text-center dark:border-zinc-700 dark:bg-zinc-900">
      {icon ? <div className="text-zinc-400 dark:text-zinc-500">{icon}</div> : null}
      <p className="text-sm font-medium text-zinc-700 dark:text-zinc-200">{title}</p>
      {description ? <p className="max-w-sm text-xs text-zinc-500 dark:text-zinc-400">{description}</p> : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

const NOTICE_TONE: Record<Tone, string> = {
  neutral: "border-zinc-200 bg-zinc-50 text-zinc-700 dark:border-zinc-800 dark:bg-zinc-900 dark:text-zinc-300",
  info: "border-sky-200 bg-sky-50 text-sky-900 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-200",
  warn: "border-amber-200 bg-amber-50 text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200",
  danger: "border-red-200 bg-red-50 text-red-900 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200",
  success:
    "border-emerald-200 bg-emerald-50 text-emerald-900 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-200",
};

/** A degraded / stale / informational banner. `role="status"` keeps it announced. */
export function Notice({
  tone = "warn",
  title,
  children,
  icon,
}: {
  tone?: Tone;
  title: string;
  children?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className={cn("flex gap-3 rounded-lg border px-3 py-2.5 text-sm", NOTICE_TONE[tone])} role="status">
      {icon ? <div className="mt-0.5 shrink-0">{icon}</div> : null}
      <div className="min-w-0 space-y-0.5">
        <p className="font-medium">{title}</p>
        {children ? <div className="text-xs opacity-90">{children}</div> : null}
      </div>
    </div>
  );
}

/** Monospace hash preview, truncated with the full value in the title attribute. */
export function HashChip({ hash, label }: { hash: string; label?: string }) {
  return (
    <code
      className="rounded bg-zinc-100 px-1.5 py-0.5 font-mono text-[11px] text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
      title={label ? `${label}: ${hash}` : hash}
    >
      {hash.slice(0, 10)}…
    </code>
  );
}
