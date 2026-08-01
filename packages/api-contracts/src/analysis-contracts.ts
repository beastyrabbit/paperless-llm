import { Schema } from "effect";
import {
  AnalysisRunIdSchema,
  HashPreconditionSchema,
  IsoDateTimeSchema,
  ProposalIdSchema,
  Sha256DigestSchema,
} from "./hash-contracts.js";
import { CustomFieldIdSchema, DocumentIdSchema, TagIdSchema } from "./ids.js";
import {
  PageInfoSchema,
  PageRequestSchema,
  PaginatedResponseSchema,
} from "./pagination-contracts.js";
import { AnalysisRunStateSchema } from "./state-machines.js";
import {
  duplicateIdErrors,
  missingConfiguredIdErrors,
  type StrictDecodeResult,
  strictDecode,
  unknownKeyErrors,
} from "./strict-contracts.js";

const ConciseTextSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(1_200));
const ShortTextSchema = Schema.String.pipe(Schema.minLength(1), Schema.maxLength(512));
const ConfidenceSchema = Schema.Number.pipe(
  Schema.greaterThanOrEqualTo(0),
  Schema.lessThanOrEqualTo(1),
);
const NonNegativeIntSchema = Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0));

export const HashFreshnessProjectionSchema = Schema.Struct({
  status: Schema.Literal("fresh", "stale", "current_missing"),
  stale: Schema.Boolean,
  currentMissing: Schema.Boolean,
  expectedPreconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  currentPreconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.optional),
}).annotations({ identifier: "HashFreshnessProjection" });
export type HashFreshnessProjection = Schema.Schema.Type<typeof HashFreshnessProjectionSchema>;

export const AnalysisRunStartBodySchema = Schema.Struct({
  documentId: DocumentIdSchema,
  forceOcr: Schema.Boolean.pipe(Schema.optional),
  requestId: Schema.String.pipe(Schema.optional),
}).annotations({ identifier: "AnalysisRunStartBody" });
export type AnalysisRunStartBody = Schema.Schema.Type<typeof AnalysisRunStartBodySchema>;

const analysisRunStartAllowedKeys = ["documentId", "forceOcr", "requestId"] as const;

export const strictDecodeAnalysisRunStartBody = (
  input: unknown,
): StrictDecodeResult<AnalysisRunStartBody> =>
  strictDecode(AnalysisRunStartBodySchema, input, (_value, raw) =>
    unknownKeyErrors(raw, analysisRunStartAllowedKeys),
  );

export const AnalysisRunAcceptedSchema = Schema.Struct({
  status: Schema.Literal(202),
  runId: AnalysisRunIdSchema,
  state: AnalysisRunStateSchema,
  acceptedAt: IsoDateTimeSchema,
  progressUrl: Schema.String,
  statusUrl: Schema.String,
}).annotations({ identifier: "AnalysisRunAccepted" });
export type AnalysisRunAccepted = Schema.Schema.Type<typeof AnalysisRunAcceptedSchema>;

export const AnalysisFailureSchema = Schema.Struct({
  code: Schema.Literal(
    "PAPERLESS_UNAVAILABLE",
    "SOURCE_HASH_MISMATCH",
    "PROVIDER_MALFORMED",
    "PROVIDER_FAILURE",
    "STORAGE_POLICY_VIOLATION",
    "STATE_TRANSITION_CONFLICT",
    "CANCELED",
    "RETRY_EXHAUSTED",
    "STALE_PRECONDITION",
    "REJECTED",
    "UNKNOWN",
  ),
  message: ConciseTextSchema,
  failedAt: IsoDateTimeSchema,
  retryable: Schema.Boolean,
  provider: Schema.String.pipe(Schema.optional),
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.optional),
}).annotations({ identifier: "AnalysisFailure" });
export type AnalysisFailure = Schema.Schema.Type<typeof AnalysisFailureSchema>;

