/**
 * Whole-bundle proposal detail: live Paperless current values vs the proposed
 * bundle (OCR/metadata diff), evidence + confidence, freshness/stale conflicts,
 * and the explicit whole-bundle approve / reject / force-OCR actions.
 *
 * Presentational: all data + callbacks arrive as props so it is unit-testable
 * without the network.
 */
"use client";

import type { AnalysisProposalProjection, AnalysisRun, DocumentDetail } from "@repo/api-contracts";
import { Button } from "@repo/ui";
import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  RefreshCw,
  ScanLine,
  ShieldAlert,
} from "lucide-react";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { confidenceTone, formatConfidence, reviewReasonLabel } from "./analysis-model";
import {
  buildEntityLabels,
  type CatalogIndex,
  canApproveBundle,
  documentDetailToBaseline,
  freshnessStatus,
  isAvailableProjection,
  isExpiredProjection,
  isStaleProjection,
  shouldOfferForceOcr,
} from "./bundle-model";
import { EvidencePanel } from "./evidence-panel";
import { MetadataDiff } from "./metadata-diff";
import { HashChip, Notice, SectionHeader, StatusBadge } from "./ui";

export interface ProposalDetailProps {
  readonly run: AnalysisRun;
  readonly projection: AnalysisProposalProjection;
  readonly current: DocumentDetail | null;
  readonly catalogIndex: CatalogIndex;
  readonly currentLoading?: boolean;
  readonly currentError?: string | null;
  readonly busy?: boolean;
  readonly onApprove: () => void;
  readonly onReject: () => void;
  readonly onForceOcr: () => void;
  readonly onRefreshCurrent: () => void;
}

