/**
 * Pure view-model helpers for the catalog optimization shell. No React / network.
 *
 * Typed against the frozen `catalog_proposal_projection.v2` contract: council
 * opinions are derived from the three reviewers' evidence, the chair decision
 * lives inside the (available) evidence union, and apply is gated on freshness,
 * evidence availability, the human decision and any in-flight apply.
 */
import type {
  CatalogChairDecision,
  CatalogEpoch,
  CatalogFreshnessProjection,
  CatalogOperation,
  CatalogProposalApplyProjection,
  CatalogProposalContract,
  CatalogProposalDecisionProjection,
  CouncilEvidence,
  CouncilReviewerRole,
  DocumentId,
} from "@repo/api-contracts";
import type { Tone } from "../workbench/analysis-model";

// --- reviewers & verdicts -----------------------------------------------------
export type Verdict = "support" | "oppose" | "abstain";

const REVIEWER_LABELS: Record<CouncilReviewerRole, string> = {
  taxonomy_curator: "Taxonomy curator",
  document_evidence_auditor: "Document evidence auditor",
  counterexample_hunter: "Counterexample hunter",
};

export const reviewerLabel = (role: CouncilReviewerRole): string => REVIEWER_LABELS[role];

const VERDICT_TONE: Record<Verdict, Tone> = {
  support: "success",
  oppose: "danger",
  abstain: "neutral",
};

export const verdictTone = (verdict: Verdict): Tone => VERDICT_TONE[verdict];

// --- council opinions (derived from the three reviewers' evidence) ------------
export interface CouncilSummary {
  readonly evidence: readonly CouncilEvidence[];
  readonly supportCount: number;
  readonly opposeCount: number;
  readonly abstainCount: number;
  /** All present reviewers landed on the same verdict. */
  readonly unanimous: boolean;
  readonly majority: Verdict;
  readonly dissents: readonly { readonly reviewer: CouncilReviewerRole; readonly note: string }[];
  readonly counterexampleCount: number;
}

/** Roll up the three reviewers' evidence for a single candidate/proposal. */
export const summarizeCouncil = (evidence: readonly CouncilEvidence[]): CouncilSummary => {
  const supportCount = evidence.filter((e) => e.verdict === "support").length;
  const opposeCount = evidence.filter((e) => e.verdict === "oppose").length;
  const abstainCount = evidence.filter((e) => e.verdict === "abstain").length;
  const total = evidence.length;
  const majority: Verdict =
    supportCount >= opposeCount && supportCount >= abstainCount
      ? "support"
      : opposeCount >= abstainCount
        ? "oppose"
        : "abstain";
  const dissents = evidence
    .filter((e): e is CouncilEvidence & { dissent: string } => e.dissent != null && e.dissent.length > 0)
    .map((e) => ({ reviewer: e.reviewer, note: e.dissent }));
  return {
    evidence,
    supportCount,
    opposeCount,
    abstainCount,
    unanimous:
      total > 0 && (supportCount === total || opposeCount === total || abstainCount === total),
    majority,
    dissents,
    counterexampleCount: evidence.reduce((sum, e) => sum + e.counterexamples.length, 0),
  };
};

export const evidenceForProposal = (
  proposal: CatalogProposalContract,
  allEvidence: readonly CouncilEvidence[],
): readonly CouncilEvidence[] =>
  allEvidence.filter((e) => proposal.candidateIds.includes(e.candidateId));

// --- chair decision -----------------------------------------------------------
export type ChairVerdict = CatalogChairDecision["verdict"];

const CHAIR_LABELS: Record<ChairVerdict, string> = {
  approve: "Approved by council",
  reject: "Rejected by council",
  needs_human: "Needs human decision",
};

export const chairVerdictLabel = (verdict: ChairVerdict): string => CHAIR_LABELS[verdict];

export const chairVerdictTone = (verdict: ChairVerdict): Tone =>
  verdict === "approve" ? "success" : verdict === "reject" ? "danger" : "warn";

/** The chair decision, present only when evidence is still available (not expired). */
export const chairDecision = (proposal: CatalogProposalContract): CatalogChairDecision | null =>
  proposal.evidence.availability === "available" ? proposal.evidence.chair : null;

/** A proposal is actionable by a human when the council defers to one. */
export const needsHumanDecision = (proposal: CatalogProposalContract): boolean => {
  const chair = chairDecision(proposal);
  return chair != null && chair.verdict === "needs_human";
};

/** The council's evidence has been compacted / lost — a fresh epoch is required. */
export const evidenceExpiredReason = (proposal: CatalogProposalContract): string | null =>
  proposal.evidence.availability === "evidence_expired" ? proposal.evidence.reason : null;

/** Inspected Paperless document ids backing the proposal (empty once expired). */
export const inspectedDocumentIds = (
  proposal: CatalogProposalContract,
): readonly DocumentId[] =>
  proposal.evidence.availability === "available" ? proposal.evidence.evidenceDocumentIds : [];

