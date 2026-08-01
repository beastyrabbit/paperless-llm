import { Schema } from "effect";
import { IsoDateTimeSchema, Sha256DigestSchema } from "./hash-contracts.js";
import { type StrictDecodeResult, strictDecode } from "./strict-contracts.js";

export const AllowedStorageArtifactKindSchema = Schema.Literal(
  "settings",
  "ids_hashes_state",
  "retry_timestamps",
  "sanitized_failure",
  "undecided_analysis_proposal_values",
  "undecided_catalog_proposal_values",
  "compact_council_vote",
  "compact_chair_decision",
  "compact_rationale",
  "evidence_ids",
  "coverage_summary",
  "human_decision",
  "apply_journal",
  "state_journal",
  "lease_record",
  "usage_record",
  "random_cycle_state",
).annotations({ identifier: "AllowedStorageArtifactKind" });
export type AllowedStorageArtifactKind = Schema.Schema.Type<
  typeof AllowedStorageArtifactKindSchema
>;

export const ForbiddenStorageArtifactKindSchema = Schema.Literal(
  "ocr_text",
  "document_content",
  "current_paperless_metadata",
  "prompt",
  "prompt_template",
  "transcript",
  "raw_model_output",
  "request_body",
  "response_body",
  "source_pdf_bytes",
  "source_pdf_text",
  "note_body",
  "paperless_capability_snapshot",
  "structured_output_schema",
).annotations({ identifier: "ForbiddenStorageArtifactKind" });
export type ForbiddenStorageArtifactKind = Schema.Schema.Type<
  typeof ForbiddenStorageArtifactKindSchema
>;

export const StorageArtifactEnvelopeSchema = Schema.Struct({
  kind: AllowedStorageArtifactKindSchema,
  artifactHash: Sha256DigestSchema,
  schemaVersion: Schema.Literal("g0.v1"),
  createdAt: IsoDateTimeSchema,
  references: Schema.Array(Sha256DigestSchema).pipe(Schema.optional),
  metadata: Schema.Record({ key: Schema.String, value: Schema.String }).pipe(Schema.optional),
}).annotations({ identifier: "StorageArtifactEnvelope" });
export type StorageArtifactEnvelope = Schema.Schema.Type<typeof StorageArtifactEnvelopeSchema>;

export const StorageLedgerEntrySchema = Schema.Struct({
  kind: AllowedStorageArtifactKindSchema,
  runId: Schema.String.pipe(Schema.optional),
  proposalId: Schema.String.pipe(Schema.optional),
  state: Schema.String.pipe(Schema.optional),
  retryCount: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)).pipe(
    Schema.optional,
  ),
  timestamp: IsoDateTimeSchema,
  hashes: Schema.Array(Sha256DigestSchema).pipe(Schema.optional),
  rationale: Schema.String.pipe(Schema.maxLength(1_200), Schema.optional),
  evidenceIds: Schema.Array(Schema.String).pipe(Schema.optional),
  coverage: Schema.Number.pipe(Schema.greaterThanOrEqualTo(0), Schema.lessThanOrEqualTo(1)).pipe(
    Schema.optional,
  ),
  valueHash: Sha256DigestSchema.pipe(Schema.optional),
}).annotations({ identifier: "StorageLedgerEntry" });
export type StorageLedgerEntry = Schema.Schema.Type<typeof StorageLedgerEntrySchema>;

export const storageAllowlist = [
  "settings",
  "ids_hashes_state",
  "retry_timestamps",
  "sanitized_failure",
  "undecided_analysis_proposal_values",
  "undecided_catalog_proposal_values",
  "compact_council_vote",
  "compact_chair_decision",
  "compact_rationale",
  "evidence_ids",
  "coverage_summary",
  "human_decision",
  "apply_journal",
  "state_journal",
  "lease_record",
  "usage_record",
  "random_cycle_state",
] as const satisfies readonly AllowedStorageArtifactKind[];

export const storageDenylist = [
  "ocr_text",
  "document_content",
  "current_paperless_metadata",
  "prompt",
  "prompt_template",
  "transcript",
  "raw_model_output",
  "request_body",
  "response_body",
  "source_pdf_bytes",
  "source_pdf_text",
  "note_body",
  "paperless_capability_snapshot",
  "structured_output_schema",
] as const satisfies readonly ForbiddenStorageArtifactKind[];

export const storageForbiddenFieldNames = [
  "ocrText",
  "documentContent",
  "currentPaperlessMetadata",
  "prompt",
  "transcript",
  "rawModelOutput",
  "requestBody",
  "responseBody",
  "body",
] as const;

export const isAllowedStorageArtifactKind = (kind: string): kind is AllowedStorageArtifactKind =>
  (storageAllowlist as readonly string[]).includes(kind) &&
  !(storageDenylist as readonly string[]).includes(kind);

export const assertAllowedStorageArtifactKind = (kind: string): AllowedStorageArtifactKind => {
  if (isAllowedStorageArtifactKind(kind)) return kind;
  throw new TypeError(`Storage artifact kind is not allowed: ${kind}`);
};

export const strictDecodeStorageLedgerEntry = (
  input: unknown,
): StrictDecodeResult<StorageLedgerEntry> =>
  strictDecode(StorageLedgerEntrySchema, input, (_value, raw) => {
    if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return [];
    return storageForbiddenFieldNames
      .filter((field) => Object.hasOwn(raw, field))
      .map((field) => ({
        code: "FORBIDDEN_FIELDS" as const,
        message: `Forbidden storage field: ${field}`,
        path: [field],
      }));
  });
