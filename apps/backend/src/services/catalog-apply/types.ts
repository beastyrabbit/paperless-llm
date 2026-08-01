import type {
  ApplyJournal,
  CatalogEntityKind,
  HashPrecondition,
  PaperlessTask,
  Sha256Digest,
} from "@repo/api-contracts";
import type { CompactChairDecisionRecord, ProposalRecord } from "../operational-ledger/types.js";
import type { PaperlessAssignmentReceipt } from "../paperless/types.js";

export type CatalogApplySupportedKind = Extract<
  CatalogEntityKind,
  "tag" | "correspondent" | "document_type"
>;

export type CatalogApplyConflictCode =
  | "AMBIGUOUS_WRITE"
  | "ENTITY_NOT_FOUND"
  | "INVALID_PROPOSAL"
  | "LEASE_BUSY"
  | "NOT_HUMAN_APPROVED"
  | "POSTREAD_VERIFICATION_FAILED"
  | "STALE_CATALOG"
  | "STALE_EVIDENCE"
  | "STALE_PROPOSAL"
  | "TASK_FAILED"
  | "UNSAFE_DEPENDENCY"
  | "UNSUPPORTED_KIND";

export class CatalogApplyConflict extends Error {
  constructor(
    readonly code: CatalogApplyConflictCode,
    message: string,
    readonly retryable: boolean,
    readonly details: Readonly<Record<string, unknown>> = {},
  ) {
    super(message);
    this.name = "CatalogApplyConflict";
  }
}

export interface CatalogApplyReceiptSet {
  readonly kind: CatalogApplySupportedKind;
  readonly source: PaperlessAssignmentReceipt;
  readonly target: PaperlessAssignmentReceipt | null;
}

export interface ApplyReviewedCatalogProposalRequest {
  readonly proposal: ProposalRecord;
  readonly chairDecision: CompactChairDecisionRecord;
  readonly expectedProposalFingerprint: Sha256Digest;
  readonly expectedEvidenceFingerprint: Sha256Digest;
  readonly expectedCatalogFingerprint: Sha256Digest;
  readonly idempotencyKey: string;
  readonly unsafeDependencies?: readonly string[];
  readonly batchSize?: number;
  readonly leaseTtlMs?: number;
  readonly taskPollTimeoutMs?: number;
  readonly taskPollIntervalMs?: number;
  readonly createdAt?: string;
}

export interface CatalogApplyResult {
  readonly status: "accepted" | "already_applied" | "applied" | "conflict" | "resumed_applied";
  readonly proposalId: string;
  readonly journal: ApplyJournal;
  readonly leaseId: string | null;
  readonly sourceEntityId: number;
  readonly targetEntityId: number | null;
  readonly migrationDocumentIds: readonly number[];
  readonly paperlessTasks: readonly PaperlessTask[];
  readonly preApplyCatalogFingerprint: Sha256Digest | null;
  readonly postApplyCatalogFingerprint: Sha256Digest | null;
}

export interface CatalogApplyRecoveryOptions {
  readonly taskPollTimeoutMs?: number;
  readonly taskPollIntervalMs?: number;
  readonly recoveredAt?: string;
}

export interface CatalogApplyRecoveryResult {
  readonly journalId: string;
  readonly proposalId: string;
  readonly status: "marked_conflict" | "resumed_applied" | "skipped";
}

export interface CatalogApplyService {
  readonly applyReviewedProposal: (
    request: ApplyReviewedCatalogProposalRequest,
  ) => import("effect").Effect.Effect<CatalogApplyResult, CatalogApplyConflict | unknown, unknown>;
  readonly recoverInterruptedApplies: (
    options?: CatalogApplyRecoveryOptions,
  ) => import("effect").Effect.Effect<
    readonly CatalogApplyRecoveryResult[],
    CatalogApplyConflict | unknown,
    unknown
  >;
}

export interface CatalogApplyPreconditionProof {
  readonly preconditions: readonly HashPrecondition[];
  readonly proposalFingerprint: Sha256Digest;
  readonly evidenceFingerprint: Sha256Digest;
  readonly catalogFingerprint: Sha256Digest;
}
