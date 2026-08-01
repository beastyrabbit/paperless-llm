import { Schema } from "effect";
import { HashPreconditionSchema, Sha256DigestSchema } from "./hash-contracts.js";

export const ApiValidationIssueSchema = Schema.Struct({
  path: Schema.Array(Schema.Union(Schema.String, Schema.Number)),
  message: Schema.String,
  code: Schema.String,
});

export type ApiValidationIssue = Schema.Schema.Type<typeof ApiValidationIssueSchema>;

export const ApiErrorSchema = Schema.Struct({
  status: Schema.Number.pipe(Schema.int(), Schema.optional),
  error: Schema.String,
  message: Schema.String.pipe(Schema.optional),
  requestId: Schema.String.pipe(Schema.optional),
  issues: Schema.Array(ApiValidationIssueSchema).pipe(Schema.optional),
});

export type ApiError = Schema.Schema.Type<typeof ApiErrorSchema>;

export const TypedApiErrorCodeSchema = Schema.Literal(
  "VALIDATION_ERROR",
  "NOT_FOUND",
  "STALE_PRECONDITION",
  "CONFLICT",
  "PROVIDER_MALFORMED",
  "PROVIDER_FAILURE",
  "PROVIDER_UNAVAILABLE",
  "PAPERLESS_UNAVAILABLE",
  "PAPERLESS_CONFLICT",
  "STORAGE_POLICY_VIOLATION",
  "STATE_TRANSITION_CONFLICT",
  "CANCELED",
  "RETRY_EXHAUSTED",
  "REVIEW_REQUIRED",
  "REJECTED",
  "APPLY_FAILED",
).annotations({ identifier: "TypedApiErrorCode" });
export type TypedApiErrorCode = Schema.Schema.Type<typeof TypedApiErrorCodeSchema>;

export const TypedApiErrorStatusSchema = Schema.Literal(400, 404, 409, 422, 502, 503).annotations({
  identifier: "TypedApiErrorStatus",
});
export type TypedApiErrorStatus = Schema.Schema.Type<typeof TypedApiErrorStatusSchema>;

export const TypedApiErrorSchema = Schema.Struct({
  status: TypedApiErrorStatusSchema,
  code: TypedApiErrorCodeSchema,
  message: Schema.String,
  requestId: Schema.String.pipe(Schema.optional),
  retryAfterSeconds: Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.optional),
  issues: Schema.Array(ApiValidationIssueSchema).pipe(Schema.optional),
  details: Schema.Record({ key: Schema.String, value: Schema.Unknown }).pipe(Schema.optional),
}).annotations({ identifier: "TypedApiError" });
export type TypedApiError = Schema.Schema.Type<typeof TypedApiErrorSchema>;

export const StalePreconditionErrorSchema = Schema.Struct({
  status: Schema.Literal(409),
  code: Schema.Literal("STALE_PRECONDITION"),
  message: Schema.String,
  preconditionStatus: Schema.Literal("stale", "current_missing").pipe(Schema.optional),
  stale: Schema.Boolean.pipe(Schema.optional),
  currentMissing: Schema.Boolean.pipe(Schema.optional),
  expectedHash: Sha256DigestSchema.pipe(Schema.optional),
  actualHash: Sha256DigestSchema.pipe(Schema.optional),
  expectedPreconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.optional),
  currentPreconditions: Schema.Array(HashPreconditionSchema).pipe(Schema.optional),
}).annotations({ identifier: "StalePreconditionError" });
export type StalePreconditionError = Schema.Schema.Type<typeof StalePreconditionErrorSchema>;

export const ProviderMalformedErrorSchema = Schema.Struct({
  status: Schema.Literal(502),
  code: Schema.Literal("PROVIDER_MALFORMED", "PROVIDER_FAILURE"),
  message: Schema.String,
  provider: Schema.String,
}).annotations({ identifier: "ProviderMalformedError" });
export type ProviderMalformedError = Schema.Schema.Type<typeof ProviderMalformedErrorSchema>;

export const UnavailableErrorSchema = Schema.Struct({
  status: Schema.Literal(503),
  code: Schema.Literal("PROVIDER_UNAVAILABLE", "PAPERLESS_UNAVAILABLE"),
  message: Schema.String,
  retryAfterSeconds: Schema.Number.pipe(Schema.int(), Schema.positive(), Schema.optional),
}).annotations({ identifier: "UnavailableError" });
export type UnavailableError = Schema.Schema.Type<typeof UnavailableErrorSchema>;

export const apiStatusSemantics = {
  accepted: {
    status: 202,
    meaning: "The run or mutation was accepted and must be polled or observed through SSE.",
  },
  staleOrConflict: {
    status: 409,
    meaning: "The supplied hash/precondition or state version is stale, or another writer won.",
  },
  providerMalformedOrFailure: {
    status: 502,
    meaning: "An upstream AI/provider response was malformed or failed after retries.",
  },
  unavailable: {
    status: 503,
    meaning: "A required provider, Paperless, or storage dependency is unavailable.",
  },
} as const;

export type ApiResponse<T> =
  | { ok: true; data: T; status: number; error?: never; issues?: never }
  | {
      ok: false;
      error: string;
      status: number;
      issues?: ApiValidationIssue[];
      data?: never;
    };
