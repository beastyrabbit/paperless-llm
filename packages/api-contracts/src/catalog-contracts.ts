import { Schema } from "effect";
import {
  CandidateIdSchema,
  CatalogEpochIdSchema,
  CouncilEvidenceIdSchema,
  HashPreconditionSchema,
  IsoDateTimeSchema,
  ProposalIdSchema,
  Sha256DigestSchema,
} from "./hash-contracts.js";
import { DocumentIdSchema } from "./ids.js";
import { PageRequestSchema, PaginatedResponseSchema } from "./pagination-contracts.js";
import { CatalogStateSchema } from "./state-machines.js";
import {
  duplicateIdErrors,
  type StrictDecodeResult,
  strictDecode,
  unknownKeyErrors,
} from "./strict-contracts.js";

const ConciseTextSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_200));
const ShortTextSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512));
const NonNegativeIntSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0));
const PositiveIntSchema = Schema.Number.pipe(Schema.int(), Schema.positive());
const CoverageSchema = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(1),
);

export const CatalogFreshnessProjectionSchema = Schema.Struct({
  status: Schema.Literal("fresh", "stale", "current_missing"),
  stale: Schema.Boolean,
  currentMissing: Schema.Boolean,
  expectedPreconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  currentPreconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.optional),
}).annotations({ identifier: "CatalogFreshnessProjection" });
export type CatalogFreshnessProjection = Schema.Schema.Type<
  typeof CatalogFreshnessProjectionSchema
>;

export const CatalogRuntimeSchema = Schema.Literal("codex_cli").annotations({
  identifier: "CatalogRuntime",
});
export type CatalogRuntime = Schema.Schema.Type<typeof CatalogRuntimeSchema>;

export const CatalogEntityKindSchema = Schema.Literal(
  "tag",
  "correspondent",
  "document_type",
  "custom_field",
).annotations({ identifier: "CatalogEntityKind" });
export type CatalogEntityKind = Schema.Schema.Type<typeof CatalogEntityKindSchema>;

export const CatalogOperationSchema = Schema.Literal(
  "create",
  "rename",
  "merge",
  "delete",
  "describe",
).annotations({ identifier: "CatalogOperation" });
export type CatalogOperation = Schema.Schema.Type<typeof CatalogOperationSchema>;

export const CatalogEpochStartBodySchema = Schema.Struct({
  scope: Schema.Array(CatalogEntityKindSchema).pipe(Schema.minItems(1), Schema.maxItems(4)),
  expectedPaperlessCatalogHash: Sha256DigestSchema,
  runtime: CatalogRuntimeSchema.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "CatalogEpochStartBody" });
export type CatalogEpochStartBody = Schema.Schema.Type<typeof CatalogEpochStartBodySchema>;

/**
 * Side-effect-free hydration of the current Paperless catalog precondition for a
 * scope. Returned by `GET /api/catalog/current-hash` so the first-ever manual
 * epoch can source its `expectedPaperlessCatalogHash` without a prior epoch.
 */
export const CatalogCurrentHashSchema = Schema.Struct({
  paperlessCatalogHash: Sha256DigestSchema,
  scope: Schema.Array(CatalogEntityKindSchema).pipe(Schema.minItems(1), Schema.maxItems(4)),
}).annotations({ identifier: "CatalogCurrentHash" });
export type CatalogCurrentHash = Schema.Schema.Type<typeof CatalogCurrentHashSchema>;

export const CatalogEpochAcceptedSchema = Schema.Struct({
  status: Schema.Literal(202),
  epochId: CatalogEpochIdSchema,
  state: CatalogStateSchema,
  acceptedAt: IsoDateTimeSchema,
  progressUrl: Schema.String,
  statusUrl: Schema.String,
}).annotations({ identifier: "CatalogEpochAccepted" });
export type CatalogEpochAccepted = Schema.Schema.Type<typeof CatalogEpochAcceptedSchema>;

export const CatalogEpochSchema = Schema.Struct({
  epochId: CatalogEpochIdSchema,
  state: CatalogStateSchema,
  scope: Schema.Array(CatalogEntityKindSchema),
  paperlessCatalogHash: Sha256DigestSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  completedAt: Schema.NullOr(IsoDateTimeSchema),
  retryCount: NonNegativeIntSchema,
  candidateCount: NonNegativeIntSchema,
  evidenceCount: NonNegativeIntSchema,
  proposalCount: NonNegativeIntSchema,
}).annotations({ identifier: "CatalogEpoch" });
export type CatalogEpoch = Schema.Schema.Type<typeof CatalogEpochSchema>;

