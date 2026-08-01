import type {
  CatalogEntityKind,
  CatalogEpochId,
  HashPrecondition,
  Sha256Digest,
} from "@repo/api-contracts";
import type { Correspondent, DocumentType, Tag } from "../../models/index.js";

export type CatalogEvidenceKind = Exclude<CatalogEntityKind, "custom_field">;

export type CatalogEvidenceEntity = Tag | Correspondent | DocumentType;

export type CatalogEvidenceSignal =
  | "normalized_name"
  | "spelling_variant"
  | "language_variant"
  | "acronym"
  | "co_occurrence_overlap"
  | "correspondent_identity"
  | "document_type_usage";

export type CatalogRiskFlag =
  | "forced_review_high_risk"
  | "hierarchical"
  | "matching_rule"
  | "dependency_risk"
  | "missing_semantic_signature";

export interface CatalogEvidenceSnapshot {
  readonly documentId: number;
  readonly stateHash: Sha256Digest;
  readonly modified: string;
  readonly created?: string;
  readonly tagIds: readonly number[];
  readonly correspondentId: number | null;
  readonly documentTypeId: number | null;
  readonly metadataSignature?: string;
  readonly contentSignature?: string;
}

export interface CatalogObservation {
  readonly observedAt: string;
  readonly catalogFingerprint: Sha256Digest;
  readonly freshnessFingerprint: Sha256Digest;
  readonly entityCounts: Readonly<Record<CatalogEvidenceKind, number>>;
  readonly totalDocuments: number;
}

export interface CatalogEvidencePolicy {
  readonly workflowEntityIds?: Partial<Record<CatalogEvidenceKind, readonly number[]>>;
  readonly systemEntityIds?: Partial<Record<CatalogEvidenceKind, readonly number[]>>;
  readonly dependencyEntityIds?: Partial<Record<CatalogEvidenceKind, readonly number[]>>;
  readonly highRiskEntityIds?: Partial<Record<CatalogEvidenceKind, readonly number[]>>;
}

export interface CatalogEvidenceEpoch {
  readonly epochId: CatalogEpochId;
  readonly scope: readonly CatalogEvidenceKind[];
  readonly createdAt: string;
  readonly catalogFingerprint: Sha256Digest;
  readonly freshnessFingerprint: Sha256Digest;
  readonly epochFingerprint: Sha256Digest;
  readonly scanStart: CatalogObservation;
  readonly scanEnd: CatalogObservation;
  readonly scanAttempts: number;
  readonly unstable: boolean;
  readonly totalDocuments: number;
  readonly entities: Readonly<Record<CatalogEvidenceKind, readonly CatalogEvidenceEntity[]>>;
  readonly snapshots: readonly CatalogEvidenceSnapshot[];
  readonly policy: CatalogEvidencePolicy;
}

export interface CatalogCandidateExclusion {
  readonly kind: CatalogEvidenceKind;
  readonly entityId: number;
  readonly name: string;
  readonly reason: "workflow_system" | "inbox" | "system_dependency" | "zero_use";
  readonly flags: readonly CatalogRiskFlag[];
}

export interface CatalogUnusedReview {
  readonly reviewId: string;
  readonly epochId: string;
  readonly kind: CatalogEvidenceKind;
  readonly entityId: number;
  readonly name: string;
  readonly nameHash: Sha256Digest;
  readonly rationale: string;
  readonly createdAt: string;
}

export interface CatalogMergeCandidate {
  readonly candidateId: string;
  readonly epochId: string;
  readonly kind: CatalogEvidenceKind;
  readonly xEntityId: number;
  readonly yEntityId: number;
  readonly xName: string;
  readonly yName: string;
  readonly signals: readonly CatalogEvidenceSignal[];
  readonly riskFlags: readonly CatalogRiskFlag[];
  readonly requiresHumanReview: boolean;
  readonly score: number;
  readonly expectedEvidenceFingerprint: Sha256Digest;
  readonly expectedProposalFingerprint: Sha256Digest;
  readonly preconditions: readonly HashPrecondition[];
  readonly rationale: string;
  readonly createdAt: string;
}

export interface EntityAssignmentReceipt {
  readonly kind: CatalogEvidenceKind;
  readonly entityId: number;
  readonly name: string;
  readonly filterDescriptor: AssignmentFilterDescriptor;
  readonly expectedApiCount: number;
  readonly fetchedCount: number;
  readonly nameHash: Sha256Digest;
  readonly documentIds: readonly number[];
  readonly receiptCount: number;
  readonly documentIdsHash: Sha256Digest;
  readonly documents: readonly ReceiptDocumentState[];
  readonly assignmentHash: Sha256Digest;
  readonly stateHash: Sha256Digest;
  readonly pageCount: number;
  readonly capturedAt: string;
  readonly complete: boolean;
  readonly consistencyErrors: readonly string[];
}

