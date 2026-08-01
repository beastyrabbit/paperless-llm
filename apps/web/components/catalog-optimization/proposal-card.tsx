/**
 * A single catalog optimization proposal (catalog_proposal_projection.v2):
 * three council opinions, the chair decision, dissent + counterexamples,
 * coverage and freshness, the recorded human decision + apply status, and a
 * destructive apply behind an explicit confirmation. Apply is blocked whenever
 * an unsafe dependency (stale catalog, missing state, expired evidence, or a
 * pending human decision) would make it unsound.
 *
 * All data is passed in from the live `catalogWorkbenchApi` layer — no
 * fixtures, no invented entity names. Entities are shown by their API id and
 * the API-provided proposed value; documents link to the real Paperless route.
 */
"use client";

import { Button } from "@repo/ui";
import { AlertTriangle, Ban, Gavel, RefreshCw, ShieldCheck, TriangleAlert } from "lucide-react";
import type { CatalogProposalContract, CouncilEvidence } from "@repo/api-contracts";
import { ConfirmActionDialog } from "@/components/confirm-action-dialog";
import { HashChip, Meter, Notice, StatusBadge } from "@/components/workbench/ui";
import { DocumentLink } from "./document-link";
import { ReasonDialog } from "./reason-dialog";
import {
  applyGate,
  applyStatusLabel,
  applyStatusTone,
  chairDecision,
  chairVerdictLabel,
  chairVerdictTone,
  coveragePercent,
  coverageTone,
  decisionLabel,
  decisionTone,
  freshnessLabel,
  freshnessTone,
  inspectedDocumentIds,
  isCoverageExhaustive,
  isDestructiveOperation,
  needsHumanDecision,
  requiresExhaustiveCoverage,
  operationLabel,
  operationTone,
  reviewerLabel,
  summarizeCouncil,
  summarizeCoverage,
  verdictTone,
} from "./council-model";

export interface ProposalCardHandlers {
  readonly onApprove: (proposal: CatalogProposalContract, reason: string) => Promise<void> | void;
  readonly onReject: (proposal: CatalogProposalContract, reason: string) => Promise<void> | void;
  readonly onApply: (proposal: CatalogProposalContract) => Promise<void> | void;
}

/**
 * Entity display uses the live Paperless name hydrated by the transient
 * projection (`currentEntities`) when present, always keeping the id visible;
 * falls back to `#id` when the name is unknown (e.g. the entity was deleted).
 */
const entityLabel = (
  entityId: number,
  snapshot: { readonly name: string | null } | null | undefined,
): string => (snapshot?.name ? `${snapshot.name} (#${entityId})` : `#${entityId}`);

const entityTarget = (proposal: CatalogProposalContract): string => {
  const source = entityLabel(proposal.xEntityId, proposal.currentEntities?.x);
  if (proposal.yEntityId != null) {
    return `${source} → ${entityLabel(proposal.yEntityId, proposal.currentEntities?.y)}`;
  }
  if (proposal.proposedValue != null) return `${source} → “${proposal.proposedValue}”`;
  return source;
};