export const CatalogEpochListQuerySchema = Schema.extend(
  PageRequestSchema,
  Schema.Struct({
    state: CatalogStateSchema.pipe(Schema.optional),
    kind: CatalogEntityKindSchema.pipe(Schema.optional),
  }),
).annotations({ identifier: "CatalogEpochListQuery" });

export const CatalogEpochPageSchema = PaginatedResponseSchema(CatalogEpochSchema).annotations({
  identifier: "CatalogEpochPage",
});
export type CatalogEpochPage = Schema.Schema.Type<typeof CatalogEpochPageSchema>;

export const CatalogEntityReceiptSchema = Schema.Struct({
  entityId: PositiveIntSchema,
  nameHash: Sha256DigestSchema,
  receiptCount: NonNegativeIntSchema,
  documentIdsHash: Sha256DigestSchema,
  // Transient live Paperless name (never persisted; hydrated at read time). Null
  // when the entity no longer exists in Paperless.
  name: Schema.optional(Schema.NullOr(ShortTextSchema)),
}).annotations({ identifier: "CatalogEntityReceipt" });

/**
 * A transient snapshot of a catalog entity's current Paperless identity. Names
 * are hydrated live at read time and never persisted in the ledger.
 */
export const CatalogEntitySnapshotSchema = Schema.Struct({
  entityId: PositiveIntSchema,
  kind: CatalogEntityKindSchema,
  name: Schema.NullOr(ShortTextSchema),
}).annotations({ identifier: "CatalogEntitySnapshot" });
export type CatalogEntitySnapshot = Schema.Schema.Type<typeof CatalogEntitySnapshotSchema>;

export const CatalogProposalCurrentEntitiesSchema = Schema.Struct({
  x: CatalogEntitySnapshotSchema,
  y: Schema.NullOr(CatalogEntitySnapshotSchema),
}).annotations({ identifier: "CatalogProposalCurrentEntities" });
export type CatalogProposalCurrentEntities = Schema.Schema.Type<
  typeof CatalogProposalCurrentEntitiesSchema
>;
export type CatalogEntityReceipt = Schema.Schema.Type<typeof CatalogEntityReceiptSchema>;

export const CatalogCandidateSchema = Schema.Struct({
  candidateId: CandidateIdSchema,
  epochId: CatalogEpochIdSchema,
  kind: CatalogEntityKindSchema,
  intendedAction: CatalogOperationSchema,
  x: CatalogEntityReceiptSchema,
  y: Schema.NullOr(CatalogEntityReceiptSchema),
  proposedValue: Schema.NullOr(ShortTextSchema),
  expectedEvidenceFingerprint: Sha256DigestSchema,
  expectedProposalFingerprint: Sha256DigestSchema,
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  rationale: ConciseTextSchema,
  createdAt: IsoDateTimeSchema,
}).annotations({ identifier: "CatalogCandidate" });
export type CatalogCandidate = Schema.Schema.Type<typeof CatalogCandidateSchema>;

export const CatalogCandidatePageSchema = PaginatedResponseSchema(
  CatalogCandidateSchema,
).annotations({
  identifier: "CatalogCandidatePage",
});
export type CatalogCandidatePage = Schema.Schema.Type<typeof CatalogCandidatePageSchema>;

export const CouncilReviewerRoleSchema = Schema.Literal(
  "taxonomy_curator",
  "document_evidence_auditor",
  "counterexample_hunter",
).annotations({ identifier: "CouncilReviewerRole" });
export type CouncilReviewerRole = Schema.Schema.Type<typeof CouncilReviewerRoleSchema>;

