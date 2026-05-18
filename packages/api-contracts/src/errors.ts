import { Schema } from "effect";

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

export type ApiResponse<T> =
  | { ok: true; data: T; status: number; error?: never; issues?: never }
  | {
      ok: false;
      error: string;
      status: number;
      issues?: ApiValidationIssue[];
      data?: never;
    };
