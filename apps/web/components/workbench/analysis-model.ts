/**
 * Pure view-model helpers for the analysis workbench.
 *
 * These functions are deterministic and free of React / next-intl / network so
 * they can be unit-tested directly.
 */
import type {
  AnalysisFieldEvidence,
  AnalysisProposal,
  AnalysisProposalProjection,
  AnalysisRun,
  AnalysisRunState,
} from "@repo/api-contracts";
import type { DocumentBaseline, EntityLabels } from "./view-types";

// --- run outcome grouping -----------------------------------------------------
export type RunOutcome =
  | "active"
  | "needs_review"
  | "succeeded"
  | "failed"
  | "canceled"
  | "rejected";

export type Tone = "neutral" | "info" | "warn" | "danger" | "success";

const OUTCOME_BY_STATE: Record<AnalysisRunState, RunOutcome> = {
  queued: "active",
  reading_paperless: "active",
  ocr_requested: "active",
  hashing_source: "active",
  analyzing: "active",
  retrying: "active",
  applying: "active",
  approved: "active",
  awaiting_review: "needs_review",
  succeeded: "succeeded",
  failed: "failed",
  canceled: "canceled",
  rejected: "rejected",
};

const OUTCOME_TONE: Record<RunOutcome, Tone> = {
  active: "info",
  needs_review: "warn",
  succeeded: "success",
  failed: "danger",
  canceled: "neutral",
  rejected: "neutral",
};

const STATE_LABELS: Record<AnalysisRunState, string> = {
  queued: "Queued",
  reading_paperless: "Reading Paperless",
  ocr_requested: "OCR requested",
  hashing_source: "Hashing source",
  analyzing: "Analyzing",
  awaiting_review: "Awaiting review",
  approved: "Approved",
  retrying: "Retrying",
  applying: "Applying",
  succeeded: "Succeeded",
  failed: "Failed",
  canceled: "Canceled",
  rejected: "Rejected",
};

export const stateLabel = (state: AnalysisRunState): string => STATE_LABELS[state];

export const runOutcome = (run: Pick<AnalysisRun, "state">): RunOutcome =>
  OUTCOME_BY_STATE[run.state];

export const outcomeTone = (outcome: RunOutcome): Tone => OUTCOME_TONE[outcome];

/** Terminal states cannot progress further (see `analysisRunTransitions`). */
export const isTerminalRun = (state: AnalysisRunState): boolean =>
  state === "succeeded" || state === "failed" || state === "canceled" || state === "rejected";

// --- progress timeline --------------------------------------------------------
export const ANALYSIS_TIMELINE_STEPS = [
  "queued",
  "reading_paperless",
  "ocr_requested",
  "hashing_source",
  "analyzing",
  "awaiting_review",
  "approved",
  "applying",
  "succeeded",
] as const satisfies readonly AnalysisRunState[];

export type TimelineStepKey = (typeof ANALYSIS_TIMELINE_STEPS)[number];

export type TimelineStepStatus = "done" | "current" | "pending" | "failed" | "canceled" | "skipped";

export interface TimelineStep {
  readonly key: TimelineStepKey;
  readonly label: string;
  readonly status: TimelineStepStatus;
}

/** Where the current state sits on the linear happy-path timeline. */
const anchorFor = (state: AnalysisRunState): { index: number; status: TimelineStepStatus } => {
  const linearIndex = ANALYSIS_TIMELINE_STEPS.indexOf(state as TimelineStepKey);
  if (linearIndex >= 0) {
    return { index: linearIndex, status: state === "succeeded" ? "done" : "current" };
  }
  switch (state) {
    case "retrying":
      // Looping back to re-read the source before analyzing again.
      return { index: ANALYSIS_TIMELINE_STEPS.indexOf("reading_paperless"), status: "current" };
    case "rejected":
      return { index: ANALYSIS_TIMELINE_STEPS.indexOf("awaiting_review"), status: "canceled" };
    case "canceled":
      return { index: ANALYSIS_TIMELINE_STEPS.indexOf("analyzing"), status: "canceled" };
    case "failed":
      return { index: ANALYSIS_TIMELINE_STEPS.indexOf("analyzing"), status: "failed" };
    default:
      return { index: 0, status: "current" };
  }
};