export const CouncilEvidenceSchema = Schema.Struct({
  evidenceId: CouncilEvidenceIdSchema,
  epochId: CatalogEpochIdSchema,
  candidateId: CandidateIdSchema,
  reviewer: CouncilReviewerRoleSchema,
  evidenceDocumentIds: Schema.Array(DocumentIdSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(250),
  ),
  inspectedDocuments: NonNegativeIntSchema,
  totalDocuments: Schema.Number.pipe(Schema.int(), Schema.positive()),
  coverage: CoverageSchema,
  xReceiptCount: NonNegativeIntSchema,
  yReceiptCount: Schema.NullOr(NonNegativeIntSchema),
  xReceiptHash: Sha256DigestSchema,
  yReceiptHash: Schema.NullOr(Sha256DigestSchema),
  verdict: Schema.Literal("support", "oppose", "abstain"),
  dissent: Schema.NullOr(ConciseTextSchema),
  counterexamples: Schema.Array(
    Schema.Struct({
      documentId: DocumentIdSchema,
      rationale: ConciseTextSchema,
      evidenceHash: Sha256DigestSchema,
    }),
  ).pipe(Schema.maxItems(25)),
  rationale: ConciseTextSchema,
  evidenceFingerprint: Sha256DigestSchema,
  createdAt: IsoDateTimeSchema,
}).annotations({ identifier: "CouncilEvidence" });
export type CouncilEvidence = Schema.Schema.Type<typeof CouncilEvidenceSchema>;

export const CouncilEvidencePageSchema = PaginatedResponseSchema(CouncilEvidenceSchema).annotations(
  {
    identifier: "CouncilEvidencePage",
  },
);
export type CouncilEvidencePage = Schema.Schema.Type<typeof CouncilEvidencePageSchema>;

export const CatalogChairVerdictSchema = Schema.Literal(
  "approve",
  "reject",
  "needs_human",
).annotations({
  identifier: "CatalogChairVerdict",
});
export type CatalogChairVerdict = Schema.Schema.Type<typeof CatalogChairVerdictSchema>;

export const CatalogChairActionSchema = Schema.Literal(
  "approve",
  "reject",
  "defer",
  "request_review",
).annotations({
  identifier: "CatalogChairAction",
});
export type CatalogChairAction = Schema.Schema.Type<typeof CatalogChairActionSchema>;

export const CompactChairDecisionLedgerContractSchema = Schema.Struct({
  kind: Schema.Literal("compact_chair_decision"),
  epochId: CatalogEpochIdSchema,
  candidateIds: Schema.Array(CandidateIdSchema).pipe(Schema.minItems(1), Schema.maxItems(100)),
  proposalId: ProposalIdSchema,
  verdict: CatalogChairVerdictSchema,
  action: CatalogChairActionSchema,
  sourceEntityId: PositiveIntSchema,
  targetEntityId: Schema.NullOr(PositiveIntSchema),
  rationale: ConciseTextSchema,
  dissent: Schema.NullOr(ConciseTextSchema),
  evidenceIds: Schema.Array(CouncilEvidenceIdSchema).pipe(Schema.minItems(1), Schema.maxItems(25)),
  confidence: CoverageSchema,
  proposalFingerprint: Sha256DigestSchema,
  evidenceFingerprint: Sha256DigestSchema,
  coverageHash: Sha256DigestSchema,
  coverageCount: NonNegativeIntSchema,
  inspectedDocumentCount: NonNegativeIntSchema,
  totalDocumentCount: PositiveIntSchema,
  createdAt: IsoDateTimeSchema,
  decidedAt: IsoDateTimeSchema,
}).annotations({ identifier: "CompactChairDecisionLedgerContract" });
export type CompactChairDecisionLedgerContract = Schema.Schema.Type<
  typeof CompactChairDecisionLedgerContractSchema
>;

export const CatalogChairDecisionSchema = Schema.Struct({
  availability: Schema.Literal("decision_recorded"),
  verdict: CatalogChairVerdictSchema,
  action: CatalogChairActionSchema,
  sourceEntityId: PositiveIntSchema,
  targetEntityId: Schema.NullOr(PositiveIntSchema),
  rationale: ConciseTextSchema,
  dissent: Schema.NullOr(ConciseTextSchema),
  evidenceIds: Schema.Array(CouncilEvidenceIdSchema).pipe(Schema.minItems(1), Schema.maxItems(25)),
  confidence: CoverageSchema,
  proposalFingerprint: Sha256DigestSchema,
  evidenceFingerprint: Sha256DigestSchema,
  coverageHash: Sha256DigestSchema,
  coverageCount: NonNegativeIntSchema,
  inspectedDocumentCount: NonNegativeIntSchema,
  totalDocumentCount: PositiveIntSchema,
  decidedAt: IsoDateTimeSchema,
}).annotations({ identifier: "CatalogChairDecision" });
export type CatalogChairDecision = Schema.Schema.Type<typeof CatalogChairDecisionSchema>;