// --- coverage & freshness -----------------------------------------------------
export const coveragePercent = (evidence: Pick<CouncilEvidence, "coverage">): number =>
  Math.round(evidence.coverage * 100);

export interface CoverageSummary {
  readonly inspected: number;
  readonly total: number;
  readonly percent: number;
  /** Lowest coverage across reviewers — the weakest evidence basis. */
  readonly weakestPercent: number;
}

export const summarizeCoverage = (evidence: readonly CouncilEvidence[]): CoverageSummary => {
  if (evidence.length === 0) {
    return { inspected: 0, total: 0, percent: 0, weakestPercent: 0 };
  }
  const inspected = evidence.reduce((sum, e) => sum + e.inspectedDocuments, 0);
  const total = Math.max(...evidence.map((e) => e.totalDocuments));
  const weakestPercent = Math.round(Math.min(...evidence.map((e) => e.coverage)) * 100);
  const percent = total === 0 ? 0 : Math.round((inspected / (total * evidence.length)) * 100);
  return { inspected, total, percent, weakestPercent };
};

/**
 * A merge collapses two entities and can silently lose a distinction, so it is
 * only "safe" when the council inspected the entities exhaustively (100%).
 * Other operations do not require exhaustive coverage.
 */
export const requiresExhaustiveCoverage = (operation: CatalogOperation): boolean =>
  operation === "merge";

export const isCoverageExhaustive = (percent: number): boolean => percent >= 100;

/**
 * Coverage tone. When exhaustive coverage is required (merge), partial coverage
 * is never styled as success — only a full 100% sweep reads as safe.
 */
export const coverageTone = (percent: number, exhaustiveRequired: boolean): Tone => {
  if (exhaustiveRequired) {
    return percent >= 100 ? "success" : percent >= 50 ? "warn" : "danger";
  }
  return percent >= 75 ? "success" : percent >= 40 ? "warn" : "danger";
};

const FRESHNESS_LABELS: Record<CatalogFreshnessProjection["status"], string> = {
  fresh: "Fresh",
  stale: "Stale — recompute required",
  current_missing: "Current state unavailable",
};

export const freshnessLabel = (freshness: CatalogFreshnessProjection): string =>
  FRESHNESS_LABELS[freshness.status];

export const freshnessTone = (freshness: CatalogFreshnessProjection): Tone =>
  freshness.status === "fresh" ? "success" : freshness.status === "stale" ? "warn" : "danger";

export const isFresh = (proposal: CatalogProposalContract): boolean =>
  proposal.freshness.status === "fresh" && !proposal.freshness.stale;

// --- decision & apply projections ---------------------------------------------
const DECISION_LABELS: Record<CatalogProposalDecisionProjection["status"], string> = {
  undecided: "Undecided",
  approved: "Approved",
  rejected: "Rejected",
  deferred: "Deferred",
  applied: "Applied",
  failed: "Failed",
  conflict: "Conflict",
  canceled: "Canceled",
};

export const decisionLabel = (
  decision: CatalogProposalDecisionProjection,
): string => DECISION_LABELS[decision.status];

export const decisionTone = (decision: CatalogProposalDecisionProjection): Tone => {
  switch (decision.status) {
    case "applied":
    case "approved":
      return "success";
    case "rejected":
    case "failed":
    case "conflict":
      return "danger";
    case "deferred":
      return "warn";
    default:
      return "neutral";
  }
};

const APPLY_LABELS: Record<CatalogProposalApplyProjection["status"], string> = {
  not_started: "Not applied",
  accepted: "Apply accepted",
  applying: "Applying…",
  succeeded: "Applied",
  failed: "Apply failed",
  conflict: "Apply conflict",
  canceled: "Apply canceled",
};

export const applyStatusLabel = (apply: CatalogProposalApplyProjection): string =>
  APPLY_LABELS[apply.status];

export const applyStatusTone = (apply: CatalogProposalApplyProjection): Tone => {
  switch (apply.status) {
    case "succeeded":
      return "success";
    case "failed":
    case "conflict":
      return "danger";
    case "applying":
    case "accepted":
      return "info";
    case "canceled":
      return "neutral";
    default:
      return "neutral";
  }
};

// --- apply gating (unsafe-dependency blocking) --------------------------------
export interface ApplyGate {
  readonly canApply: boolean;
  /** Human-readable reason apply is blocked, or null when it is allowed. */
  readonly reason: string | null;
  readonly tone: Tone;
}

/**
 * Whether the destructive apply may proceed. Apply is blocked when the council
 * evidence expired, when the Paperless catalog drifted (freshness not fresh),
 * while an apply is already in flight, once a terminal decision was recorded,
 * or while a human decision is still outstanding for a deferred proposal.
 */
