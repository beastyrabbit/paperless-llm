"use client";

import { Button, cn } from "@repo/ui";
import { AlertTriangle, CheckCircle2, Layers, Loader2, PackageCheck, Play, RefreshCw, X } from "lucide-react";
import { useState } from "react";
import type { CatalogEntityKind, CatalogEpoch } from "@repo/api-contracts";
import { CandidateList } from "@/components/catalog-optimization/candidate-list";
import { EpochProgress } from "@/components/catalog-optimization/epoch-progress";
import { ProposalCard } from "@/components/catalog-optimization/proposal-card";
import { ReasonDialog } from "@/components/catalog-optimization/reason-dialog";
import {
  epochStateLabel,
  epochStateTone,
  evidenceForProposal,
  isEpochInProgress,
} from "@/components/catalog-optimization/council-model";
import { useCatalogOptimization } from "@/components/catalog-optimization/use-catalog-optimization";
import { EmptyState, Notice, SectionHeader, StatusBadge } from "@/components/workbench/ui";

// custom_field is intentionally excluded: the backend deterministically returns
// 503 for it (CAPABILITY_UNAVAILABLE), and product scope is tags / correspondents
// / document types.
const SCOPE_KINDS: readonly { kind: CatalogEntityKind; label: string }[] = [
  { kind: "tag", label: "Tags" },
  { kind: "correspondent", label: "Correspondents" },
  { kind: "document_type", label: "Document types" },
];

