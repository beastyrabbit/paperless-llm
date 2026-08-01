import type {
  AllowedStorageArtifactKind,
  AnalysisCustomFieldValue as AnalysisCustomFieldPrimitive,
  AnalysisRunState,
  CatalogChairAction,
  CatalogChairVerdict,
  CatalogEntityKind,
  CatalogOperation,
  CatalogState,
  CouncilReviewerRole,
  HashPrecondition,
  Sha256Digest,
  StorageLedgerEntry,
} from "@repo/api-contracts";

export const OPERATIONAL_LEDGER_SCHEMA_VERSION = "operational-ledger.v2" as const;
export const LEGACY_OPERATIONAL_LEDGER_SCHEMA_VERSIONS = ["operational-ledger.v1"] as const;
export const DEFAULT_OPERATIONAL_LEDGER_RETENTION_DAYS = 30;

export const catalogProposalRiskFlags = [
  "forced_review_high_risk",
  "hierarchical",
  "matching_rule",
  "dependency_risk",
  "missing_semantic_signature",
] as const;
export type CatalogProposalRiskFlag = (typeof catalogProposalRiskFlags)[number];

export const catalogProposalApplicationBlockedReasons = [
  "workflows",
  "matching_rules",
  "saved_views",
  "permissions",
  "inbox",
  "nested_tags",
  "high_risk_semantics",
  "missing_semantic_signature",
] as const;
export type CatalogProposalApplicationBlockedReason =
  (typeof catalogProposalApplicationBlockedReasons)[number];

export interface CatalogProposalSafetyInputs {
  readonly candidateRiskFlags: readonly CatalogProposalRiskFlag[];
  readonly coverageRiskFlags: readonly CatalogProposalRiskFlag[];
  readonly requiresHumanReview: boolean;
  readonly applicationBlockedReasons: readonly CatalogProposalApplicationBlockedReason[];
}

export type LedgerScope =
  | "analysis"
  | "catalog"
  | "document"
  | "mutation"
  | "provider"
  | "random_cycle";

export interface OperationalLedgerSettings {
  readonly kind: "settings";
  readonly retentionDays: number;
  readonly updatedAt: string;
  readonly values: Partial<Record<OperationalLedgerSettingKey, OperationalLedgerSettingValue>>;
}

export type OperationalLedgerSettingKey =
  | "review.mode"
  | "automatic.mode"
  | "model.effort"
  | "customFields.enabledIds"
  | "limits.maxRetries"
  | "limits.maxConcurrent"
  | "limits.dailyProviderTokens"
  | "limits.dailyOcrPages"
  | "retentionDays";

export type OperationalLedgerSettingValue = string | number | boolean | null | readonly number[];

export interface SanitizedFailureRecord {
  readonly kind: "sanitized_failure";
  readonly code:
    | "PAPERLESS_UNAVAILABLE"
    | "SOURCE_HASH_MISMATCH"
    | "PROVIDER_MALFORMED"
    | "PROVIDER_FAILURE"
    | "STORAGE_POLICY_VIOLATION"
    | "STATE_TRANSITION_CONFLICT"
    | "CANCELED"
    | "RETRY_EXHAUSTED"
    | "STALE_PRECONDITION"
    | "REJECTED"
    | "UNKNOWN";
  readonly message: string;
  readonly failedAt: string;
  readonly retryable: boolean;
  readonly provider?: string;
  readonly preconditionHashes?: readonly Sha256Digest[];
}