export const CatalogProposalEvidenceAvailableSchema = Schema.Struct({
  availability: Schema.Literal("available"),
  evidenceDocumentIds: Schema.Array(DocumentIdSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(500),
  ),
  chair: CatalogChairDecisionSchema,
}).annotations({ identifier: "CatalogProposalEvidenceAvailable" });
export type CatalogProposalEvidenceAvailable = Schema.Schema.Type<
  typeof CatalogProposalEvidenceAvailableSchema
>;

export const CatalogProposalEvidenceExpiredSchema = Schema.Struct({
  availability: Schema.Literal("evidence_expired"),
  needsReview: Schema.Literal(true),
  requiresRefresh: Schema.Literal(true),
  reason: Schema.Literal("chair_decision_missing", "process_restarted", "retention_compacted"),
}).annotations({ identifier: "CatalogProposalEvidenceExpired" });
export type CatalogProposalEvidenceExpired = Schema.Schema.Type<
  typeof CatalogProposalEvidenceExpiredSchema
>;

export const CatalogSafetyDependencySchema = Schema.Struct({
  kind: Schema.Literal("no_active_analysis_runs", "paperless_catalog_hash", "entity_receipts_hash"),
  expectedHash: Sha256DigestSchema,
  rationale: ConciseTextSchema,
}).annotations({ identifier: "CatalogSafetyDependency" });
export type CatalogSafetyDependency = Schema.Schema.Type<typeof CatalogSafetyDependencySchema>;

export const CatalogProposalDecisionStatusSchema = Schema.Literal(
  "undecided",
  "approved",
  "rejected",
  "deferred",
  "applied",
  "failed",
  "conflict",
  "canceled",
).annotations({ identifier: "CatalogProposalDecisionStatus" });
export type CatalogProposalDecisionStatus = Schema.Schema.Type<
  typeof CatalogProposalDecisionStatusSchema
>;

export const CatalogProposalDecisionProjectionSchema = Schema.Struct({
  status: CatalogProposalDecisionStatusSchema,
  outcome: Schema.NullOr(CatalogProposalDecisionStatusSchema),
  decidedAt: Schema.NullOr(IsoDateTimeSchema),
}).annotations({ identifier: "CatalogProposalDecisionProjection" });
export type CatalogProposalDecisionProjection = Schema.Schema.Type<
  typeof CatalogProposalDecisionProjectionSchema
>;

export const CatalogProposalApplyProjectionSchema = Schema.Struct({
  status: Schema.Literal(
    "not_started",
    "accepted",
    "applying",
    "succeeded",
    "failed",
    "conflict",
    "canceled",
  ),
  latestJournalId: Schema.NullOr(Schema.String.pipe(Schema.pattern(/^journal_[A-Za-z0-9_-]+$/))),
  stepCount: NonNegativeIntSchema,
  updatedAt: Schema.NullOr(IsoDateTimeSchema),
}).annotations({ identifier: "CatalogProposalApplyProjection" });
export type CatalogProposalApplyProjection = Schema.Schema.Type<
  typeof CatalogProposalApplyProjectionSchema
>;

export const CatalogProposalSchema = Schema.Struct({
  projectionVersion: Schema.Literal("catalog_proposal_projection.v2"),
  proposalId: ProposalIdSchema,
  epochId: CatalogEpochIdSchema,
  kind: CatalogEntityKindSchema,
  intendedAction: CatalogOperationSchema,
  xEntityId: PositiveIntSchema,
  yEntityId: Schema.NullOr(PositiveIntSchema),
  // Transient live Paperless names for xEntityId / yEntityId (hydrated at read
  // time, never persisted). Lets the UI render names beside the ids.
  currentEntities: Schema.optional(CatalogProposalCurrentEntitiesSchema),
  proposedValue: Schema.NullOr(ShortTextSchema),
  candidateIds: Schema.Array(CandidateIdSchema).pipe(Schema.minItems(1)),
  evidence: Schema.Union(
    CatalogProposalEvidenceAvailableSchema,
    CatalogProposalEvidenceExpiredSchema,
  ),
  expectedProposalFingerprint: Sha256DigestSchema,
  expectedEvidenceFingerprint: Sha256DigestSchema,
  proposalHash: Sha256DigestSchema,
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  freshness: CatalogFreshnessProjectionSchema,
  decision: CatalogProposalDecisionProjectionSchema,
  apply: CatalogProposalApplyProjectionSchema,
  rationale: ConciseTextSchema,
  createdAt: IsoDateTimeSchema,
}).annotations({ identifier: "CatalogProposal" });
export type CatalogProposalContract = Schema.Schema.Type<typeof CatalogProposalSchema>;

