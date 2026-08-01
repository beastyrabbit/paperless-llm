import type { Sha256Digest } from "@repo/api-contracts";
import type {
  CatalogEvidenceEpoch,
  CatalogEvidenceKind,
  CatalogEvidenceReport,
  CatalogMergeCandidate,
  CatalogRiskFlag,
} from "../catalog-evidence/types.js";
import type {
  CompactChairDecisionRecord,
  CouncilRecord,
  ProposalRecord,
} from "../operational-ledger/types.js";

export type CatalogCouncilReviewerRole =
  | "taxonomy_curator"
  | "document_evidence_auditor"
  | "counterexample_hunter";

export type CatalogCouncilRecommendation =
  | "merge"
  | "keep_separate"
  | "needs_review"
  | "new_entity_allowed";

export type CatalogCouncilChairApproval =
  | "approve_merge"
  | "approve_new_entity"
  | "keep_separate"
  | "needs_review";

export type CatalogCouncilDecisionKind =
  | "merge_review_ready"
  | "new_entity_review_ready"
  | "keep_separate"
  | "needs_review";

export type UnsafePaperlessDependency =
  | "workflows"
  | "matching_rules"
  | "saved_views"
  | "permissions"
  | "inbox"
  | "nested_tags"
  | "high_risk_semantics"
  | "missing_semantic_signature";

export interface CatalogCouncilReviewerOutput {
  readonly reviewer: CatalogCouncilReviewerRole;
  readonly recommendation: CatalogCouncilRecommendation;
  readonly rationale: string;
  readonly evidenceCitationIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
  readonly decisiveCounterexample: boolean;
  readonly counterexampleCitationIds: readonly string[];
}

export interface CatalogCouncilChairOutput {
  readonly approval: CatalogCouncilChairApproval;
  readonly sourceEntityId: number;
  readonly targetEntityId: number;
  readonly rationale: string;
  readonly evidenceCitationIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
}

export interface CompactCatalogCouncilVote {
  readonly role: CatalogCouncilReviewerRole | "chair";
  readonly recommendation: CatalogCouncilRecommendation | CatalogCouncilChairApproval;
  readonly rationale: string;
  readonly evidenceCitationIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
}

export interface CatalogCouncilDecision {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly proposalId: string | null;
  readonly decision: CatalogCouncilDecisionKind;
  readonly humanReviewRequired: true;
  readonly automaticApplication: "disabled";
  readonly applicationBlockedReasons: readonly UnsafePaperlessDependency[];
  readonly sourceEntityId: number;
  readonly targetEntityId: number;
  readonly reviewerVotes: readonly CompactCatalogCouncilVote[];
  readonly chairVote: CompactCatalogCouncilVote | null;
  readonly citedEvidenceIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
  readonly coveragePolicy: CatalogEvidenceReport["coveragePolicy"];
  readonly finalFreshness: CatalogEvidenceReport["finalFreshness"];
  readonly riskFlags: readonly CatalogRiskFlag[];
  readonly sourceEntityFingerprint: Sha256Digest;
  readonly targetEntityFingerprint: Sha256Digest;
  readonly freshDependencyFingerprint: Sha256Digest;
  readonly rationale: string;
  readonly createdAt: string;
  readonly persistenceRecord: CompactCatalogCouncilPersistenceRecord;
  readonly persistedRecords: CatalogCouncilPersistedRecords | null;
}

export interface CompactCatalogCouncilPersistenceRecord {
  readonly decisionId: string;
  readonly candidateId: string;
  readonly proposalId: string | null;
  readonly decision: CatalogCouncilDecisionKind;
  readonly humanReviewRequired: true;
  readonly automaticApplication: "disabled";
  readonly applicationBlockedReasons: readonly UnsafePaperlessDependency[];
  readonly sourceEntityId: number;
  readonly targetEntityId: number;
  readonly votes: readonly CompactCatalogCouncilVote[];
  readonly citedEvidenceIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
  readonly dossierFingerprint: Sha256Digest;
  readonly xReceiptHash: Sha256Digest;
  readonly yReceiptHash: Sha256Digest;
  readonly xReceiptCount: number;
  readonly yReceiptCount: number;
  readonly inspectedDocumentCount: number;
  readonly totalDocumentCount: number;
  readonly sourceEntityFingerprint: Sha256Digest;
  readonly targetEntityFingerprint: Sha256Digest;
  readonly freshDependencyFingerprint: Sha256Digest;
  readonly createdAt: string;
}

export interface CatalogCouncilPersistedRecords {
  readonly proposal: ProposalRecord;
  readonly reviewerRecords: readonly CouncilRecord[];
  readonly chairDecision: CompactChairDecisionRecord;
}

export interface CatalogCouncilNewEntityRequest {
  readonly requestId: string;
  readonly kind: CatalogEvidenceKind;
  readonly proposedName: string;
  readonly source: "ordinary_processing";
  readonly rationale: string;
  readonly evidenceCitationIds: readonly string[];
  readonly authenticEvidenceIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
}

export interface CatalogCouncilNewEntityDecision {
  readonly decisionId: string;
  readonly requestId: string;
  readonly decision: Extract<
    CatalogCouncilDecisionKind,
    "new_entity_review_ready" | "needs_review"
  >;
  readonly humanReviewRequired: true;
  readonly automaticApplication: "disabled";
  readonly reviewerVotes: readonly CompactCatalogCouncilVote[];
  readonly chairVote: CompactCatalogCouncilVote | null;
  readonly citedEvidenceIds: readonly string[];
  readonly coverageHash: Sha256Digest;
  readonly freshnessHash: Sha256Digest;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface CatalogCouncilReviewOptions {
  readonly createdAt?: string;
  readonly unsafeDependencies?: readonly UnsafePaperlessDependency[];
}

export interface CatalogCouncilRunCandidateOptions extends CatalogCouncilReviewOptions {
  readonly maxExpansions?: number;
}

export interface CatalogCouncilScoutingOptions {
  readonly scope?: readonly CatalogEvidenceKind[];
  readonly createdAt?: string;
  readonly candidateLimit?: number;
}

export interface CatalogCouncilScoutResult {
  readonly epoch: CatalogEvidenceEpoch;
  readonly candidates: readonly CatalogMergeCandidate[];
  readonly dossiers: readonly CatalogEvidenceReport[];
}

export interface CatalogCouncilOptimizeResult {
  readonly epoch: CatalogEvidenceEpoch;
  readonly candidates: readonly CatalogMergeCandidate[];
  readonly decisions: readonly CatalogCouncilDecision[];
}