export interface AnalysisRunRecord {
  readonly kind: "ids_hashes_state";
  readonly runId: string;
  readonly documentId: number;
  readonly forceOcr: boolean;
  readonly state: AnalysisRunState;
  readonly sourcePdfHash: Sha256Digest | null;
  readonly documentStateHash: Sha256Digest;
  readonly proposalIds: readonly string[];
  readonly retryCount: number;
  readonly failure: SanitizedFailureRecord | null;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export interface CatalogEpochRecord {
  readonly kind: "ids_hashes_state";
  readonly epochId: string;
  readonly state: CatalogState;
  readonly scope: readonly string[];
  readonly paperlessCatalogHash: Sha256Digest;
  readonly candidateCount: number;
  readonly evidenceCount: number;
  readonly proposalCount: number;
  readonly retryCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly completedAt: string | null;
}

export type ProposalDecision =
  | "undecided"
  | "approved"
  | "rejected"
  | "deferred"
  | "applied"
  | "failed"
  | "conflict"
  | "canceled";

export type ProposalOutcome = Exclude<ProposalDecision, "undecided">;

export interface AnalysisNewTagCandidateValue {
  readonly candidateKey: string;
  readonly name: string;
  readonly color: string | null;
  readonly rationale: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
}

export interface AnalysisCustomFieldValue {
  readonly customFieldId: number;
  readonly operation: "set" | "remove";
  readonly value: AnalysisCustomFieldPrimitive;
  readonly valueHash: Sha256Digest | null;
}

export interface AnalysisProposalValues {
  readonly scope: "analysis";
  readonly title: string;
  readonly correspondentId: number | null;
  readonly documentTypeId: number | null;
  readonly ordinaryTagIds: readonly number[];
  readonly newTagCandidates: readonly AnalysisNewTagCandidateValue[];
  readonly customFields: readonly AnalysisCustomFieldValue[];
}

export interface CatalogProposalValues {
  readonly scope: "catalog";
  readonly entityKind: CatalogEntityKind;
  readonly intendedAction: CatalogOperation;
  readonly sourceEntityId: number;
  readonly targetEntityId: number | null;
  readonly proposedValue: string | null;
  readonly candidateIds: readonly string[];
  readonly evidenceDocumentIds: readonly number[];
  readonly expectedProposalFingerprint: Sha256Digest;
  readonly expectedEvidenceFingerprint: Sha256Digest;
  readonly candidateRiskFlags: readonly CatalogProposalRiskFlag[];
  readonly coverageRiskFlags: readonly CatalogProposalRiskFlag[];
  readonly requiresHumanReview: boolean;
  readonly applicationBlockedReasons: readonly CatalogProposalApplicationBlockedReason[];
}

export interface ProposalRecord {
  readonly kind: "undecided_analysis_proposal_values" | "undecided_catalog_proposal_values";
  readonly scope: "analysis" | "catalog";
  readonly proposalId: string;
  readonly ownerId: string;
  readonly proposalHash: Sha256Digest;
  readonly valueHash: Sha256Digest;
  readonly proposedValues: AnalysisProposalValues | CatalogProposalValues | null;
  readonly evidenceIds: readonly string[];
  readonly coverage: number | null;
  readonly rationale: string;
  readonly preconditions: readonly HashPrecondition[];
  readonly decision: ProposalDecision;
  readonly outcome: ProposalOutcome | null;
  readonly createdAt: string;
  readonly decidedAt: string | null;
  readonly compactedAt: string | null;
}

export interface CouncilRecord {
  readonly kind: "compact_council_vote";
  readonly evidenceId: string;
  readonly epochId: string;
  readonly candidateId: string;
  readonly proposalId: string | null;
  readonly reviewer: CouncilReviewerRole;
  readonly verdict: "support" | "oppose" | "abstain";
  readonly evidenceDocumentIds: readonly number[];
  readonly inspectedDocuments: number;
  readonly totalDocuments: number;
  readonly coverage: number;
  readonly coverageHash: Sha256Digest;
  readonly xReceiptCount: number;
  readonly yReceiptCount: number | null;
  readonly xReceiptHash: Sha256Digest;
  readonly yReceiptHash: Sha256Digest | null;
  readonly proposalFingerprint: Sha256Digest;
  readonly evidenceFingerprint: Sha256Digest;
  readonly rationale: string;
  readonly dissent: string | null;
  readonly createdAt: string;
  readonly decidedAt: string;
}

export interface CompactChairDecisionRecord {
  readonly kind: "compact_chair_decision";
  readonly epochId: string;
  readonly candidateIds: readonly string[];
  readonly proposalId: string;
  readonly verdict: CatalogChairVerdict;
  readonly action: CatalogChairAction;
  readonly sourceEntityId: number;
  readonly targetEntityId: number | null;
  readonly rationale: string;
  readonly dissent: string | null;
  readonly evidenceIds: readonly string[];
  readonly confidence: number;
  readonly proposalFingerprint: Sha256Digest;
  readonly evidenceFingerprint: Sha256Digest;
  readonly coverageHash: Sha256Digest;
  readonly coverageCount: number;
  readonly inspectedDocumentCount: number;
  readonly totalDocumentCount: number;
  readonly createdAt: string;
  readonly decidedAt: string;
}

export interface LeaseRecord {
  readonly kind: "lease_record";
  readonly leaseId: string;
  readonly scope: LedgerScope;
  readonly resourceId: string;
  readonly owner: string;
  readonly runId: string;
  readonly acquiredAt: string;
  readonly heartbeatAt: string;
  readonly expiresAt: string;
}

export interface LeaseAcquireInput {
  readonly scope: LedgerScope;
  readonly resourceId: string | number;
  readonly owner: string;
  readonly runId?: string;
  readonly ttlMs?: number;
}

export interface LeaseAcquireResult {
  readonly acquired: boolean;
  readonly lease: LeaseRecord;
  readonly staleRecovered: boolean;
}

export interface ProviderUsageRecord {
  readonly kind: "usage_record";
  readonly usageId: string;
  readonly provider: string;
  readonly model: string;
  readonly operation: "analysis" | "catalog" | "ocr" | "embedding" | "other";
  readonly runId?: string;
  readonly promptTokens: number;
  readonly completionTokens: number;
  readonly totalTokens: number;
  readonly costMicros: number | null;
  readonly latencyMs: number | null;
  readonly recordedAt: string;
}

export interface RandomCycleRecord {
  readonly kind: "random_cycle_state";
  readonly cycleKey: string;
  readonly documentIdHashes: readonly Sha256Digest[];
  readonly cursor: number;
  readonly selectedRunIds: readonly string[];
  readonly resetCount: number;
  readonly updatedAt: string;
}

export interface CompactionRecord {
  readonly kind: "coverage_summary";
  readonly compactionId: string;
  readonly cutoff: string;
  readonly compactedAt: string;
  readonly removedLedgerEntries: number;
  readonly removedProviderUsage: number;
  readonly removedRuns: number;
  readonly removedCatalogEpochs: number;
  readonly removedProposals: number;
  readonly removedCouncilRecords: number;
  readonly removedApplyJournals: number;
  readonly compactedProposals: number;
  readonly compactedApplyJournals: number;
}

export interface ApplyJournalStepRecord {
  readonly stepId: string;
  readonly operation: CatalogOperation;
  readonly paperlessTaskId: string | null;
  readonly beforeHash: Sha256Digest;
  readonly afterHash: Sha256Digest | null;
  readonly status: "pending" | "running" | "succeeded" | "failed" | "skipped" | "canceled";
  readonly errorCode?: string;
  readonly recordedAt: string;
}

export interface ApplyJournalRecord {
  readonly kind: "apply_journal";
  readonly journalId: string;
  readonly proposalId: string;
  readonly epochId: string;
  readonly idempotencyKeyHash: Sha256Digest;
  readonly status: "accepted" | "applying" | "succeeded" | "failed" | "conflict" | "canceled";
  readonly preconditionHashes: readonly Sha256Digest[];
  readonly steps: readonly ApplyJournalStepRecord[];
  readonly stepCount: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly compactedAt: string | null;
}

export interface OperationalLedgerData {
  readonly schemaVersion: typeof OPERATIONAL_LEDGER_SCHEMA_VERSION;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly settings: OperationalLedgerSettings;
  readonly ledgerEntries: readonly StorageLedgerEntry[];
  readonly analysisRuns: Record<string, AnalysisRunRecord>;
  readonly catalogEpochs: Record<string, CatalogEpochRecord>;
  readonly proposals: Record<string, ProposalRecord>;
  readonly councilRecords: Record<string, CouncilRecord>;
  readonly chairDecisions: Record<string, CompactChairDecisionRecord>;
  readonly applyJournals: Record<string, ApplyJournalRecord>;
  readonly providerUsage: readonly ProviderUsageRecord[];
  readonly randomCycles: Record<string, RandomCycleRecord>;
  readonly leases: Record<string, LeaseRecord>;
  readonly compactions: readonly CompactionRecord[];
}

export interface OperationalLedgerPaths {
  readonly dataDir: string;
  readonly file: string;
}

export type CompactRecordKind =
  | AnalysisRunRecord["kind"]
  | CatalogEpochRecord["kind"]
  | ProposalRecord["kind"]
  | CouncilRecord["kind"]
  | CompactChairDecisionRecord["kind"]
  | LeaseRecord["kind"]
  | ProviderUsageRecord["kind"]
  | RandomCycleRecord["kind"]
  | CompactionRecord["kind"]
  | SanitizedFailureRecord["kind"]
  | OperationalLedgerSettings["kind"]
  | AllowedStorageArtifactKind;

export interface OperationalLedgerSnapshot {
  readonly paths: OperationalLedgerPaths;
  readonly data: OperationalLedgerData;
}
