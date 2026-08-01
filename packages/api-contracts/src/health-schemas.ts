import { Schema } from "effect";

export const HealthDependencyStatusSchema = Schema.Literal("up", "down");
export const OverallHealthSchema = Schema.Literal("healthy", "unhealthy");

export const HealthDependencySchema = Schema.Struct({
  status: HealthDependencyStatusSchema,
  required: Schema.Boolean,
  durationMs: Schema.Number,
  message: Schema.optional(Schema.String),
});

export const HealthServicesSchema = Schema.Struct({
  paperless: HealthDependencySchema,
  ollama: HealthDependencySchema,
  qdrant: HealthDependencySchema,
  mistral: HealthDependencySchema,
});

export const HealthResponseSchema = Schema.Struct({
  status: Schema.Literal(200, 503),
  health: OverallHealthSchema,
  timestamp: Schema.String,
  durationMs: Schema.Number,
  services: HealthServicesSchema,
});
