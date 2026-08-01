import { JSONSchema, Schema } from "effect";
import { AnalysisProposalSchema } from "./analysis-contracts.js";
import {
  CompactChairDecisionLedgerContractSchema,
  CouncilEvidenceSchema,
} from "./catalog-contracts.js";
import {
  AnalysisRunIdSchema,
  CatalogEpochIdSchema,
  IsoDateTimeSchema,
  ProposalIdSchema,
  Sha256DigestSchema,
} from "./hash-contracts.js";
import { DocumentIdSchema } from "./ids.js";

export const StructuredOutputSchemaVersionSchema = Schema.Literal(
  "g0.structured-output.v1",
).annotations({
  identifier: "StructuredOutputSchemaVersion",
});

export const CodexDocumentStructuredOutputSchema = Schema.Struct({
  schemaVersion: StructuredOutputSchemaVersionSchema,
  role: Schema.Literal("document"),
  runId: AnalysisRunIdSchema,
  documentId: DocumentIdSchema,
  documentStateHash: Sha256DigestSchema,
  sourcePdfHash: Schema.NullOr(Sha256DigestSchema),
  proposal: AnalysisProposalSchema,
  emittedAt: IsoDateTimeSchema,
}).annotations({ identifier: "CodexDocumentStructuredOutput" });
export type CodexDocumentStructuredOutput = Schema.Schema.Type<
  typeof CodexDocumentStructuredOutputSchema
>;

export const CodexReviewerStructuredOutputSchema = Schema.Struct({
  schemaVersion: StructuredOutputSchemaVersionSchema,
  role: Schema.Literal("reviewer"),
  epochId: CatalogEpochIdSchema,
  evidence: CouncilEvidenceSchema,
  // Strict structured output requires every property. Reviewers use null when
  // no proposal has been materialized yet.
  proposalHash: Schema.NullOr(Sha256DigestSchema),
  emittedAt: IsoDateTimeSchema,
}).annotations({ identifier: "CodexReviewerStructuredOutput" });
export type CodexReviewerStructuredOutput = Schema.Schema.Type<
  typeof CodexReviewerStructuredOutputSchema
>;

export const CodexChairStructuredOutputSchema = Schema.Struct({
  schemaVersion: StructuredOutputSchemaVersionSchema,
  role: Schema.Literal("chair"),
  epochId: CatalogEpochIdSchema,
  proposalId: ProposalIdSchema,
  decision: Schema.Literal("approve", "reject", "revise"),
  compactDecision: CompactChairDecisionLedgerContractSchema,
  rationaleHash: Sha256DigestSchema,
  emittedAt: IsoDateTimeSchema,
}).annotations({ identifier: "CodexChairStructuredOutput" });
export type CodexChairStructuredOutput = Schema.Schema.Type<
  typeof CodexChairStructuredOutputSchema
>;

export const codexStructuredOutputEffectSchemas = {
  document: CodexDocumentStructuredOutputSchema,
  reviewer: CodexReviewerStructuredOutputSchema,
  chair: CodexChairStructuredOutputSchema,
} as const;

export const codexStructuredOutputJsonSchemas = {
  document: JSONSchema.make(CodexDocumentStructuredOutputSchema, { target: "openApi3.1" }),
  reviewer: JSONSchema.make(CodexReviewerStructuredOutputSchema, { target: "openApi3.1" }),
  chair: JSONSchema.make(CodexChairStructuredOutputSchema, { target: "openApi3.1" }),
} as const;