export const applyGate = (proposal: CatalogProposalContract): ApplyGate => {
  if (proposal.evidence.availability === "evidence_expired") {
    return {
      canApply: false,
      reason: "Council evidence expired — recompute the epoch before applying.",
      tone: "danger",
    };
  }
  if (proposal.freshness.status === "current_missing") {
    return {
      canApply: false,
      reason: "Current catalog state is unavailable — preconditions cannot be verified.",
      tone: "danger",
    };
  }
  if (proposal.freshness.stale) {
    return {
      canApply: false,
      reason: "Paperless catalog changed since this proposal — recompute to refresh preconditions.",
      tone: "warn",
    };
  }
  if (proposal.apply.status === "applying" || proposal.apply.status === "accepted") {
    return { canApply: false, reason: "An apply is already in progress.", tone: "info" };
  }
  if (proposal.decision.status === "applied" || proposal.apply.status === "succeeded") {
    return { canApply: false, reason: "This proposal was already applied.", tone: "success" };
  }
  if (proposal.decision.status === "rejected") {
    return { canApply: false, reason: "This proposal was rejected.", tone: "neutral" };
  }
  if (needsHumanDecision(proposal) && proposal.decision.status === "undecided") {
    return {
      canApply: false,
      reason: "The council deferred to a human — approve the proposal before applying.",
      tone: "warn",
    };
  }
  return { canApply: true, reason: null, tone: "neutral" };
};

// --- operations ---------------------------------------------------------------
const DESTRUCTIVE_OPERATIONS: ReadonlySet<CatalogOperation> = new Set(["merge", "delete"]);

/** Merge and delete mutate/remove existing entities and require confirmation. */
export const isDestructiveOperation = (operation: CatalogOperation): boolean =>
  DESTRUCTIVE_OPERATIONS.has(operation);

const OPERATION_LABELS: Record<CatalogOperation, string> = {
  create: "Create",
  rename: "Rename",
  merge: "Merge",
  delete: "Delete",
  describe: "Describe",
};

export const operationLabel = (operation: CatalogOperation): string => OPERATION_LABELS[operation];

export const operationTone = (operation: CatalogOperation): Tone =>
  operation === "delete" ? "danger" : operation === "merge" ? "warn" : "info";

// --- epoch state --------------------------------------------------------------
const EPOCH_STATE_LABELS: Record<CatalogEpoch["state"], string> = {
  queued: "Queued",
  collecting: "Collecting",
  evidence_ready: "Evidence ready",
  council_review: "Council review",
  proposed: "Proposed",
  approved: "Approved",
  rejected: "Rejected",
  applying: "Applying",
  applied: "Applied",
  failed: "Failed",
  canceled: "Canceled",
};

export const epochStateLabel = (state: CatalogEpoch["state"]): string => EPOCH_STATE_LABELS[state];

export const epochStateTone = (state: CatalogEpoch["state"]): Tone => {
  switch (state) {
    case "applied":
      return "success";
    case "failed":
      return "danger";
    case "canceled":
    case "rejected":
      return "neutral";
    case "proposed":
    case "approved":
      return "warn";
    default:
      return "info";
  }
};

/** Ordered epoch lifecycle for the async progress rail. */
export const EPOCH_PROGRESS_STEPS = [
  "queued",
  "collecting",
  "evidence_ready",
  "council_review",
  "proposed",
  "applying",
  "applied",
] as const satisfies readonly CatalogEpoch["state"][];

export type EpochProgressStep = (typeof EPOCH_PROGRESS_STEPS)[number];

export type EpochProgressStatus = "done" | "current" | "pending" | "failed" | "canceled";

export interface EpochProgressCell {
  readonly step: EpochProgressStep;
  readonly label: string;
  readonly status: EpochProgressStatus;
}

const TERMINAL_EPOCH_STATES: ReadonlySet<CatalogEpoch["state"]> = new Set([
  "applied",
  "failed",
  "canceled",
  "rejected",
]);

export const isEpochInProgress = (state: CatalogEpoch["state"]): boolean =>
  !TERMINAL_EPOCH_STATES.has(state);

/**
 * Project an epoch's current state onto the ordered lifecycle so the UI can
 * render real async progress (done / current / pending), degrading to a
 * failed/canceled marker on the current step for terminal error states.
 */
export const epochProgress = (state: CatalogEpoch["state"]): readonly EpochProgressCell[] => {
  const failed = state === "failed";
  const canceled = state === "canceled" || state === "rejected";
  // Map non-lifecycle terminal states onto the step they interrupted.
  const anchor: EpochProgressStep =
    state === "failed" || state === "canceled"
      ? "collecting"
      : state === "rejected"
        ? "proposed"
        : state === "approved"
          ? "proposed"
          : (state as EpochProgressStep);
  const anchorIndex = EPOCH_PROGRESS_STEPS.indexOf(anchor);
  return EPOCH_PROGRESS_STEPS.map((step, index) => {
    let status: EpochProgressStatus;
    if (index < anchorIndex) {
      status = "done";
    } else if (index > anchorIndex) {
      status = "pending";
    } else if (failed) {
      status = "failed";
    } else if (canceled) {
      status = "canceled";
    } else {
      status = state === "applied" ? "done" : "current";
    }
    return { step, label: epochStateLabel(step), status };
  });
};
