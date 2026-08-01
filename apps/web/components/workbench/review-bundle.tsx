"use client";

/**
 * A single review-queue entry rendered as an expandable, evidence-first bundle.
 *
 * The collapsed header always shows the live Paperless title, the exact review
 * reasons, and the whole-bundle actions (Approve & apply / Reject) — these act on
 * the proposal as a unit using the queue item's `proposalHash` as the expected
 * identity, so an out-of-band change comes back as a 409 conflict rather than a
 * silent overwrite. Expanding lazily fetches the proposal projection to show the
 * proposed metadata, per-field evidence (or a degraded notice when evidence has
 * expired), and freshness against the current Paperless state.
 */
import { Button } from "@repo/ui";
import {
  AlertCircle,
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronRight,
  Loader2,
  X,
} from "lucide-react";
import { useCallback, useId, useState } from "react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import {
  freshnessPresentation,
  isEvidenceDegraded,
  reviewReasonLabel,
  summarizeProposed,
} from "@/components/workbench/review-model";
import { newIdempotencyKey } from "@/components/workbench/run-state-hash";
import { HashChip, Notice, StatusBadge } from "@/components/workbench/ui";
import type { AnalysisProposalProjection, AnalysisReviewQueuePage } from "@/lib/api";
import { analysisApi } from "@/lib/api";

type ReviewItem = AnalysisReviewQueuePage["items"][number];

type BundleState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; proposal: AnalysisProposalProjection | null };

interface ActionFeedback {
  readonly pending?: "apply" | "reject";
  readonly error?: string;
  readonly notice?: string;
}