function EvidenceRow({
  evidence,
  exhaustiveRequired,
}: {
  evidence: CouncilEvidence;
  exhaustiveRequired: boolean;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {reviewerLabel(evidence.reviewer)}
        </span>
        <StatusBadge tone={verdictTone(evidence.verdict)}>{evidence.verdict}</StatusBadge>
      </div>
      <div className="mt-2 max-w-xs">
        <Meter
          percent={coveragePercent(evidence)}
          tone={coverageTone(coveragePercent(evidence), exhaustiveRequired)}
          label="Coverage"
          valueLabel={`${coveragePercent(evidence)}% · ${evidence.inspectedDocuments}/${evidence.totalDocuments}`}
        />
      </div>
      <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">{evidence.rationale}</p>
      {evidence.evidenceDocumentIds.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="text-[11px] uppercase tracking-wide text-zinc-400">Inspected:</span>
          {evidence.evidenceDocumentIds.map((documentId) => (
            <DocumentLink key={documentId} documentId={documentId} />
          ))}
        </div>
      ) : null}
      {evidence.dissent ? (
        <p className="mt-1.5 rounded border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
          <span className="font-medium">Dissent:</span> {evidence.dissent}
        </p>
      ) : null}
      {evidence.counterexamples.length > 0 ? (
        <div className="mt-2">
          <p className="text-xs font-medium text-red-700 dark:text-red-400">
            {evidence.counterexamples.length} counterexample
            {evidence.counterexamples.length === 1 ? "" : "s"}
          </p>
          <ul className="mt-1 space-y-1">
            {evidence.counterexamples.map((counterexample) => (
              <li
                key={counterexample.documentId}
                className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <DocumentLink documentId={counterexample.documentId} />
                <span>{counterexample.rationale}</span>
                <HashChip hash={counterexample.evidenceHash} label="evidenceHash" />
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}

export function ProposalCard({
  proposal,
  evidence,
  handlers,
  busy = false,
}: {
  proposal: CatalogProposalContract;
  evidence: readonly CouncilEvidence[];
  handlers: ProposalCardHandlers;
  busy?: boolean;
}) {
  const summary = summarizeCouncil(evidence);
  const coverage = summarizeCoverage(evidence);
  const exhaustiveRequired = requiresExhaustiveCoverage(proposal.intendedAction);
  const coverageShortfall = exhaustiveRequired && !isCoverageExhaustive(coverage.weakestPercent);
  const chair = chairDecision(proposal);
  const destructive = isDestructiveOperation(proposal.intendedAction);
  const needsHuman = needsHumanDecision(proposal);
  const pendingHuman = needsHuman && proposal.decision.status === "undecided";
  const gate = applyGate(proposal);
  const inspected = inspectedDocumentIds(proposal);
  const expired = proposal.evidence.availability === "evidence_expired";
  const target = entityTarget(proposal);

  return (
    <article className="rounded-lg border border-zinc-200 bg-white p-4 dark:border-zinc-800 dark:bg-zinc-900">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge tone={operationTone(proposal.intendedAction)}>
              {operationLabel(proposal.intendedAction)}
            </StatusBadge>
            <span className="font-medium text-zinc-800 dark:text-zinc-200">{target}</span>
            <span className="text-xs uppercase tracking-wide text-zinc-400">{proposal.kind}</span>
          </div>
          <p className="mt-1.5 text-sm text-zinc-600 dark:text-zinc-300">{proposal.rationale}</p>
        </div>
        <div className="flex flex-wrap items-center justify-end gap-1.5">
          <StatusBadge tone={freshnessTone(proposal.freshness)}>
            {freshnessLabel(proposal.freshness)}
          </StatusBadge>
          <StatusBadge tone={decisionTone(proposal.decision)}>
            {decisionLabel(proposal.decision)}
          </StatusBadge>
          <StatusBadge tone={applyStatusTone(proposal.apply)}>
            {applyStatusLabel(proposal.apply)}
          </StatusBadge>
        </div>
      </header>

      {/* Expired evidence — the council's basis is gone, recompute required. */}
      {expired ? (
        <div className="mt-3">
          <Notice
            tone="danger"
            title="Council evidence expired"
            icon={<RefreshCw className="h-4 w-4" />}
          >
            The evidence backing this proposal was compacted
            {proposal.evidence.availability === "evidence_expired"
              ? ` (${proposal.evidence.reason})`
              : ""}
            . Recompute the epoch before deciding or applying.
          </Notice>
        </div>
      ) : null}

      {/* Freshness drift — the catalog changed under the proposal. */}
      {!expired && proposal.freshness.status !== "fresh" ? (
        <div className="mt-3">
          <Notice
            tone={freshnessTone(proposal.freshness)}
            title={freshnessLabel(proposal.freshness)}
            icon={<AlertTriangle className="h-4 w-4" />}
          >
            {proposal.freshness.stale
              ? "The Paperless catalog changed since this proposal was computed. Applying now would fail the precondition check with a 409 conflict."
              : "The current catalog state could not be read, so the preconditions cannot be verified."}
          </Notice>
        </div>
      ) : null}

      {/* Council opinion summary (three reviewers) */}
      {evidence.length > 0 ? (
        <>
          <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-center">
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className="text-zinc-500">Council:</span>
              <StatusBadge tone="success">{summary.supportCount} support</StatusBadge>
              <StatusBadge tone="danger">{summary.opposeCount} oppose</StatusBadge>
              <StatusBadge tone="neutral">{summary.abstainCount} abstain</StatusBadge>
              {summary.unanimous ? (
                <span className="text-zinc-400">unanimous</span>
              ) : (
                <span className="text-amber-600 dark:text-amber-400">split</span>
              )}
            </div>
            <div className="sm:w-56">
              <Meter
                percent={coverage.weakestPercent}
                tone={coverageTone(coverage.weakestPercent, exhaustiveRequired)}
                label={exhaustiveRequired ? "Weakest coverage (100% required)" : "Weakest coverage"}
                valueLabel={`${coverage.weakestPercent}%`}
              />
            </div>
          </div>

          {coverageShortfall ? (
            <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
              A merge collapses two entities — it is only safe with exhaustive (100%) coverage of both.
              The weakest reviewer inspected {coverage.weakestPercent}%, so this merge is not fully
              evidenced.
            </p>
          ) : null}

          {/* Chair decision */}
          {chair ? (
            <div className="mt-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-800 dark:bg-zinc-900/60">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
                  <Gavel className="h-3.5 w-3.5" />
                  Chair
                </span>
                <div className="flex items-center gap-1.5">
                  <StatusBadge tone={chairVerdictTone(chair.verdict)}>
                    {chairVerdictLabel(chair.verdict)}
                  </StatusBadge>
                  <span className="font-mono text-[11px] text-zinc-400">action: {chair.action}</span>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-zinc-600 dark:text-zinc-400">{chair.rationale}</p>
              {chair.dissent ? (
                <p className="mt-1.5 rounded border-l-2 border-amber-400 bg-amber-50 px-2 py-1 text-xs text-amber-800 dark:bg-amber-950/40 dark:text-amber-300">
                  <span className="font-medium">Dissent:</span> {chair.dissent}
                </p>
              ) : null}
              <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-zinc-400">
                <span>confidence {Math.round(chair.confidence * 100)}%</span>
                <span>
                  {chair.inspectedDocumentCount}/{chair.totalDocumentCount} inspected
                </span>
                <span>{chair.evidenceIds.length} evidence records</span>
                <HashChip hash={chair.evidenceFingerprint} label="evidenceFingerprint" />
              </p>
            </div>
          ) : null}

          {/* Per-reviewer evidence */}
          <div className="mt-4 space-y-2">
            <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
              Reviewer evidence ({summary.counterexampleCount} counterexample
              {summary.counterexampleCount === 1 ? "" : "s"})
            </h4>
            {evidence.map((item) => (
              <EvidenceRow
                key={item.evidenceId}
                evidence={item}
                exhaustiveRequired={exhaustiveRequired}
              />
            ))}
          </div>
        </>
      ) : null}

      {/* Inspected Paperless documents backing the proposal */}
      {inspected.length > 0 ? (
        <div className="mt-4">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">
            Inspected documents ({inspected.length})
          </h4>
          <div className="mt-1.5 flex flex-wrap gap-x-2 gap-y-1">
            {inspected.map((documentId) => (
              <DocumentLink key={documentId} documentId={documentId} />
            ))}
          </div>
        </div>
      ) : null}

      {/* Freshness preconditions — expected vs. current catalog state */}
      <div className="mt-4">
        <h4 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-zinc-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          Preconditions
        </h4>
        <ul className="mt-1.5 space-y-1">
          {proposal.freshness.expectedPreconditions.map((expectedItem, index) => {
            const current = proposal.freshness.currentPreconditions?.[index];
            const drifted = current != null && current.digest !== expectedItem.digest;
            return (
              <li
                key={`${expectedItem.kind}-${expectedItem.digest}`}
                className="flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400"
              >
                <code className="font-mono text-[11px] text-zinc-500">{expectedItem.kind}</code>
                <HashChip hash={expectedItem.digest} label="expected" />
                {current != null ? (
                  <>
                    <span aria-hidden="true">→</span>
                    <HashChip hash={current.digest} label="current" />
                  </>
                ) : proposal.freshness.currentMissing ? (
                  <StatusBadge tone="danger">current missing</StatusBadge>
                ) : null}
                {drifted ? <StatusBadge tone="warn">drifted</StatusBadge> : null}
              </li>
            );
          })}
        </ul>
      </div>

      {/* Actions */}
      <footer className="mt-4 space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
        {!gate.canApply && gate.reason ? (
          <p className="flex items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-400">
            <Ban className="h-3.5 w-3.5 shrink-0" />
            {gate.reason}
          </p>
        ) : null}
        <div className="flex flex-wrap items-center gap-2">
          <ConfirmActionDialog
            title={destructive ? `${operationLabel(proposal.intendedAction)} “${target}”?` : "Apply proposal?"}
            description={
              destructive
                ? `This ${proposal.intendedAction}s catalog entities in Paperless and cannot be undone. Safety preconditions are re-verified at apply time.`
                : "This applies the proposal to the Paperless catalog. Preconditions are re-verified at apply time."
            }
            confirmLabel={`${operationLabel(proposal.intendedAction)} now`}
            cancelLabel="Cancel"
            confirmVariant="destructive"
            onConfirm={() => handlers.onApply(proposal)}
            disabled={!gate.canApply || busy}
          >
            <Button
              size="sm"
              variant={destructive ? "destructive" : "default"}
              disabled={!gate.canApply || busy}
            >
              {destructive ? <TriangleAlert className="mr-1.5 h-4 w-4" /> : null}
              {operationLabel(proposal.intendedAction)}
            </Button>
          </ConfirmActionDialog>

          {pendingHuman ? (
            <>
              <ReasonDialog
                title="Approve proposal?"
                description="Records a human approval so the proposal can be applied. A reason is required and sent with the request; only a hash of it is retained — the text is not stored."
                confirmLabel="Approve"
                cancelLabel="Cancel"
                confirmVariant="default"
                reasonRequired
                onConfirm={(reason) => handlers.onApprove(proposal, reason)}
                disabled={busy}
              >
                <Button size="sm" variant="outline" disabled={busy}>
                  Approve
                </Button>
              </ReasonDialog>
              <ReasonDialog
                title="Reject proposal?"
                description="Discards the proposal. The council's evidence is retained on the epoch. A reason is required and sent with the request; only a hash of it is retained — the text is not stored."
                confirmLabel="Reject"
                cancelLabel="Keep"
                confirmVariant="destructive"
                reasonRequired
                onConfirm={(reason) => handlers.onReject(proposal, reason)}
                disabled={busy}
              >
                <Button size="sm" variant="outline" disabled={busy}>
                  Reject
                </Button>
              </ReasonDialog>
            </>
          ) : null}

          {expired ? (
            <Button size="sm" variant="outline" disabled>
              <RefreshCw className="mr-1.5 h-4 w-4" />
              Recompute required
            </Button>
          ) : null}

          <span className="ml-auto flex items-center gap-2 text-xs text-zinc-400">
            <HashChip hash={proposal.proposalHash} label="proposalHash" />
          </span>
        </div>
      </footer>
    </article>
  );
}