export function ProposalDetail({
  run,
  projection,
  current,
  catalogIndex,
  currentLoading = false,
  currentError = null,
  busy = false,
  onApprove,
  onReject,
  onForceOcr,
  onRefreshCurrent,
}: ProposalDetailProps) {
  const available = isAvailableProjection(projection);
  const expired = isExpiredProjection(projection);
  const stale = isStaleProjection(projection);
  const approvable = canApproveBundle(projection, run);
  const offerForceOcr = shouldOfferForceOcr(projection, run);
  const labels = buildEntityLabels(catalogIndex, current, projection.entityLabels);

  return (
    <div className="space-y-5">
      {/* Header: confidence + review reasons */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-lg font-semibold tracking-tight">Proposal bundle</h2>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
            <span className="font-mono">{projection.proposalId}</span>
            <span aria-hidden="true">·</span>
            <HashChip hash={projection.proposalHash} label="proposalHash" />
            {available ? (
              <StatusBadge tone={confidenceTone(projection.confidence)}>
                {formatConfidence(projection.confidence)} confidence
              </StatusBadge>
            ) : null}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <WholeBundleActions
            approvable={approvable}
            offerForceOcr={offerForceOcr}
            expired={expired}
            busy={busy}
            onApprove={onApprove}
            onReject={onReject}
            onForceOcr={onForceOcr}
          />
        </div>
      </div>

      {projection.review.reasons.length > 0 ? (
        <Notice tone="warn" title="Held for review" icon={<AlertTriangle className="h-4 w-4" />}>
          <p className="mb-1.5">{projection.review.rationale}</p>
          <div className="flex flex-wrap gap-1.5">
            {projection.review.reasons.map((reason) => (
              <StatusBadge key={reason} tone="warn">
                {reviewReasonLabel(reason)}
              </StatusBadge>
            ))}
          </div>
        </Notice>
      ) : null}

      {/* Stale / expired conflict banners */}
      {stale ? (
        <Notice
          tone="danger"
          title={
            freshnessStatus(projection) === "current_missing"
              ? "Current Paperless state unavailable"
              : "Document changed since analysis"
          }
          icon={<ShieldAlert className="h-4 w-4" />}
        >
          <p>
            The document's current state no longer matches the analyzed state, so this bundle can't
            be applied as-is. Re-read the source and re-analyze before approving.
          </p>
        </Notice>
      ) : null}

      {expired ? (
        <Notice tone="warn" title="Evidence expired" icon={<Clock3 className="h-4 w-4" />}>
          <p>
            The evidence bundle for this proposal is no longer retained
            {projection.evidenceAvailability === "evidence_expired"
              ? ` (${projection.evidence.reason.replaceAll("_", " ")})`
              : ""}
            . A fresh analysis run is required before it can be reviewed or applied.
          </p>
        </Notice>
      ) : null}

      {/* Current values status */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-zinc-200 bg-white px-3 py-2 text-xs dark:border-zinc-800 dark:bg-zinc-900">
        <span className="flex items-center gap-2 text-zinc-500">
          <span className="font-medium text-zinc-700 dark:text-zinc-300">
            Live Paperless values
          </span>
          {current ? (
            <span>
              document #{current.id} · modified {current.modified.slice(0, 19).replace("T", " ")}
            </span>
          ) : currentError ? (
            <span className="text-red-600 dark:text-red-400">{currentError}</span>
          ) : (
            <span>{currentLoading ? "loading…" : "not loaded"}</span>
          )}
        </span>
        <Button size="sm" variant="ghost" onClick={onRefreshCurrent} disabled={currentLoading}>
          <RefreshCw className={`mr-1.5 h-3.5 w-3.5 ${currentLoading ? "animate-spin" : ""}`} />
          Refresh
        </Button>
      </div>

      {/* Persisted values remain inspectable after transient evidence expires. */}
      {current ? (
        <div className={available ? "grid gap-6 lg:grid-cols-[1fr_18rem]" : "min-w-0"}>
          <div className="min-w-0 space-y-2">
            <SectionHeader
              title={available ? "Metadata / OCR bundle diff" : "Persisted metadata proposal"}
              description={
                available
                  ? projection.ocrPreview.descriptor
                  : "Current Paperless values and retained proposal values. Confidence and evidence require a fresh analysis."
              }
            />
            <MetadataDiff
              baseline={documentDetailToBaseline(current)}
              proposal={projection}
              labels={labels}
            />
          </div>
          {available ? (
            <div className="space-y-2">
              <SectionHeader title="Evidence" />
              <EvidencePanel proposal={projection} />
            </div>
          ) : null}
        </div>
      ) : (
        <Notice
          tone="neutral"
          title="Waiting for current values"
          icon={<Clock3 className="h-4 w-4" />}
        >
          The bundle diff needs the document's current Paperless metadata. Use refresh if it does
          not load.
        </Notice>
      )}

      {approvable ? (
        <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="h-3.5 w-3.5" />
          Bundle is fresh and ready for a whole-bundle decision.
        </p>
      ) : null}
    </div>
  );
}

function WholeBundleActions({
  approvable,
  offerForceOcr,
  expired,
  busy,
  onApprove,
  onReject,
  onForceOcr,
}: {
  approvable: boolean;
  offerForceOcr: boolean;
  expired: boolean;
  busy: boolean;
  onApprove: () => void;
  onReject: () => void;
  onForceOcr: () => void;
}) {
  return (
    <>
      <ConfirmActionDialog
        title="Apply the whole proposal bundle?"
        description="This writes the proposed title, correspondent, document type, tags and custom fields to Paperless in one operation. It cannot be undone."
        confirmLabel="Apply bundle"
        cancelLabel="Cancel"
        confirmVariant="default"
        disabled={busy}
        onConfirm={onApprove}
      >
        <Button
          size="sm"
          disabled={!approvable || busy}
          title={approvable ? undefined : "Bundle is not applicable"}
        >
          Approve &amp; apply
        </Button>
      </ConfirmActionDialog>

      <ConfirmActionDialog
        title="Reject this proposal?"
        description="This discards the entire proposed bundle without changing the document. This cannot be undone."
        confirmLabel="Reject bundle"
        cancelLabel="Keep in review"
        confirmVariant="destructive"
        disabled={busy}
        onConfirm={onReject}
      >
        <Button size="sm" variant="outline" disabled={busy || expired}>
          Reject
        </Button>
      </ConfirmActionDialog>

      {offerForceOcr ? (
        <ConfirmActionDialog
          title="Force a fresh OCR + re-analysis?"
          description="This discards cached OCR, re-reads the source PDF and recomputes the proposal against the current Paperless state."
          confirmLabel="Force OCR"
          cancelLabel="Cancel"
          confirmVariant="default"
          disabled={busy}
          onConfirm={onForceOcr}
        >
          <Button size="sm" variant="outline" disabled={busy}>
            <ScanLine className="mr-1.5 h-4 w-4" />
            Force OCR
          </Button>
        </ConfirmActionDialog>
      ) : null}
    </>
  );
}