export const CatalogProposalPageSchema = PaginatedResponseSchema(CatalogProposalSchema).annotations(
  {
    identifier: "CatalogProposalPage",
  },
);
export type CatalogProposalPage = Schema.Schema.Type<typeof CatalogProposalPageSchema>;

export const ApplyJournalStepSchema = Schema.Struct({
  stepId: Schema.String,
  operation: CatalogOperationSchema,
  paperlessTaskId: Schema.NullOr(Schema.String),
  beforeHash: Sha256DigestSchema,
  afterHash: Schema.NullOr(Sha256DigestSchema),
  status: Schema.Literal("pending", "running", "succeeded", "failed", "skipped", "canceled"),
  errorCode: Schema.String.pipe(Schema.optional),
  recordedAt: IsoDateTimeSchema,
}).annotations({ identifier: "ApplyJournalStep" });
export type ApplyJournalStep = Schema.Schema.Type<typeof ApplyJournalStepSchema>;

export const ApplyJournalSchema = Schema.Struct({
  journalId: Schema.String.pipe(Schema.pattern(/^journal_[A-Za-z0-9_-]+$/)),
  proposalId: ProposalIdSchema,
  epochId: CatalogEpochIdSchema,
  idempotencyKey: Schema.String,
  status: Schema.Literal("accepted", "applying", "succeeded", "failed", "conflict", "canceled"),
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  steps: Schema.Array(ApplyJournalStepSchema),
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
}).annotations({ identifier: "ApplyJournal" });
export type ApplyJournal = Schema.Schema.Type<typeof ApplyJournalSchema>;

export const CatalogProposalDecisionBodySchema = Schema.Struct({
  expectedProposalFingerprint: Sha256DigestSchema,
  reason: ConciseTextSchema.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "CatalogProposalDecisionBody" });
export type CatalogProposalDecisionBody = Schema.Schema.Type<
  typeof CatalogProposalDecisionBodySchema
>;

export const CatalogCancelBodySchema = Schema.Struct({
  expectedEpochStateHash: Sha256DigestSchema,
  reason: ConciseTextSchema.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "CatalogCancelBody" });
export type CatalogCancelBody = Schema.Schema.Type<typeof CatalogCancelBodySchema>;

export const CatalogApplyBodySchema = Schema.Struct({
  expectedProposalFingerprint: Sha256DigestSchema,
  expectedEvidenceFingerprint: Sha256DigestSchema,
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
  dryRun: Schema.Boolean.pipe(Schema.optional),
}).annotations({ identifier: "CatalogApplyBody" });
export type CatalogApplyBody = Schema.Schema.Type<typeof CatalogApplyBodySchema>;

export const CatalogActionAcceptedSchema = Schema.Struct({
  status: Schema.Literal(202),
  epochId: CatalogEpochIdSchema,
  proposalId: ProposalIdSchema.pipe(Schema.optional),
  action: Schema.Literal("start", "cancel", "approve", "reject", "apply"),
  taskUrl: Schema.String,
  acceptedAt: IsoDateTimeSchema,
}).annotations({ identifier: "CatalogActionAccepted" });
export type CatalogActionAccepted = Schema.Schema.Type<typeof CatalogActionAcceptedSchema>;

export const CatalogApplyAcceptedSchema = CatalogActionAcceptedSchema.annotations({
  identifier: "CatalogApplyAccepted",
});
export type CatalogApplyAccepted = Schema.Schema.Type<typeof CatalogApplyAcceptedSchema>;

export const CatalogSseEventSchema = Schema.Union(
  Schema.Struct({
    event: Schema.Literal("catalog.epoch.state"),
    data: CatalogEpochSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("catalog.candidate.created"),
    data: CatalogCandidateSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("catalog.evidence.recorded"),
    data: CouncilEvidenceSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("catalog.apply.journal"),
    data: ApplyJournalSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("catalog.heartbeat"),
    data: Schema.Struct({
      epochId: CatalogEpochIdSchema,
      emittedAt: IsoDateTimeSchema,
    }),
  }),
).annotations({ identifier: "CatalogSseEvent" });
export type CatalogSseEvent = Schema.Schema.Type<typeof CatalogSseEventSchema>;