export interface AssignmentFilterDescriptor {
  readonly path: "/documents/";
  readonly params: Readonly<
    Partial<Record<"tags__id" | "correspondent" | "document_type", number>>
  >;
}

export interface ReceiptDocumentState {
  readonly documentId: number;
  readonly modified: string;
  readonly stateHash: Sha256Digest;
}

export interface AssignmentSets {
  readonly xOnlyDocumentIds: readonly number[];
  readonly yOnlyDocumentIds: readonly number[];
  readonly bothDocumentIds: readonly number[];
  readonly unionDocumentIds: readonly number[];
}

export interface EvidenceBatch {
  readonly documentIds: readonly number[];
  readonly createdOldestDocumentIds: readonly number[];
  readonly createdNewestDocumentIds: readonly number[];
  readonly modifiedOldestDocumentIds: readonly number[];
  readonly modifiedNewestDocumentIds: readonly number[];
  readonly evenDocumentIds: readonly number[];
  readonly xOnlyDocumentIds: readonly number[];
  readonly yOnlyDocumentIds: readonly number[];
  readonly bothDocumentIds: readonly number[];
  readonly catalogDistributionDocumentIds: readonly number[];
  readonly metadataClusterDocumentIds: readonly number[];
  readonly documentSignatureClusterDocumentIds: readonly number[];
  readonly semanticOutlierDocumentIds: readonly number[];
  readonly batchHash: Sha256Digest;
}

export interface CatalogExpansionRecord {
  readonly requestedDocumentIds: readonly number[];
  readonly acceptedDocumentIds: readonly number[];
  readonly rejectedDocumentIds: readonly number[];
  readonly expandedAt: string;
  readonly expansionHash: Sha256Digest;
}

export interface BoundedExcerpt {
  readonly start: string;
  readonly middle: string;
  readonly end: string;
  readonly charLimit: number;
  readonly delimiter: "UNTRUSTED_DOCUMENT_TEXT";
  readonly excerptHash: Sha256Digest;
}

export interface CatalogDossierCitation {
  readonly citationId: string;
  readonly documentId: number;
  readonly receiptSides: readonly ("x" | "y")[];
  readonly title: string;
  readonly created: string;
  readonly modified: string;
  readonly stateHash: Sha256Digest;
  readonly correspondentId: number | null;
  readonly documentTypeId: number | null;
  readonly tagIds: readonly number[];
  readonly excerpt: BoundedExcerpt;
}

export interface CoveragePolicy {
  readonly policy:
    | "unused_review"
    | "needs_expansion"
    | "exhaustive_fresh"
    | "stale_after_exhaustive";
  readonly inspectedCount: number;
  readonly liveAssignedCount: number;
  readonly coverage: number;
  readonly exhaustive: boolean;
  readonly freshnessComplete: boolean;
  readonly riskFlags: readonly CatalogRiskFlag[];
  readonly reason: string;
}

export interface FinalFreshnessCheck {
  readonly required: boolean;
  readonly performed: boolean;
  readonly complete: boolean;
  readonly xReceiptHash: Sha256Digest | null;
  readonly yReceiptHash: Sha256Digest | null;
  readonly reproducedInitialReceipts: boolean;
  readonly checkedAt: string | null;
}

export interface CatalogEvidenceReport {
  readonly candidate: CatalogMergeCandidate;
  readonly xReceipt: EntityAssignmentReceipt;
  readonly yReceipt: EntityAssignmentReceipt;
  readonly assignmentSets: AssignmentSets;
  readonly assignmentSnapshots: readonly CatalogEvidenceSnapshot[];
  readonly batch: EvidenceBatch;
  readonly inspectedDocumentIds: readonly number[];
  readonly nextBatch: EvidenceBatch;
  readonly citations: readonly CatalogDossierCitation[];
  readonly expansions: readonly CatalogExpansionRecord[];
  readonly coveragePolicy: CoveragePolicy;
  readonly finalFreshness: FinalFreshnessCheck;
  readonly coverageHash: Sha256Digest;
  readonly dossierFingerprint: Sha256Digest;
  readonly catalogFingerprint: Sha256Digest;
  readonly freshnessFingerprint: Sha256Digest;
  readonly epochFingerprint: Sha256Digest;
}
