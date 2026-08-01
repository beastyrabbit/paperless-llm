/**
 * Pure view-model helpers for the failure-recovery shell. No React / network.
 */
import type { AnalysisFailure } from "@repo/api-contracts";
import type { Tone } from "./analysis-model";
import type { AnalysisFailureQueueItem } from "./view-types";

export type FailureCode = AnalysisFailure["code"];

/**
 * How a failure should be presented. `degraded` failures are transient /
 * environmental (retry once the dependency recovers); `stale` failures mean the
 * underlying Paperless state moved and the run must be recomputed; `permanent`
 * failures will not resolve on retry.
 */
export type FailureSeverity = "degraded" | "stale" | "transient" | "permanent";

interface FailureMeta {
  readonly severity: FailureSeverity;
  readonly label: string;
  readonly hint: string;
}

const FAILURE_META: Record<FailureCode, FailureMeta> = {
  PAPERLESS_UNAVAILABLE: {
    severity: "degraded",
    label: "Paperless unavailable",
    hint: "Paperless-ngx was unreachable. Retry once the service is healthy.",
  },
  SOURCE_HASH_MISMATCH: {
    severity: "stale",
    label: "Source changed",
    hint: "The source PDF no longer matches the analyzed bytes. Re-run with a fresh read.",
  },
  STALE_PRECONDITION: {
    severity: "stale",
    label: "Stale precondition",
    hint: "Document state changed after analysis. Recompute against the current state.",
  },
  PROVIDER_MALFORMED: {
    severity: "transient",
    label: "Provider response malformed",
    hint: "The provider returned an invalid payload. A retry may succeed.",
  },
  PROVIDER_FAILURE: {
    severity: "degraded",
    label: "Provider failure",
    hint: "The upstream provider errored. Retry after it recovers.",
  },
  STORAGE_POLICY_VIOLATION: {
    severity: "permanent",
    label: "Storage policy violation",
    hint: "The result violated a storage policy and cannot be applied as-is.",
  },
  STATE_TRANSITION_CONFLICT: {
    severity: "stale",
    label: "State transition conflict",
    hint: "Another actor changed the run state. Reload before acting again.",
  },
  CANCELED: {
    severity: "permanent",
    label: "Canceled",
    hint: "This run was canceled. Start a new analysis if needed.",
  },
  RETRY_EXHAUSTED: {
    severity: "permanent",
    label: "Retries exhausted",
    hint: "The retry budget is spent. Investigate before forcing another attempt.",
  },
  REJECTED: {
    severity: "permanent",
    label: "Rejected",
    hint: "A reviewer rejected the proposal. No metadata was written.",
  },
  UNKNOWN: {
    severity: "transient",
    label: "Unknown error",
    hint: "The failure could not be classified. Inspect logs before retrying.",
  },
};

export const failureMeta = (code: FailureCode): FailureMeta =>
  FAILURE_META[code] ?? FAILURE_META.UNKNOWN;

const SEVERITY_TONE: Record<FailureSeverity, Tone> = {
  degraded: "warn",
  stale: "warn",
  transient: "info",
  permanent: "danger",
};

export const severityTone = (severity: FailureSeverity): Tone => SEVERITY_TONE[severity];

// --- recovery actions ---------------------------------------------------------
export type RecoveryAction = "retry" | "force_ocr" | "cancel" | "inspect";

export interface RecoveryOption {
  readonly action: RecoveryAction;
  readonly label: string;
  readonly description: string;
  /** Destructive actions require an explicit confirmation dialog. */
  readonly destructive: boolean;
  readonly primary: boolean;
}

const ACTION_LABEL: Record<RecoveryAction, string> = {
  retry: "Retry run",
  force_ocr: "Force fresh OCR",
  cancel: "Cancel run",
  inspect: "Inspect run",
};

/**
 * Decide which recovery actions apply to a failed run. `inspect` is always
 * available; retry / force-OCR appear only when the failure is retryable and
 * not permanent; cancel appears while the run is not already terminal-permanent.
 */
export const getRecoveryOptions = (item: AnalysisFailureQueueItem): readonly RecoveryOption[] => {
  const meta = failureMeta(item.failure.code);
  const options: RecoveryOption[] = [];
  const canRetry = item.failure.retryable && meta.severity !== "permanent";

  if (canRetry) {
    options.push({
      action: "retry",
      label: ACTION_LABEL.retry,
      description:
        meta.severity === "stale"
          ? "Recompute against the current Paperless state."
          : "Re-run the analysis from the failed step.",
      destructive: false,
      primary: true,
    });
  }

  if (canRetry && meta.severity === "stale") {
    options.push({
      action: "force_ocr",
      label: ACTION_LABEL.force_ocr,
      description: "Discard cached OCR and re-read the source PDF before analyzing.",
      destructive: false,
      primary: false,
    });
  }

  if (meta.severity !== "permanent") {
    options.push({
      action: "cancel",
      label: ACTION_LABEL.cancel,
      description: "Stop this run. This is irreversible and clears it from the queue.",
      destructive: true,
      primary: false,
    });
  }

  options.push({
    action: "inspect",
    label: ACTION_LABEL.inspect,
    description: "Open the run in the workbench to review evidence and state.",
    destructive: false,
    primary: options.length === 0,
  });

  return options;
};

export const isRecoverable = (item: AnalysisFailureQueueItem): boolean =>
  item.failure.retryable && failureMeta(item.failure.code).severity !== "permanent";

export interface FailureBucketCounts {
  readonly recoverable: number;
  readonly stale: number;
  readonly permanent: number;
}

export const bucketFailures = (
  items: readonly AnalysisFailureQueueItem[],
): FailureBucketCounts => {
  let recoverable = 0;
  let stale = 0;
  let permanent = 0;
  for (const item of items) {
    const severity = failureMeta(item.failure.code).severity;
    if (severity === "permanent") permanent += 1;
    else if (severity === "stale") stale += 1;
    if (isRecoverable(item)) recoverable += 1;
  }
  return { recoverable, stale, permanent };
};
