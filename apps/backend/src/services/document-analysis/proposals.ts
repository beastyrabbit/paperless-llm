import {
  type AnalysisAvailableProposal,
  canonicalSha256,
  type HashPrecondition,
  type Sha256Digest,
  strictDecodeAnalysisProposal,
} from "@repo/api-contracts";
import type {
  AnalysisCustomFieldValue,
  AnalysisNewTagCandidateValue,
  AnalysisProposalValues,
} from "../operational-ledger/types.js";

export interface AnalysisPolicy {
  readonly configuredCustomFieldIds: readonly number[];
  readonly systemTagIds: readonly number[];
  readonly parentTagIds?: readonly number[];
  readonly workflowTagIds: readonly number[];
  readonly aiAnalyseTagId?: number | null;
}

export interface ProposalPolicyResult {
  readonly proposal: AnalysisAvailableProposal;
  readonly shouldApplyAutomatically: boolean;
  readonly reviewReasons: readonly string[];
  readonly strongEvidenceCount: number;
  readonly proposedValues: AnalysisProposalValues;
  readonly evidenceIds: readonly string[];
  readonly preconditions: readonly HashPrecondition[];
}

const evidenceKey = (reference: { readonly pageNumber: number; readonly blockId: string }) =>
  `page-${reference.pageNumber}:${reference.blockId}`;

const uniqueNumbers = (values: readonly number[]) =>
  [...new Set(values)].sort((left, right) => left - right);

const hasStrongTagSpecificEvidence = (
  proposal: AnalysisAvailableProposal,
  ordinaryTagCount: number,
): boolean =>
  proposal.fieldEvidence.some(
    (evidence) =>
      evidence.field === "ordinary_tags" &&
      evidence.confidence >= 0.75 &&
      evidence.references.length >= Math.min(ordinaryTagCount, 4),
  );

export const normalizeAnalysisProposalForPolicy = (
  proposal: AnalysisAvailableProposal,
  policy: AnalysisPolicy,
): ProposalPolicyResult => {
  const decoded = strictDecodeAnalysisProposal(proposal, policy.configuredCustomFieldIds);
  if (!decoded.ok) {
    throw new Error(`Analysis proposal failed strict decode: ${JSON.stringify(decoded.errors)}`);
  }

  const forbiddenTags = new Set<number>();
  if (policy.aiAnalyseTagId !== null && policy.aiAnalyseTagId !== undefined) {
    forbiddenTags.add(policy.aiAnalyseTagId);
  }
  const ordinaryTagIds = uniqueNumbers(
    proposal.proposed.ordinaryTagIds.filter((tagId) => !forbiddenTags.has(tagId)),
  );
  const reviewReasons = new Set<string>(proposal.review.reasons);
  if (ordinaryTagIds.length < 1) {
    reviewReasons.add("target_tag_count");
  }
  if (ordinaryTagIds.length > 5) {
    reviewReasons.add("more_than_5_tags");
  }
  const strongEvidenceCount = proposal.fieldEvidence.filter(
    (evidence) => evidence.field === "ordinary_tags" && evidence.confidence >= 0.75,
  ).length;
  if (
    ordinaryTagIds.length >= 4 &&
    ordinaryTagIds.length <= 5 &&
    !hasStrongTagSpecificEvidence(proposal, ordinaryTagIds.length)
  ) {
    reviewReasons.add("strong_tag_evidence_required");
  }
  if (proposal.confidence < 0.75) {
    reviewReasons.add("low_confidence");
  }
  if (proposal.proposed.newTagCandidates.length > 0) {
    reviewReasons.add("new_catalog_candidate");
  }

  const customFields: AnalysisCustomFieldValue[] = proposal.proposed.customFields.map((field) => {
    return {
      customFieldId: field.customFieldId,
      operation: field.operation,
      value: field.value,
      valueHash: field.valueHash as Sha256Digest | null,
    };
  });

  const newTagCandidates: AnalysisNewTagCandidateValue[] = proposal.proposed.newTagCandidates.map(
    (candidate) => ({
      candidateKey: candidate.candidateKey,
      name: candidate.name,
      color: candidate.color,
      rationale: candidate.rationale,
      evidenceIds: candidate.evidence.map(evidenceKey),
      confidence: candidate.confidence,
    }),
  );
  const evidenceIds = [
    ...new Set(proposal.fieldEvidence.flatMap((evidence) => evidence.references.map(evidenceKey))),
  ].sort();
  const proposedValues: AnalysisProposalValues = {
    scope: "analysis",
    title: proposal.proposed.title,
    correspondentId: proposal.proposed.correspondentId,
    documentTypeId: proposal.proposed.documentTypeId,
    ordinaryTagIds,
    newTagCandidates,
    customFields,
  };

  return {
    proposal,
    shouldApplyAutomatically: reviewReasons.size === 0 && !proposal.review.required,
    reviewReasons: [...reviewReasons].sort(),
    strongEvidenceCount,
    proposedValues,
    evidenceIds,
    preconditions: proposal.preconditions,
  };
};

export const proposalValueHash = (values: AnalysisProposalValues): Sha256Digest =>
  canonicalSha256(values);
