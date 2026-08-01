/**
 * Review-queue view-model — scoped to the review shell so it stays decoupled
 * from the generic workbench model files (which another worker owns). Pure and
 * deterministic: no React / network. Typed against the frozen contract, not the
 * fixture module.
 */
import type { AnalysisProposalProjection, AnalysisReviewReason } from "@repo/api-contracts";

const REVIEW_REASON_LABELS: Record<AnalysisReviewReason, string> = {
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
  REVIEW_REASON_LABELS[reason as AnalysisReviewReason] ?? reason.replaceAll("_", " ");

export type FreshnessStatus = AnalysisProposalProjection["freshness"]["status"];

interface FreshnessPresentation {
  readonly label: string;
  readonly tone: "success" | "warn" | "danger";
  readonly detail: string;
}

const FRESHNESS: Record<FreshnessStatus, FreshnessPresentation> = {
  fresh: {
    label: "Current",
    tone: "success",
    detail: "Paperless state still matches the state this proposal was computed against.",
  },
  stale: {
    label: "Stale",
    tone: "warn",
    detail: "The document changed in Paperless after analysis — applying may not reflect intent.",
  },
  current_missing: {
    label: "Document missing",
    tone: "danger",
    detail: "The document could not be read from Paperless right now.",
  },
};

export const freshnessPresentation = (status: FreshnessStatus): FreshnessPresentation =>
  FRESHNESS[status];

/** Whether evidence is degraded (expired) rather than directly available. */
export const isEvidenceDegraded = (
  proposal: AnalysisProposalProjection,
): proposal is Extract<AnalysisProposalProjection, { evidenceAvailability: "evidence_expired" }> =>
  proposal.evidenceAvailability === "evidence_expired";

/** Dense, evidence-first one-liners summarizing the proposed metadata bundle. */
export interface ProposedSummaryRow {
  readonly label: string;
  readonly value: string;
}

export const summarizeProposed = (
  proposal: AnalysisProposalProjection,
): readonly ProposedSummaryRow[] => {
  const { proposed } = proposal;
  const rows: ProposedSummaryRow[] = [{ label: "Title", value: proposed.title }];
  rows.push({
    label: "Correspondent",
    value: proposed.correspondentId != null ? `#${proposed.correspondentId}` : "—",
  });
  rows.push({
    label: "Document type",
    value: proposed.documentTypeId != null ? `#${proposed.documentTypeId}` : "—",
  });
  rows.push({
    label: "Tags",
    value: proposed.ordinaryTagIds.length
      ? `${proposed.ordinaryTagIds.length} · ${proposed.ordinaryTagIds.map((id) => `#${id}`).join(" ")}`
      : "none",
  });
  if (proposed.newTagCandidates.length) {
    rows.push({
      label: "New tag candidates",
      value: proposed.newTagCandidates.map((candidate) => candidate.name).join(", "),
    });
  }
  if (proposed.customFields.length) {
    rows.push({
      label: "Custom fields",
      value: proposed.customFields
        .map((field) => `#${field.customFieldId} ${field.operation}`)
        .join(", "),
    });
  }
  return rows;
};
