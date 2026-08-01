import { Schema } from "effect";

export const ReviewerRoleSchema = Schema.Literal(
  "taxonomy_curator",
  "document_evidence_auditor",
  "counterexample_hunter",
);

export const ReviewerOutputSchema = Schema.Struct({
  reviewer: ReviewerRoleSchema,
  recommendation: Schema.Literal("merge", "keep_separate", "needs_review", "new_entity_allowed"),
  rationale: Schema.String,
  evidenceCitationIds: Schema.Array(Schema.String),
  coverageHash: Schema.String,
  freshnessHash: Schema.String,
  decisiveCounterexample: Schema.Boolean,
  counterexampleCitationIds: Schema.Array(Schema.String),
});

export const ChairOutputSchema = Schema.Struct({
  approval: Schema.Literal("approve_merge", "approve_new_entity", "keep_separate", "needs_review"),
  sourceEntityId: Schema.Number.pipe(Schema.int(), Schema.positive()),
  targetEntityId: Schema.Number.pipe(Schema.int(), Schema.positive()),
  rationale: Schema.String,
  evidenceCitationIds: Schema.Array(Schema.String),
  coverageHash: Schema.String,
  freshnessHash: Schema.String,
});

export const REVIEWER_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "reviewer",
    "recommendation",
    "rationale",
    "evidenceCitationIds",
    "coverageHash",
    "freshnessHash",
    "decisiveCounterexample",
    "counterexampleCitationIds",
  ],
  properties: {
    reviewer: {
      enum: ["taxonomy_curator", "document_evidence_auditor", "counterexample_hunter"],
    },
    recommendation: {
      enum: ["merge", "keep_separate", "needs_review", "new_entity_allowed"],
    },
    rationale: { type: "string" },
    evidenceCitationIds: { type: "array", items: { type: "string" } },
    coverageHash: { type: "string" },
    freshnessHash: { type: "string" },
    decisiveCounterexample: { type: "boolean" },
    counterexampleCitationIds: { type: "array", items: { type: "string" } },
  },
} as const;

export const CHAIR_OUTPUT_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: [
    "approval",
    "sourceEntityId",
    "targetEntityId",
    "rationale",
    "evidenceCitationIds",
    "coverageHash",
    "freshnessHash",
  ],
  properties: {
    approval: {
      enum: ["approve_merge", "approve_new_entity", "keep_separate", "needs_review"],
    },
    sourceEntityId: { type: "integer", minimum: 1 },
    targetEntityId: { type: "integer", minimum: 1 },
    rationale: { type: "string" },
    evidenceCitationIds: { type: "array", items: { type: "string" } },
    coverageHash: { type: "string" },
    freshnessHash: { type: "string" },
  },
} as const;
