export type MistralOcrErrorKind =
  | "configuration"
  | "validation"
  | "limit"
  | "http"
  | "timeout"
  | "cancelled"
  | "network"
  | "schema"
  | "output_limit";

export type MistralOcrRetryReason = "http_408" | "http_429" | "http_5xx" | "timeout" | "network";

export class MistralOcrError extends Error {
  readonly _tag = "MistralOcrError";
  readonly kind: MistralOcrErrorKind;
  readonly statusCode?: number;
  readonly retryable: boolean;
  readonly retryReason?: MistralOcrRetryReason;
  readonly retryAfterMs?: number;
  readonly cause?: unknown;

  constructor(args: {
    readonly kind: MistralOcrErrorKind;
    readonly message: string;
    readonly statusCode?: number;
    readonly retryable?: boolean;
    readonly retryReason?: MistralOcrRetryReason;
    readonly retryAfterMs?: number;
    readonly cause?: unknown;
  }) {
    super(args.message);
    this.name = "MistralOcrError";
    this.kind = args.kind;
    this.statusCode = args.statusCode;
    this.retryable = args.retryable ?? false;
    this.retryReason = args.retryReason;
    this.retryAfterMs = args.retryAfterMs;
    this.cause = args.cause;
  }
}

export const classifyHttpRetryReason = (statusCode: number): MistralOcrRetryReason | undefined => {
  if (statusCode === 408) return "http_408";
  if (statusCode === 429) return "http_429";
  if (statusCode >= 500) return "http_5xx";
  return undefined;
};

export const isRetryableHttpStatus = (statusCode: number): boolean =>
  statusCode === 408 || statusCode === 429 || statusCode >= 500;