export const AnalysisRunSchema = Schema.Struct({
  runId: AnalysisRunIdSchema,
  state: AnalysisRunStateSchema,
  documentId: DocumentIdSchema,
  forceOcr: Schema.Boolean,
  sourcePdfHash: Schema.NullOr(Sha256DigestSchema),
  documentStateHash: Sha256DigestSchema,
  createdAt: IsoDateTimeSchema,
  updatedAt: IsoDateTimeSchema,
  completedAt: Schema.NullOr(IsoDateTimeSchema),
  retryCount: NonNegativeIntSchema,
  failure: Schema.NullOr(AnalysisFailureSchema),
}).annotations({ identifier: "AnalysisRun" });
export type AnalysisRun = Schema.Schema.Type<typeof AnalysisRunSchema>;

export const AnalysisRunListQuerySchema = Schema.extend(
  PageRequestSchema,
  Schema.Struct({
    state: AnalysisRunStateSchema.pipe(Schema.optional),
    documentId: DocumentIdSchema.pipe(Schema.optional),
  }),
).annotations({ identifier: "AnalysisRunListQuery" });

export const AnalysisRunPageSchema = Schema.Struct({
  items: Schema.Array(AnalysisRunSchema),
  page: PageInfoSchema,
}).annotations({ identifier: "AnalysisRunPage" });
export type AnalysisRunPage = Schema.Schema.Type<typeof AnalysisRunPageSchema>;

export const RandomCycleSelectBodySchema = Schema.Struct({
  cycleKey: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  excludeDocumentIds: Schema.Array(DocumentIdSchema).pipe(Schema.optional),
  forceOcr: Schema.Boolean.pipe(Schema.optional),
}).annotations({ identifier: "RandomCycleSelectBody" });
export type RandomCycleSelectBody = Schema.Schema.Type<typeof RandomCycleSelectBodySchema>;

export const RandomCycleResetBodySchema = Schema.Struct({
  cycleKey: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "RandomCycleResetBody" });
export type RandomCycleResetBody = Schema.Schema.Type<typeof RandomCycleResetBodySchema>;

export const RandomCycleSelectAcceptedSchema = Schema.Struct({
  status: Schema.Literal(202),
  cycleKey: Schema.String,
  runId: AnalysisRunIdSchema,
  documentId: DocumentIdSchema,
  taskUrl: Schema.String,
  acceptedAt: IsoDateTimeSchema,
}).annotations({ identifier: "RandomCycleSelectAccepted" });
export type RandomCycleSelectAccepted = Schema.Schema.Type<typeof RandomCycleSelectAcceptedSchema>;

export const AnalysisOcrPreviewDescriptorSchema = Schema.Struct({
  descriptor: ShortTextSchema,
  previewHash: Sha256DigestSchema,
  pageCount: Schema.Number.pipe(Schema.int(), Schema.positive()),
  blockCount: NonNegativeIntSchema,
}).annotations({ identifier: "AnalysisOcrPreviewDescriptor" });
export type AnalysisOcrPreviewDescriptor = Schema.Schema.Type<
  typeof AnalysisOcrPreviewDescriptorSchema
>;

export const AnalysisEvidenceReferenceSchema = Schema.Struct({
  pageNumber: Schema.Number.pipe(Schema.int(), Schema.positive()),
  blockId: Schema.String.pipe(Schema.minLength(1), Schema.maxLength(128)),
  quoteHash: Sha256DigestSchema,
}).annotations({ identifier: "AnalysisEvidenceReference" });
export type AnalysisEvidenceReference = Schema.Schema.Type<typeof AnalysisEvidenceReferenceSchema>;

export const AnalysisFieldEvidenceSchema = Schema.Struct({
  field: Schema.Literal(
    "title",
    "correspondent",
    "document_type",
    "ordinary_tags",
    "new_tag_candidates",
    "custom_field",
  ),
  // Structured Outputs requires every object property to be required. `null`
  // represents "not a custom-field claim"; custom-field evidence carries the ID.
  customFieldId: Schema.NullOr(CustomFieldIdSchema),
  references: Schema.Array(AnalysisEvidenceReferenceSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(12),
  ),
  rationale: ConciseTextSchema,
  confidence: ConfidenceSchema,
}).annotations({ identifier: "AnalysisFieldEvidence" });
export type AnalysisFieldEvidence = Schema.Schema.Type<typeof AnalysisFieldEvidenceSchema>;

