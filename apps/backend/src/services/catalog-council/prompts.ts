import type { CatalogEvidenceReport } from "../catalog-evidence/types.js";
import type { CatalogCouncilNewEntityRequest, CatalogCouncilReviewerRole } from "./types.js";

const compactDossier = (dossier: CatalogEvidenceReport) => ({
  candidate: {
    candidateId: dossier.candidate.candidateId,
    kind: dossier.candidate.kind,
    xEntityId: dossier.candidate.xEntityId,
    yEntityId: dossier.candidate.yEntityId,
    xName: dossier.candidate.xName,
    yName: dossier.candidate.yName,
    signals: dossier.candidate.signals,
    riskFlags: dossier.candidate.riskFlags,
  },
  assignmentSets: dossier.assignmentSets,
  citationIds: dossier.citations.map((citation) => citation.citationId),
  coveragePolicy: dossier.coveragePolicy,
  coverageHash: dossier.coverageHash,
  freshnessHash: dossier.finalFreshness.complete ? dossier.finalFreshness.xReceiptHash : null,
  finalFreshness: dossier.finalFreshness,
  dossierFingerprint: dossier.dossierFingerprint,
});

export const reviewerPrompt = ({
  role,
  dossier,
  freshnessHash,
}: {
  readonly role: CatalogCouncilReviewerRole;
  readonly dossier: CatalogEvidenceReport;
  readonly freshnessHash: string;
}): string =>
  JSON.stringify({
    task: "catalog_merge_reviewer",
    role,
    rules: [
      "Use only supplied citation IDs and hashes.",
      "Never approve a semantic merge from name similarity alone.",
      "Report concrete contradictions as decisiveCounterexample with citation IDs.",
      "Return compact structured JSON only.",
    ],
    expectedCoverageHash: dossier.coverageHash,
    expectedFreshnessHash: freshnessHash,
    dossier: compactDossier(dossier),
  });

export const chairPrompt = ({
  dossier,
  reviewerSummaries,
  freshnessHash,
}: {
  readonly dossier: CatalogEvidenceReport;
  readonly reviewerSummaries: readonly unknown[];
  readonly freshnessHash: string;
}): string =>
  JSON.stringify({
    task: "catalog_merge_chair",
    rules: [
      "Approve merge only when evidence is exhaustive, final receipts are fresh, reviewers are unanimous, and hashes match.",
      "When approving merge, choose explicit sourceEntityId and targetEntityId from exactly the supplied X/Y entity IDs in either direction.",
      "sourceEntityId and targetEntityId must be distinct positive IDs; never default silently to X-to-Y.",
      "Always leave Paperless application disabled for human review.",
      "Return compact structured JSON only.",
    ],
    allowedEntityDirections: [
      {
        sourceEntityId: dossier.candidate.xEntityId,
        targetEntityId: dossier.candidate.yEntityId,
      },
      {
        sourceEntityId: dossier.candidate.yEntityId,
        targetEntityId: dossier.candidate.xEntityId,
      },
    ],
    expectedCoverageHash: dossier.coverageHash,
    expectedFreshnessHash: freshnessHash,
    reviewerSummaries,
    dossier: compactDossier(dossier),
  });

export const newEntityReviewerPrompt = ({
  role,
  request,
}: {
  readonly role: CatalogCouncilReviewerRole;
  readonly request: CatalogCouncilNewEntityRequest;
}): string =>
  JSON.stringify({
    task: "catalog_new_entity_reviewer",
    role,
    rules: [
      "New catalog entities from ordinary processing require at least two reviewers and a chair.",
      "Use only supplied evidence IDs and hashes.",
      "Return compact structured JSON only.",
    ],
    request,
  });

export const newEntityChairPrompt = ({
  request,
  reviewerSummaries,
}: {
  readonly request: CatalogCouncilNewEntityRequest;
  readonly reviewerSummaries: readonly unknown[];
}): string =>
  JSON.stringify({
    task: "catalog_new_entity_chair",
    rules: [
      "Approve new_entity only with at least two reviewer approvals and matching hashes.",
      "Always require human review and keep automatic Paperless application disabled.",
      "Return compact structured JSON only.",
    ],
    request,
    reviewerSummaries,
  });
