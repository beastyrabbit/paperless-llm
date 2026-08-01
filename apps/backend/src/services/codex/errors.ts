import { Data } from "effect";

export type CodexRuntimeErrorCode =
  | "CODEX_AUTH_MISSING"
  | "CODEX_AUTH_COPY_FAILED"
  | "CODEX_INVALID_REQUEST"
  | "CODEX_PROCESS_FAILED"
  | "CODEX_TIMEOUT"
  | "CODEX_CANCELED"
  | "CODEX_OUTPUT_CAP_EXCEEDED"
  | "CODEX_STRUCTURED_OUTPUT_INVALID"
  | "CODEX_CLEANUP_FAILED";

export class CodexRuntimeError extends Data.TaggedError("CodexRuntimeError")<{
  readonly code: CodexRuntimeErrorCode;
  readonly message: string;
  readonly exitCode?: number | null;
  readonly signal?: NodeJS.Signals | null;
  readonly cause?: unknown;
  readonly details?: Readonly<Record<string, unknown>>;
}> {}

export const isStructuredOutputInvalid = (error: unknown): error is CodexRuntimeError =>
  error instanceof CodexRuntimeError && error.code === "CODEX_STRUCTURED_OUTPUT_INVALID";