export const AnalysisExpiredEvidenceProjectionSchema = Schema.Struct({
  availability: Schema.Literal("evidence_expired"),
  requiresRefresh: Schema.Literal(true),
  refreshAction: Schema.Literal("retry"),
  reason: Schema.Literal("process_restarted", "retention_compacted", "transient_evidence_missing"),
}).annotations({ identifier: "AnalysisExpiredEvidenceProjection" });
export type AnalysisExpiredEvidenceProjection = Schema.Schema.Type<
  typeof AnalysisExpiredEvidenceProjectionSchema
>;

const AnalysisNewTagCandidateBaseSchema = Schema.Struct({
  candidateKey: Schema.String.pipe(Schema.pattern(/^new_tag_[A-Za-z0-9_-]+$/)),
  name: ShortTextSchema,
  color: Schema.NullOr(Schema.String.pipe(Schema.pattern(/^#[0-9A-Fa-f]{6}$/))),
  rationale: ConciseTextSchema,
});

export const AnalysisAvailableNewTagCandidateSchema = Schema.extend(
  AnalysisNewTagCandidateBaseSchema,
  Schema.Struct({
    evidence: Schema.Array(AnalysisEvidenceReferenceSchema).pipe(
      Schema.minItems(1),
      Schema.maxItems(8),
    ),
    confidence: ConfidenceSchema,
  }),
).annotations({ identifier: "AnalysisAvailableNewTagCandidate" });
export type AnalysisAvailableNewTagCandidate = Schema.Schema.Type<
  typeof AnalysisAvailableNewTagCandidateSchema
>;

export const AnalysisExpiredNewTagCandidateSchema = AnalysisNewTagCandidateBaseSchema.annotations({
  identifier: "AnalysisExpiredNewTagCandidate",
});
export type AnalysisExpiredNewTagCandidate = Schema.Schema.Type<
  typeof AnalysisExpiredNewTagCandidateSchema
>;

export const AnalysisNewTagCandidateSchema = AnalysisAvailableNewTagCandidateSchema.annotations({
  identifier: "AnalysisNewTagCandidate",
});
export type AnalysisNewTagCandidate = Schema.Schema.Type<typeof AnalysisNewTagCandidateSchema>;

export const AnalysisCustomFieldValueSchema = Schema.NullOr(
  Schema.Union(
    Schema.String,
    Schema.Number,
    Schema.Boolean,
    Schema.Array(Schema.Union(Schema.String, Schema.Number, Schema.Boolean)),
  ),
).annotations({ identifier: "AnalysisCustomFieldValue" });
export type AnalysisCustomFieldValue = Schema.Schema.Type<typeof AnalysisCustomFieldValueSchema>;

const AnalysisCustomFieldDecisionBaseSchema = Schema.Struct({
  customFieldId: CustomFieldIdSchema,
  operation: Schema.Literal("set", "remove"),
  // Paperless custom-field values are JSON scalars or flat multi-select arrays.
  // Avoid Schema.Unknown here: it generates an unconstrained JSON Schema that
  // Codex strict structured output rejects before inference begins.
  value: AnalysisCustomFieldValueSchema,
  valueHash: Schema.NullOr(Sha256DigestSchema),
});

export const AnalysisAvailableCustomFieldDecisionSchema = Schema.extend(
  AnalysisCustomFieldDecisionBaseSchema,
  Schema.Struct({
    evidence: AnalysisFieldEvidenceSchema,
  }),
).annotations({ identifier: "AnalysisAvailableCustomFieldDecision" });
export type AnalysisAvailableCustomFieldDecision = Schema.Schema.Type<
  typeof AnalysisAvailableCustomFieldDecisionSchema
>;

export const AnalysisExpiredCustomFieldDecisionSchema =
  AnalysisCustomFieldDecisionBaseSchema.annotations({
    identifier: "AnalysisExpiredCustomFieldDecision",
  });
export type AnalysisExpiredCustomFieldDecision = Schema.Schema.Type<
  typeof AnalysisExpiredCustomFieldDecisionSchema
>;

export const AnalysisCustomFieldDecisionSchema =
  AnalysisAvailableCustomFieldDecisionSchema.annotations({
    identifier: "AnalysisCustomFieldDecision",
  });
export type AnalysisCustomFieldDecision = Schema.Schema.Type<
  typeof AnalysisCustomFieldDecisionSchema
>;

export const AnalysisReviewReasonSchema = Schema.Literal(
  "more_than_5_tags",
  "stale_precondition",
  "unusual_metadata",
  "low_confidence",
  "new_catalog_candidate",
  "conflicting_evidence",
  "policy_violation",
  "evidence_expired",
).annotations({ identifier: "AnalysisReviewReason" });
export type AnalysisReviewReason = Schema.Schema.Type<typeof AnalysisReviewReasonSchema>;

const AnalysisReviewSchema = Schema.Struct({
  required: Schema.Boolean,
  reasons: Schema.Array(AnalysisReviewReasonSchema),
  rationale: ConciseTextSchema,
}).annotations({ identifier: "AnalysisReview" });

const AnalysisProposalBaseFields = {
  proposalId: ProposalIdSchema,
  runId: AnalysisRunIdSchema,
  documentId: DocumentIdSchema,
  proposalHash: Sha256DigestSchema,
} as const;

const AnalysisProposalProviderTailFields = {
  review: AnalysisReviewSchema,
  rationale: ConciseTextSchema,
  preconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.minItems(1)),
  createdAt: IsoDateTimeSchema,
} as const;

export const AnalysisAvailableProposalSchema = Schema.Struct({
  ...AnalysisProposalBaseFields,
  proposed: Schema.Struct({
    title: ShortTextSchema,
    correspondentId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    documentTypeId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    ordinaryTagIds: Schema.Array(TagIdSchema),
    newTagCandidates: Schema.Array(AnalysisAvailableNewTagCandidateSchema),
    customFields: Schema.Array(AnalysisAvailableCustomFieldDecisionSchema),
  }),
  ocrPreview: AnalysisOcrPreviewDescriptorSchema,
  fieldEvidence: Schema.Array(AnalysisFieldEvidenceSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
  ),
  confidence: ConfidenceSchema,
  ...AnalysisProposalProviderTailFields,
}).annotations({ identifier: "AnalysisAvailableProposal" });
export type AnalysisAvailableProposal = Schema.Schema.Type<typeof AnalysisAvailableProposalSchema>;

export const AnalysisProposalSchema = AnalysisAvailableProposalSchema.annotations({
  identifier: "AnalysisProposal",
});
export type AnalysisProposal = Schema.Schema.Type<typeof AnalysisProposalSchema>;

const AnalysisEntityLabelSchema = Schema.Struct({
  id: Schema.Number.pipe(Schema.int(), Schema.positive()),
  name: ShortTextSchema,
});

/**
 * Request-scoped names fetched from the current Paperless catalog. These are a
 * read projection only: provider output and the operational ledger continue to
 * carry stable entity IDs, never cached Paperless names.
 */
export const AnalysisEntityLabelsSchema = Schema.Struct({
  tags: Schema.Array(AnalysisEntityLabelSchema),
  correspondents: Schema.Array(AnalysisEntityLabelSchema),
  documentTypes: Schema.Array(AnalysisEntityLabelSchema),
}).annotations({ identifier: "AnalysisEntityLabels" });
export type AnalysisEntityLabels = Schema.Schema.Type<typeof AnalysisEntityLabelsSchema>;

export const AnalysisAvailableProposalProjectionSchema = Schema.Struct({
  ...AnalysisProposalBaseFields,
  evidenceAvailability: Schema.Literal("available"),
  proposed: Schema.Struct({
    title: ShortTextSchema,
    correspondentId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    documentTypeId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    ordinaryTagIds: Schema.Array(TagIdSchema),
    newTagCandidates: Schema.Array(AnalysisAvailableNewTagCandidateSchema),
    customFields: Schema.Array(AnalysisAvailableCustomFieldDecisionSchema),
  }),
  ocrPreview: AnalysisOcrPreviewDescriptorSchema,
  fieldEvidence: Schema.Array(AnalysisFieldEvidenceSchema).pipe(
    Schema.minItems(1),
    Schema.maxItems(100),
  ),
  confidence: ConfidenceSchema,
  ...AnalysisProposalProviderTailFields,
  freshness: HashFreshnessProjectionSchema,
  entityLabels: AnalysisEntityLabelsSchema.pipe(Schema.optional),
}).annotations({ identifier: "AnalysisAvailableProposalProjection" });
export type AnalysisAvailableProposalProjection = Schema.Schema.Type<
  typeof AnalysisAvailableProposalProjectionSchema
>;

export const AnalysisExpiredProposalSchema = Schema.Struct({
  ...AnalysisProposalBaseFields,
  evidenceAvailability: Schema.Literal("evidence_expired"),
  evidence: AnalysisExpiredEvidenceProjectionSchema,
  proposed: Schema.Struct({
    title: ShortTextSchema,
    correspondentId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    documentTypeId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    ordinaryTagIds: Schema.Array(TagIdSchema),
    newTagCandidates: Schema.Array(AnalysisExpiredNewTagCandidateSchema),
    customFields: Schema.Array(AnalysisExpiredCustomFieldDecisionSchema),
  }),
  ...AnalysisProposalProviderTailFields,
  freshness: HashFreshnessProjectionSchema,
  entityLabels: AnalysisEntityLabelsSchema.pipe(Schema.optional),
}).annotations({ identifier: "AnalysisExpiredProposal" });
export type AnalysisExpiredProposal = Schema.Schema.Type<typeof AnalysisExpiredProposalSchema>;

export const AnalysisProposalProjectionSchema = Schema.Union(
  AnalysisAvailableProposalProjectionSchema,
  AnalysisExpiredProposalSchema,
).annotations({ identifier: "AnalysisProposalProjection" });
export type AnalysisProposalProjection = Schema.Schema.Type<
  typeof AnalysisProposalProjectionSchema
>;

export const AnalysisProposalPageSchema = PaginatedResponseSchema(
  AnalysisProposalProjectionSchema,
).annotations({
  identifier: "AnalysisProposalPage",
});
export type AnalysisProposalPage = Schema.Schema.Type<typeof AnalysisProposalPageSchema>;

export const AnalysisReviewQueueItemSchema = Schema.Struct({
  runId: AnalysisRunIdSchema,
  proposalId: ProposalIdSchema,
  documentId: DocumentIdSchema,
  reasons: Schema.Array(AnalysisReviewReasonSchema).pipe(Schema.minItems(1)),
  proposalHash: Sha256DigestSchema,
  createdAt: IsoDateTimeSchema,
}).annotations({ identifier: "AnalysisReviewQueueItem" });
export const AnalysisReviewQueuePageSchema = PaginatedResponseSchema(
  AnalysisReviewQueueItemSchema,
).annotations({ identifier: "AnalysisReviewQueuePage" });
export type AnalysisReviewQueuePage = Schema.Schema.Type<typeof AnalysisReviewQueuePageSchema>;

export const AnalysisFailureQueueItemSchema = Schema.Struct({
  runId: AnalysisRunIdSchema,
  documentId: DocumentIdSchema,
  failure: AnalysisFailureSchema,
  retryCount: NonNegativeIntSchema,
  updatedAt: IsoDateTimeSchema,
}).annotations({ identifier: "AnalysisFailureQueueItem" });
export const AnalysisFailureQueuePageSchema = PaginatedResponseSchema(
  AnalysisFailureQueueItemSchema,
).annotations({ identifier: "AnalysisFailureQueuePage" });
export type AnalysisFailureQueuePage = Schema.Schema.Type<typeof AnalysisFailureQueuePageSchema>;

export const AnalysisDecisionBodySchema = Schema.Struct({
  expectedProposalHash: Sha256DigestSchema,
  reason: ConciseTextSchema.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "AnalysisDecisionBody" });
export type AnalysisDecisionBody = Schema.Schema.Type<typeof AnalysisDecisionBodySchema>;

export const AnalysisRetryBodySchema = Schema.Struct({
  expectedRunStateHash: Sha256DigestSchema,
  reason: ConciseTextSchema.pipe(Schema.optional),
  forceOcr: Schema.Boolean.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "AnalysisRetryBody" });
export type AnalysisRetryBody = Schema.Schema.Type<typeof AnalysisRetryBodySchema>;

export const AnalysisCancelBodySchema = Schema.Struct({
  expectedRunStateHash: Sha256DigestSchema,
  reason: ConciseTextSchema.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "AnalysisCancelBody" });
export type AnalysisCancelBody = Schema.Schema.Type<typeof AnalysisCancelBodySchema>;

export const AnalysisForceOcrBodySchema = Schema.Struct({
  expectedRunStateHash: Sha256DigestSchema,
  reason: ConciseTextSchema.pipe(Schema.optional),
  idempotencyKey: Schema.String.pipe(Schema.minLength(8), Schema.maxLength(128)),
}).annotations({ identifier: "AnalysisForceOcrBody" });
export type AnalysisForceOcrBody = Schema.Schema.Type<typeof AnalysisForceOcrBodySchema>;

export const AnalysisProposalApplyBodySchema = AnalysisDecisionBodySchema.annotations({
  identifier: "AnalysisProposalApplyBody",
});
export type AnalysisProposalApplyBody = Schema.Schema.Type<typeof AnalysisProposalApplyBodySchema>;

export const AnalysisActionAcceptedSchema = Schema.Struct({
  status: Schema.Literal(202),
  runId: AnalysisRunIdSchema,
  proposalId: ProposalIdSchema.pipe(Schema.optional),
  action: Schema.Literal("approve", "reject", "retry", "cancel", "force_ocr", "apply"),
  taskUrl: Schema.String,
  acceptedAt: IsoDateTimeSchema,
}).annotations({ identifier: "AnalysisActionAccepted" });
export type AnalysisActionAccepted = Schema.Schema.Type<typeof AnalysisActionAcceptedSchema>;

export const AnalysisProposalApplyAcceptedSchema = AnalysisActionAcceptedSchema.annotations({
  identifier: "AnalysisProposalApplyAccepted",
});
export type AnalysisProposalApplyAccepted = Schema.Schema.Type<
  typeof AnalysisProposalApplyAcceptedSchema
>;

export const AnalysisSseEventSchema = Schema.Union(
  Schema.Struct({
    event: Schema.Literal("analysis.run.state"),
    data: AnalysisRunSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("analysis.proposal.bundle"),
    data: AnalysisProposalSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("analysis.failure"),
    data: AnalysisFailureSchema,
  }),
  Schema.Struct({
    event: Schema.Literal("analysis.heartbeat"),
    data: Schema.Struct({
      runId: AnalysisRunIdSchema,
      emittedAt: IsoDateTimeSchema,
    }),
  }),
).annotations({ identifier: "AnalysisSseEvent" });
export type AnalysisSseEvent = Schema.Schema.Type<typeof AnalysisSseEventSchema>;

const analysisProposalAllowedKeys = [
  "proposalId",
  "runId",
  "documentId",
  "proposalHash",
  "proposed",
  "ocrPreview",
  "fieldEvidence",
  "review",
  "confidence",
  "rationale",
  "preconditions",
  "createdAt",
] as const;

const availableAnalysisProjectionAllowedKeys = [
  "proposalId",
  "runId",
  "documentId",
  "proposalHash",
  "evidenceAvailability",
  "proposed",
  "ocrPreview",
  "fieldEvidence",
  "review",
  "confidence",
  "rationale",
  "preconditions",
  "freshness",
  "entityLabels",
  "createdAt",
] as const;

const expiredAnalysisProposalAllowedKeys = [
  "proposalId",
  "runId",
  "documentId",
  "proposalHash",
  "evidenceAvailability",
  "evidence",
  "proposed",
  "review",
  "rationale",
  "preconditions",
  "freshness",
  "entityLabels",
  "createdAt",
] as const;

const proposedAllowedKeys = [
  "title",
  "correspondentId",
  "documentTypeId",
  "ordinaryTagIds",
  "newTagCandidates",
  "customFields",
] as const;

const expiredNewTagCandidateAllowedKeys = ["candidateKey", "name", "color", "rationale"] as const;
const availableNewTagCandidateAllowedKeys = [
  "candidateKey",
  "name",
  "color",
  "rationale",
  "evidence",
  "confidence",
] as const;
const expiredCustomFieldAllowedKeys = ["customFieldId", "operation", "value", "valueHash"] as const;
const availableCustomFieldAllowedKeys = [
  "customFieldId",
  "operation",
  "value",
  "valueHash",
  "evidence",
] as const;

const rawRecord = (input: unknown): Record<string, unknown> | undefined =>
  input && typeof input === "object" && !Array.isArray(input)
    ? (input as Record<string, unknown>)
    : undefined;

const nestedUnknownKeyErrors = (
  input: unknown,
  key: string,
  allowedKeys: readonly string[],
  path: readonly string[],
) => {
  const values = rawRecord(input)?.proposed;
  const items = rawRecord(values)?.[key];
  if (!Array.isArray(items)) return [];
  return items.flatMap((item, index) =>
    unknownKeyErrors(item, allowedKeys, [...path, String(index)]),
  );
};

export const strictDecodeAnalysisProposal = (
  input: unknown,
  configuredCustomFieldIds: readonly number[],
): StrictDecodeResult<AnalysisProposal> =>
  strictDecode(AnalysisProposalSchema, input, (value, raw) => {
    return [
      ...unknownKeyErrors(raw, analysisProposalAllowedKeys),
      ...unknownKeyErrors(rawRecord(raw)?.proposed, proposedAllowedKeys, ["proposed"]),
      ...nestedUnknownKeyErrors(raw, "newTagCandidates", availableNewTagCandidateAllowedKeys, [
        "proposed",
        "newTagCandidates",
      ]),
      ...nestedUnknownKeyErrors(raw, "customFields", availableCustomFieldAllowedKeys, [
        "proposed",
        "customFields",
      ]),
      ...duplicateIdErrors(value.proposed.ordinaryTagIds, "ordinaryTagId", [
        "proposed",
        "ordinaryTagIds",
      ]),
      ...duplicateIdErrors(
        value.proposed.customFields.map((field) => field.customFieldId),
        "customFieldId",
        ["proposed", "customFields"],
      ),
      ...missingConfiguredIdErrors(
        configuredCustomFieldIds,
        value.proposed.customFields.map((field) => field.customFieldId),
        "customFieldId",
        ["proposed", "customFields"],
      ),
    ];
  });

export const strictDecodeAnalysisProposalProjection = (
  input: unknown,
  configuredCustomFieldIds: readonly number[],
): StrictDecodeResult<AnalysisProposalProjection> =>
  strictDecode(AnalysisProposalProjectionSchema, input, (value, raw) => {
    const available = value.evidenceAvailability === "available";
    return [
      ...unknownKeyErrors(
        raw,
        available ? availableAnalysisProjectionAllowedKeys : expiredAnalysisProposalAllowedKeys,
      ),
      ...unknownKeyErrors(rawRecord(raw)?.proposed, proposedAllowedKeys, ["proposed"]),
      ...nestedUnknownKeyErrors(
        raw,
        "newTagCandidates",
        available ? availableNewTagCandidateAllowedKeys : expiredNewTagCandidateAllowedKeys,
        ["proposed", "newTagCandidates"],
      ),
      ...nestedUnknownKeyErrors(
        raw,
        "customFields",
        available ? availableCustomFieldAllowedKeys : expiredCustomFieldAllowedKeys,
        ["proposed", "customFields"],
      ),
      ...duplicateIdErrors(value.proposed.ordinaryTagIds, "ordinaryTagId", [
        "proposed",
        "ordinaryTagIds",
      ]),
      ...duplicateIdErrors(
        value.proposed.customFields.map((field) => field.customFieldId),
        "customFieldId",
        ["proposed", "customFields"],
      ),
      ...missingConfiguredIdErrors(
        configuredCustomFieldIds,
        value.proposed.customFields.map((field) => field.customFieldId),
        "customFieldId",
        ["proposed", "customFields"],
      ),
    ];
  });