function EpochButton({
  epoch,
  selected,
  onSelect,
}: {
  epoch: CatalogEpoch;
  selected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-current={selected ? "true" : undefined}
      className={cn(
        "w-full shrink-0 rounded-lg border px-3 py-2.5 text-left transition-colors lg:w-auto",
        selected
          ? "border-emerald-400 bg-emerald-50 dark:border-emerald-800 dark:bg-emerald-950/40"
          : "border-zinc-200 bg-white hover:border-zinc-300 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:border-zinc-700",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="flex items-center gap-1.5 text-xs text-zinc-500">
          <Layers className="h-3.5 w-3.5" />
          {epoch.scope.join(", ")}
        </span>
        <StatusBadge tone={epochStateTone(epoch.state)}>{epochStateLabel(epoch.state)}</StatusBadge>
      </div>
      <p className="mt-1.5 flex gap-3 text-[11px] text-zinc-400 dark:text-zinc-600">
        <span>{epoch.candidateCount} candidates</span>
        <span>{epoch.proposalCount} proposals</span>
      </p>
    </button>
  );
}

function StartEpochBar({
  onStart,
  busy,
}: {
  onStart: (scope: readonly CatalogEntityKind[]) => void;
  busy: boolean;
}) {
  const [scope, setScope] = useState<readonly CatalogEntityKind[]>(["tag"]);
  const toggle = (kind: CatalogEntityKind) =>
    setScope((current) =>
      current.includes(kind) ? current.filter((k) => k !== kind) : [...current, kind],
    );

  return (
    <div className="flex flex-wrap items-center gap-2">
      <span className="text-xs text-zinc-500">Scope:</span>
      {SCOPE_KINDS.map(({ kind, label }) => {
        const active = scope.includes(kind);
        return (
          <button
            key={kind}
            type="button"
            aria-pressed={active}
            onClick={() => toggle(kind)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs font-medium transition-colors",
              active
                ? "border-emerald-400 bg-emerald-50 text-emerald-800 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-300"
                : "border-zinc-200 text-zinc-600 hover:border-zinc-300 dark:border-zinc-700 dark:text-zinc-400",
            )}
          >
            {label}
          </button>
        );
      })}
      <Button size="sm" onClick={() => onStart(scope)} disabled={busy || scope.length === 0}>
        <Play className="mr-1.5 h-4 w-4" />
        Start epoch
      </Button>
    </div>
  );
}

export default function CatalogOptimizationPage() {
  const controller = useCatalogOptimization();
  const { detail, feedback } = controller;
  const epoch = detail.epoch;
  const proposals = detail.proposals;

  const handlers = {
    onApprove: controller.approveProposal,
    onReject: controller.rejectProposal,
    onApply: controller.applyProposal,
  };

  return (
    <div className="min-h-screen bg-zinc-50 dark:bg-zinc-950">
      <header className="border-b border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-950">
        <div className="px-6 py-5 md:px-8">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Catalog optimization</h1>
              <p className="mt-1 text-sm text-zinc-500">
                Council-reviewed proposals to merge, rename and prune catalog entities — applied only after an
                explicit decision, and only while the catalog is unchanged.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={controller.refresh} disabled={controller.busy}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", controller.busy && "animate-spin")} />
              Refresh
            </Button>
          </div>
          <div className="mt-4">
            <StartEpochBar
              onStart={(scope) => void controller.startEpoch(scope)}
              busy={controller.busy}
            />
          </div>
        </div>
      </header>

      <main className="px-6 py-6 md:px-8">
        {/* Command feedback */}
        {feedback.error ? (
          <div className="mb-4">
            <Notice tone="danger" title="Action failed" icon={<X className="h-4 w-4" />}>
              {feedback.error}
            </Notice>
          </div>
        ) : null}
        {feedback.conflict ? (
          <div className="mb-4">
            <Notice tone="warn" title="Conflict (409)" icon={<AlertTriangle className="h-4 w-4" />}>
              {feedback.conflict}
            </Notice>
          </div>
        ) : null}
        {feedback.notice ? (
          <div className="mb-4">
            <Notice tone="success" title={feedback.notice} icon={<CheckCircle2 className="h-4 w-4" />}>
              The list re-hydrates from the backend after each accepted command.
            </Notice>
          </div>
        ) : null}

        {controller.epochsState === "loading" ? (
          <div className="flex items-center gap-2 py-16 text-sm text-zinc-500" role="status" aria-live="polite">
            <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
            Loading epochs…
          </div>
        ) : controller.epochsState === "error" ? (
          <Notice tone="danger" title="Could not load epochs" icon={<X className="h-4 w-4" />}>
            <p>{controller.epochsError}</p>
            <button
              type="button"
              onClick={controller.refresh}
              className="mt-1 underline underline-offset-2"
            >
              Retry
            </button>
          </Notice>
        ) : controller.epochsState === "empty" ? (
          <EmptyState
            icon={<Layers className="h-8 w-8" />}
            title="No optimization epochs yet"
            description="Start an epoch above to have the council review the catalog for merges, renames and prunes."
          />
        ) : (
          <div className="grid gap-6 lg:grid-cols-[17rem_1fr]">
            <aside aria-label="Optimization epochs" className="order-2 lg:order-first">
              <SectionHeader title="Epochs" description={`${controller.epochs.length} recent`} />
              <div className="mt-3 flex gap-2 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
                {controller.epochs.map((item) => (
                  <EpochButton
                    key={item.epochId}
                    epoch={item}
                    selected={item.epochId === controller.selectedEpochId}
                    onSelect={() => controller.selectEpoch(item.epochId)}
                  />
                ))}
              </div>
            </aside>

            <section className="order-1 space-y-6 lg:order-none">
              {detail.state === "loading" ? (
                <div className="flex items-center gap-2 py-10 text-sm text-zinc-500" role="status" aria-live="polite">
                  <Loader2 className="h-5 w-5 animate-spin text-emerald-600" />
                  Loading epoch…
                </div>
              ) : detail.state === "error" ? (
                <Notice tone="danger" title="Could not load this epoch" icon={<X className="h-4 w-4" />}>
                  <p>{detail.error}</p>
                  <button
                    type="button"
                    onClick={controller.refresh}
                    className="mt-1 underline underline-offset-2"
                  >
                    Retry
                  </button>
                </Notice>
              ) : epoch ? (
                <>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="font-mono text-sm text-zinc-500">{epoch.epochId}</h2>
                      <StatusBadge tone={epochStateTone(epoch.state)}>
                        {epochStateLabel(epoch.state)}
                      </StatusBadge>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs text-zinc-400">
                        {epoch.evidenceCount} evidence records · scope {epoch.scope.join(", ")}
                      </p>
                      {isEpochInProgress(epoch.state) ? (
                        <ReasonDialog
                          title="Cancel epoch?"
                          description="Stops the council review for this epoch. Preconditions are re-verified server-side; a stale epoch state returns a 409."
                          confirmLabel="Cancel epoch"
                          cancelLabel="Keep running"
                          confirmVariant="destructive"
                          onConfirm={(reason) => controller.cancelEpoch(reason)}
                          disabled={controller.busy}
                        >
                          <Button size="sm" variant="outline" disabled={controller.busy}>
                            Cancel epoch
                          </Button>
                        </ReasonDialog>
                      ) : null}
                    </div>
                  </div>

                  <div className="grid gap-6 lg:grid-cols-[1fr_15rem]">
                    <div className="space-y-6">
                      {isEpochInProgress(epoch.state) && epoch.state !== "proposed" ? (
                        <Notice
                          tone="info"
                          title={`Epoch ${epochStateLabel(epoch.state).toLowerCase()}`}
                          icon={<Loader2 className="h-4 w-4 animate-spin" />}
                        >
                          Reviewers are still gathering evidence. Proposals appear once the council reaches the
                          proposed state — progress is tracked in the rail on the right.
                        </Notice>
                      ) : null}

                      {epoch.state === "applied" ? (
                        <Notice
                          tone="success"
                          title="Epoch applied"
                          icon={<PackageCheck className="h-4 w-4" />}
                        >
                          All approved proposals in this epoch were applied to the Paperless catalog.
                        </Notice>
                      ) : null}

                      {proposals.length > 0 ? (
                        <div className="space-y-2">
                          <SectionHeader
                            title="Proposals"
                            description={`${proposals.length} council decision${proposals.length === 1 ? "" : "s"}`}
                          />
                          <div className="space-y-4">
                            {proposals.map((proposal) => (
                              <ProposalCard
                                key={proposal.proposalId}
                                proposal={proposal}
                                evidence={evidenceForProposal(proposal, detail.evidence)}
                                handlers={handlers}
                                busy={controller.busy}
                              />
                            ))}
                          </div>
                        </div>
                      ) : isEpochInProgress(epoch.state) ? null : (
                        <EmptyState
                          icon={<Layers className="h-8 w-8" />}
                          title="No proposals in this epoch"
                          description="This epoch produced candidates but no council proposals were emitted."
                        />
                      )}

                      <div className="space-y-2">
                        <SectionHeader
                          title="Candidates"
                          description={`${epoch.candidateCount} entities flagged for review`}
                        />
                        <CandidateList
                          candidates={detail.candidates}
                          hasMore={detail.hasMoreCandidates}
                          loading={detail.candidatesLoading}
                          onLoadMore={controller.loadMoreCandidates}
                        />
                      </div>
                    </div>

                    <aside aria-label="Epoch progress" className="space-y-4">
                      <SectionHeader title="Progress" />
                      <EpochProgress epoch={epoch} />
                    </aside>
                  </div>
                </>
              ) : null}
            </section>
          </div>
        )}
      </main>
    </div>
  );
}