/**
 * Build the vertical progress timeline for a run. `ocr_requested` is only part
 * of the path when OCR was forced; otherwise it is shown as skipped once the
 * run has moved past the reading phase.
 */
export const getRunTimeline = (
  run: Pick<AnalysisRun, "state" | "forceOcr">,
): readonly TimelineStep[] => {
  const anchor = anchorFor(run.state);
  const terminalNegative = anchor.status === "failed" || anchor.status === "canceled";

  return ANALYSIS_TIMELINE_STEPS.map((key, index): TimelineStep => {
    const label = STATE_LABELS[key];

    if (key === "ocr_requested" && !run.forceOcr) {
      // Skipped whenever OCR was not forced and we are at/after the read phase.
      const status: TimelineStepStatus = index <= anchor.index ? "skipped" : "pending";
      return { key, label, status };
    }

    if (index < anchor.index) return { key, label, status: "done" };
    if (index === anchor.index) return { key, label, status: anchor.status };
    return { key, label, status: terminalNegative ? "skipped" : "pending" };
  });
};

// --- confidence banding -------------------------------------------------------
export type ConfidenceBand = "high" | "medium" | "low";

export const confidenceBand = (confidence: number): ConfidenceBand => {
  if (confidence >= 0.85) return "high";
  if (confidence >= 0.65) return "medium";
  return "low";
};

export const confidenceTone = (confidence: number): Tone => {
  const band = confidenceBand(confidence);
  return band === "high" ? "success" : band === "medium" ? "warn" : "danger";
};

export const formatConfidence = (confidence: number): string => `${Math.round(confidence * 100)}%`;

// --- metadata / OCR diff ------------------------------------------------------
export type DiffKind = "unchanged" | "changed" | "added" | "removed";

export interface DiffValue {
  readonly display: string;
  /** Stable key for list-diff rendering (tag chips), when applicable. */
  readonly id?: number;
  readonly isNew?: boolean;
}

export interface MetadataDiffRow {
  readonly key: string;
  readonly label: string;
  readonly kind: DiffKind;
  readonly before: readonly DiffValue[];
  readonly after: readonly DiffValue[];
  readonly confidence: number | null;
  readonly evidenceCount: number;
}

const nameOf = (
  labels: Readonly<Record<number, string>>,
  id: number | null,
  prefix: string,
): DiffValue | null => (id == null ? null : { display: labels[id] ?? `${prefix} #${id}`, id });

const evidenceFor = (
  proposal: AnalysisProposal | AnalysisProposalProjection,
  fieldKey: AnalysisFieldEvidence["field"],
): AnalysisFieldEvidence | undefined =>
  "fieldEvidence" in proposal
    ? proposal.fieldEvidence.find((evidence) => evidence.field === fieldKey)
    : undefined;

const scalarKind = (before: DiffValue | null, after: DiffValue | null): DiffKind => {
  if (!before && after) return "added";
  if (before && !after) return "removed";
  if (before && after && before.display !== after.display) return "changed";
  return "unchanged";
};

/**
 * Field-by-field diff between the document's current Paperless metadata and the
 * proposed values. Tag rows use set semantics so added / removed chips are
 * individually distinguishable.
 */
