import { Schema } from "effect";

export const RuntimeToolStatusSchema = Schema.Literal("available", "missing");

export const RuntimeToolCapabilitySchema = Schema.Struct({
  status: RuntimeToolStatusSchema,
  version: Schema.NullOr(Schema.String),
  authenticated: Schema.Boolean.pipe(Schema.optional),
});
export type RuntimeToolCapability = Schema.Schema.Type<typeof RuntimeToolCapabilitySchema>;

export const SystemReadinessSchema = Schema.Struct({
  status: Schema.Literal("ready", "blocked"),
  analysisReady: Schema.Boolean,
  configurationSource: Schema.Literal("environment"),
  mutationMode: Schema.Literal("disabled", "legacy", "paperless_first"),
  scanner: Schema.Struct({
    scope: Schema.Literal("disabled", "canary", "all"),
    aiAnalyseTagId: Schema.NullOr(Schema.Number.pipe(Schema.int(), Schema.positive())),
    canaryDocumentCount: Schema.Number.pipe(Schema.int(), Schema.greaterThanOrEqualTo(0)),
  }),
  providers: Schema.Struct({
    paperless: Schema.Struct({
      configured: Schema.Boolean,
      url: Schema.String,
    }),
    mistral: Schema.Struct({
      configured: Schema.Boolean,
      model: Schema.String,
    }),
    ollama: Schema.Struct({
      configured: Schema.Boolean,
      url: Schema.String,
      model: Schema.String,
      embeddingModel: Schema.String,
    }),
    qdrant: Schema.Struct({
      configured: Schema.Boolean,
      url: Schema.String,
      collection: Schema.String,
      embeddingDimension: Schema.Number.pipe(Schema.int(), Schema.positive()),
    }),
  }),
  codex: Schema.Struct({
    model: Schema.String,
    documentReasoningEffort: Schema.Literal("medium"),
    catalogReviewerReasoningEffort: Schema.Literal("high"),
    catalogChairReasoningEffort: Schema.Literal("xhigh"),
  }),
  tools: Schema.Struct({
    codex: RuntimeToolCapabilitySchema,
    ocrmypdf: RuntimeToolCapabilitySchema,
  }),
  blockers: Schema.Array(Schema.String),
  checkedAt: Schema.String,
});
export type SystemReadiness = Schema.Schema.Type<typeof SystemReadinessSchema>;