const catalogEvidenceAllowedKeys = [
  "evidenceId",
  "epochId",
  "candidateId",
  "reviewer",
  "evidenceDocumentIds",
  "inspectedDocuments",
  "totalDocuments",
  "coverage",
  "xReceiptCount",
  "yReceiptCount",
  "xReceiptHash",
  "yReceiptHash",
  "verdict",
  "dissent",
  "counterexamples",
  "rationale",
  "evidenceFingerprint",
  "createdAt",
] as const;

export const strictDecodeCouncilEvidence = (
  input: unknown,
  knownEvidenceDocumentIds: readonly number[],
): StrictDecodeResult<CouncilEvidence> =>
  strictDecode(CouncilEvidenceSchema, input, (value, raw) => {
    const known = new Set(knownEvidenceDocumentIds);
    const unknownEvidenceDocs = value.evidenceDocumentIds
      .filter((id) => !known.has(id))
      .map((id) => ({
        code: "UNKNOWN_KEYS" as const,
        message: `Unknown evidence document ID: ${id}`,
        path: ["evidenceDocumentIds"],
      }));
    return [
      ...unknownKeyErrors(raw, catalogEvidenceAllowedKeys),
      ...duplicateIdErrors(value.evidenceDocumentIds, "evidenceDocumentId", [
        "evidenceDocumentIds",
      ]),
      ...unknownEvidenceDocs,
    ];
  });

const catalogProposalAllowedKeys = [
  "projectionVersion",
  "proposalId",
  "epochId",
  "kind",
  "intendedAction",
  "xEntityId",
  "yEntityId",
  "currentEntities",
  "proposedValue",
  "candidateIds",
  "evidence",
  "expectedProposalFingerprint",
  "expectedEvidenceFingerprint",
  "proposalHash",
  "preconditions",
  "freshness",
  "decision",
  "apply",
  "rationale",
  "createdAt",
] as const;
const catalogProposalDecisionAllowedKeys = ["status", "outcome", "decidedAt"] as const;
const catalogProposalApplyAllowedKeys = [
  "status",
  "latestJournalId",
  "stepCount",
  "updatedAt",
] as const;

const catalogProposalEvidenceAvailableAllowedKeys = [
  "availability",
  "evidenceDocumentIds",
  "chair",
] as const;
const catalogProposalEvidenceExpiredAllowedKeys = [
  "availability",
  "needsReview",
  "requiresRefresh",
  "reason",
] as const;
const catalogChairAllowedKeys = [
  "availability",
  "verdict",
  "action",
  "sourceEntityId",
  "targetEntityId",
  "rationale",
  "dissent",
  "evidenceIds",
  "confidence",
  "proposalFingerprint",
  "evidenceFingerprint",
  "coverageHash",
  "coverageCount",
  "inspectedDocumentCount",
  "totalDocumentCount",
  "decidedAt",
] as const;

const rawRecord = (input: unknown): Record<string, unknown> | undefined =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;

export const strictDecodeCatalogProposal = (
  input: unknown,
): StrictDecodeResult<CatalogProposalContract> =>
  strictDecode(CatalogProposalSchema, input, (value, raw) => {
    const evidence = rawRecord(rawRecord(raw)?.evidence);
    const available = value.evidence.availability === "available";
    const forgedChairEvidence = available
      ? value.evidence.chair.evidenceIds
          .filter((evidenceId) => evidenceId.startsWith("evidence_missing"))
          .map((evidenceId) => ({
            code: "FORBIDDEN_FIELDS" as const,
            message: `Forged chair evidence placeholder is not allowed: ${evidenceId}`,
            path: ["evidence", "chair", "evidenceIds"],
          }))
      : [];
    return [
      ...unknownKeyErrors(raw, catalogProposalAllowedKeys),
      ...unknownKeyErrors(rawRecord(raw)?.decision, catalogProposalDecisionAllowedKeys, [
        "decision",
      ]),
      ...unknownKeyErrors(rawRecord(raw)?.apply, catalogProposalApplyAllowedKeys, ["apply"]),
      ...unknownKeyErrors(
        evidence,
        available
          ? catalogProposalEvidenceAvailableAllowedKeys
          : catalogProposalEvidenceExpiredAllowedKeys,
        ["evidence"],
      ),
      ...(available
        ? unknownKeyErrors(evidence?.chair, catalogChairAllowedKeys, ["evidence", "chair"])
        : []),
      ...forgedChairEvidence,
    ];
  });