export const getMetadataDiffRows = (
  baseline: DocumentBaseline,
  proposal: AnalysisProposal | AnalysisProposalProjection,
  labels: EntityLabels,
): readonly MetadataDiffRow[] => {
  const rows: MetadataDiffRow[] = [];

  // Title
  const titleBefore: DiffValue = { display: baseline.title };
  const titleAfter: DiffValue = { display: proposal.proposed.title };
  rows.push({
    key: "title",
    label: "Title",
    kind: baseline.title === proposal.proposed.title ? "unchanged" : "changed",
    before: [titleBefore],
    after: [titleAfter],
    confidence: evidenceFor(proposal, "title")?.confidence ?? null,
    evidenceCount: evidenceFor(proposal, "title")?.references.length ?? 0,
  });

  // Correspondent
  const corrBefore = nameOf(labels.correspondents, baseline.correspondentId, "Correspondent");
  const corrAfter = nameOf(
    labels.correspondents,
    proposal.proposed.correspondentId,
    "Correspondent",
  );
  rows.push({
    key: "correspondent",
    label: "Correspondent",
    kind: scalarKind(corrBefore, corrAfter),
    before: corrBefore ? [corrBefore] : [],
    after: corrAfter ? [corrAfter] : [],
    confidence: evidenceFor(proposal, "correspondent")?.confidence ?? null,
    evidenceCount: evidenceFor(proposal, "correspondent")?.references.length ?? 0,
  });

  // Document type
  const typeBefore = nameOf(labels.documentTypes, baseline.documentTypeId, "Type");
  const typeAfter = nameOf(labels.documentTypes, proposal.proposed.documentTypeId, "Type");
  rows.push({
    key: "document_type",
    label: "Document type",
    kind: scalarKind(typeBefore, typeAfter),
    before: typeBefore ? [typeBefore] : [],
    after: typeAfter ? [typeAfter] : [],
    confidence: evidenceFor(proposal, "document_type")?.confidence ?? null,
    evidenceCount: evidenceFor(proposal, "document_type")?.references.length ?? 0,
  });

  // Tags (set diff)
  const beforeTagIds = new Set<number>(baseline.ordinaryTagIds);
  const afterTagIds = new Set<number>(proposal.proposed.ordinaryTagIds);
  const beforeTags = baseline.ordinaryTagIds.map(
    (id): DiffValue => ({ display: labels.tags[id] ?? `Tag #${id}`, id }),
  );
  const afterTags = proposal.proposed.ordinaryTagIds.map(
    (id): DiffValue => ({
      display: labels.tags[id] ?? `Tag #${id}`,
      id,
      isNew: !beforeTagIds.has(id),
    }),
  );
  const tagsChanged =
    beforeTags.length !== afterTags.length ||
    [...afterTagIds].some((id) => !beforeTagIds.has(id)) ||
    [...beforeTagIds].some((id) => !afterTagIds.has(id));
  rows.push({
    key: "ordinary_tags",
    label: "Tags",
    kind: tagsChanged ? "changed" : "unchanged",
    before: beforeTags,
    after: afterTags,
    confidence: evidenceFor(proposal, "ordinary_tags")?.confidence ?? null,
    evidenceCount: evidenceFor(proposal, "ordinary_tags")?.references.length ?? 0,
  });

  // Custom fields
  for (const decision of proposal.proposed.customFields) {
    const baselineField = baseline.customFields.find(
      (item) => item.customFieldId === decision.customFieldId,
    );
    const label = labels.customFields[decision.customFieldId] ?? `Field #${decision.customFieldId}`;
    const before: DiffValue[] = baselineField ? [{ display: baselineField.value }] : [];
    const after: DiffValue[] =
      decision.operation === "remove" ? [] : [{ display: formatFieldValue(decision.value) }];
    rows.push({
      key: `custom_field_${decision.customFieldId}`,
      label,
      kind: decision.operation === "remove" ? "removed" : before.length ? "changed" : "added",
      before,
      after,
      confidence: "evidence" in decision ? decision.evidence.confidence : null,
      evidenceCount: "evidence" in decision ? decision.evidence.references.length : 0,
    });
  }

  return rows;
};

const formatFieldValue = (value: unknown): string => {
  if (value == null) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  return JSON.stringify(value);
};

export const countChangedRows = (rows: readonly MetadataDiffRow[]): number =>
  rows.filter((row) => row.kind !== "unchanged").length;

// --- review reasons -----------------------------------------------------------
const REVIEW_REASON_LABELS: Record<string, string> = {
  more_than_5_tags: "More than 5 tags",
  stale_precondition: "Stale precondition",
  unusual_metadata: "Unusual metadata",
  low_confidence: "Low confidence",
  new_catalog_candidate: "New catalog candidate",
  conflicting_evidence: "Conflicting evidence",
  policy_violation: "Policy violation",
  evidence_expired: "Evidence expired",
};

export const reviewReasonLabel = (reason: string): string =>
  REVIEW_REASON_LABELS[reason] ?? reason.replaceAll("_", " ");