function EvidenceBundle({ proposal }: { proposal: AnalysisProposalProjection }) {
  const rows = summarizeProposed(proposal);
  const freshness = freshnessPresentation(proposal.freshness.status);
  const degraded = isEvidenceDegraded(proposal);

  return (
    <div className="space-y-3">
      <dl className="grid gap-x-4 gap-y-1 text-sm sm:grid-cols-[8rem_1fr]">
        {rows.map((row) => (
          <div key={row.label} className="contents">
            <dt className="text-xs uppercase tracking-wide text-zinc-400">{row.label}</dt>
            <dd className="break-words text-zinc-700 dark:text-zinc-300">{row.value}</dd>
          </div>
        ))}
      </dl>

      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span className="text-zinc-400">Live Paperless state:</span>
        <StatusBadge tone={freshness.tone}>{freshness.label}</StatusBadge>
        <span className="text-zinc-500">{freshness.detail}</span>
      </div>

      {degraded ? (
        <Notice
          tone="warn"
          title="Evidence bundle expired — degraded view"
          icon={<AlertTriangle className="h-4 w-4" />}
        >
          The per-field evidence for this proposal is no longer retained ({proposal.evidence.reason}
          ). A fresh analysis ({proposal.evidence.refreshAction}) is required to re-ground the
          decision; the proposed values are still shown above.
        </Notice>
      ) : (
        <ul className="space-y-1.5">
          {proposal.fieldEvidence.map((evidence) => (
            <li
              key={`${evidence.field}-${evidence.customFieldId ?? "x"}`}
              className="rounded border border-zinc-100 px-2.5 py-1.5 text-xs dark:border-zinc-800"
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-medium text-zinc-700 dark:text-zinc-300">
                  {evidence.field.replaceAll("_", " ")}
                </span>
                <span className="tabular-nums text-zinc-500">
                  {Math.round(evidence.confidence * 100)}% · {evidence.references.length} ref
                  {evidence.references.length === 1 ? "" : "s"}
                </span>
              </div>
              <p className="mt-0.5 text-zinc-500 dark:text-zinc-400">{evidence.rationale}</p>
            </li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-1.5">
        <span className="text-xs text-zinc-400">Preconditions:</span>
        {proposal.preconditions.map((precondition) => (
          <HashChip
            key={precondition.digest}
            hash={precondition.digest}
            label={precondition.kind}
          />
        ))}
      </div>
    </div>
  );
}

export function ReviewBundleRow({
  item,
  title,
  onDecided,
}: {
  item: ReviewItem;
  title?: string;
  onDecided: () => void | Promise<void>;
}) {
  const [expanded, setExpanded] = useState(false);
  const [bundle, setBundle] = useState<BundleState>({ status: "idle" });
  const [feedback, setFeedback] = useState<ActionFeedback>({});
  const panelId = useId();

  const loadBundle = useCallback(async () => {
    setBundle({ status: "loading" });
    const response = await analysisApi.listProposals(item.runId);
    if (response.ok) {
      const proposal =
        response.data.items.find((candidate) => candidate.proposalHash === item.proposalHash) ??
        response.data.items[0] ??
        null;
      setBundle({ status: "ready", proposal });
    } else {
      setBundle({ status: "error", message: response.error });
    }
  }, [item.runId, item.proposalHash]);

  const toggle = useCallback(() => {
    setExpanded((current) => {
      const next = !current;
      if (next && bundle.status === "idle") void loadBundle();
      return next;
    });
  }, [bundle.status, loadBundle]);

  const decide = useCallback(
    async (action: "apply" | "reject") => {
      setFeedback({ pending: action });
      const body = {
        expectedProposalHash: item.proposalHash,
        idempotencyKey: newIdempotencyKey(),
      };
      const result =
        action === "apply"
          ? await analysisApi.applyProposal(item.runId, body)
          : await analysisApi.rejectProposal(item.runId, body);

      if (result.ok) {
        setFeedback({ notice: action === "apply" ? "Approved — applying bundle" : "Rejected" });
        await onDecided();
        return;
      }
      const conflict = result.status === 409;
      setFeedback({
        error: conflict
          ? "This proposal's identity changed since the queue loaded (expected-identity conflict). Refreshed — re-review before deciding."
          : `Action failed: ${result.error}`,
      });
      if (conflict) await onDecided();
    },
    [item.proposalHash, item.runId, onDecided],
  );

  const busy = feedback.pending !== undefined;

  return (
    <li className="rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
      <div className="flex flex-col gap-3 p-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <button
            type="button"
            onClick={toggle}
            aria-expanded={expanded}
            aria-controls={panelId}
            className="flex items-center gap-1.5 text-left font-medium text-zinc-800 hover:text-zinc-950 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:text-zinc-200 dark:hover:text-zinc-50"
          >
            {expanded ? (
              <ChevronDown className="h-4 w-4 shrink-0 text-zinc-400" />
            ) : (
              <ChevronRight className="h-4 w-4 shrink-0 text-zinc-400" />
            )}
            <span className="truncate">{title ?? `#${item.documentId}`}</span>
          </button>
          <p className="mt-1 pl-5 font-mono text-[11px] text-zinc-400 dark:text-zinc-600">
            #{item.documentId} · {item.runId}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5 pl-5">
            {item.reasons.map((reason) => (
              <StatusBadge key={reason} tone="warn">
                {reviewReasonLabel(reason)}
              </StatusBadge>
            ))}
          </div>
        </div>

        <div className="flex shrink-0 flex-wrap gap-2 pl-5 lg:pl-0">
          <ConfirmActionDialog
            title="Approve and apply this bundle?"
            description="This writes the proposed title, correspondent, tags and custom fields to Paperless as a single bundle."
            confirmLabel="Approve & apply"
            cancelLabel="Cancel"
            confirmVariant="default"
            disabled={busy}
            onConfirm={() => decide("apply")}
          >
            <Button size="sm" disabled={busy}>
              {feedback.pending === "apply" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <Check className="mr-1.5 h-4 w-4" />
              )}
              Approve &amp; apply
            </Button>
          </ConfirmActionDialog>
          <ConfirmActionDialog
            title="Reject this bundle?"
            description="This discards the whole proposal without changing the document. This cannot be undone."
            confirmLabel="Reject bundle"
            cancelLabel="Keep in review"
            confirmVariant="destructive"
            disabled={busy}
            onConfirm={() => decide("reject")}
          >
            <Button size="sm" variant="outline" disabled={busy}>
              {feedback.pending === "reject" ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : (
                <X className="mr-1.5 h-4 w-4" />
              )}
              Reject
            </Button>
          </ConfirmActionDialog>
        </div>
      </div>

      {feedback.notice ? (
        <div className="px-4 pb-3">
          <Notice tone="info" title={feedback.notice} icon={<Check className="h-4 w-4" />} />
        </div>
      ) : null}
      {feedback.error ? (
        <div className="px-4 pb-3">
          <Notice tone="danger" title={feedback.error} icon={<AlertCircle className="h-4 w-4" />} />
        </div>
      ) : null}

      {expanded ? (
        <div id={panelId} className="border-t border-zinc-100 p-4 dark:border-zinc-800">
          {bundle.status === "loading" ? (
            <div className="flex items-center gap-2 text-sm text-zinc-500" role="status">
              <Loader2 className="h-4 w-4 animate-spin" />
              Loading evidence bundle…
            </div>
          ) : bundle.status === "error" ? (
            <Notice
              tone="danger"
              title="Could not load the evidence bundle"
              icon={<AlertCircle className="h-4 w-4" />}
            >
              <p className="mb-2">{bundle.message}</p>
              <Button size="sm" variant="outline" onClick={() => void loadBundle()}>
                Try again
              </Button>
            </Notice>
          ) : bundle.status === "ready" && bundle.proposal ? (
            <EvidenceBundle proposal={bundle.proposal} />
          ) : (
            <p className="text-sm text-zinc-500">
              No proposal bundle is attached to this run anymore.
            </p>
          )}
        </div>
      ) : null}
    </li>
  );
}
