import type { SanitizedFailureRecord } from "../operational-ledger/types.js";

export type DocumentAnalysisFailureCode = SanitizedFailureRecord["code"];

const secretLikePattern =
  /(Bearer\s+)[A-Za-z0-9._~+/=-]+|([A-Z0-9_]*(?:TOKEN|KEY|SECRET|PASSWORD)[A-Z0-9_]*=)[^\s,;]+/gi;

export class DocumentAnalysisOrchestrationError extends Error {
  constructor(
    readonly code: DocumentAnalysisFailureCode,
    message: string,
    readonly retryable: boolean,
    readonly cause?: unknown,
  ) {
    super(sanitizeFailureMessage(message));
    this.name = "DocumentAnalysisOrchestrationError";
  }
}

export const sanitizeFailureMessage = (message: string): string =>
  message
    .replace(secretLikePattern, (_match, bearerPrefix: string | undefined, keyPrefix: string | undefined) =>
      `${bearerPrefix ?? keyPrefix ?? ""}[REDACTED]`,
    )
    .slice(0, 1_200);

export const classifyFailure = (error: unknown): DocumentAnalysisOrchestrationError => {
  if (error instanceof DocumentAnalysisOrchestrationError) return error;
  const message = error instanceof Error ? error.message : String(error);
  if (/precondition|stale|hash|conflict/i.test(message)) {
    return new DocumentAnalysisOrchestrationError("STALE_PRECONDITION", message, true, error);
  }
  if (/paperless|not found|http|network|fetch/i.test(message)) {
    return new DocumentAnalysisOrchestrationError("PAPERLESS_UNAVAILABLE", message, true, error);
  }
  if (/codex|provider|mistral|ocr/i.test(message)) {
    return new DocumentAnalysisOrchestrationError("PROVIDER_FAILURE", message, true, error);
  }
  return new DocumentAnalysisOrchestrationError("UNKNOWN", message, false, error);
};
