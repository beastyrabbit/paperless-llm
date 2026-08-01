/**
 * Client-side reconstruction of the analysis run optimistic-concurrency token.
 *
 * Retry / cancel / force-OCR commands require `expectedRunStateHash`, the same
 * canonical hash the backend computes over a run record (see
 * `apps/backend/src/api/analysis/command-handlers.ts#analysisRunStateHash`). The
 * hash is NOT surfaced through any read endpoint, so the review / failure shells
 * recompute it from the hydrated `AnalysisRun` returned by `GET /api/analysis/runs/{id}`.
 *
 * Fields and object shape MUST stay in lock-step with the backend. `canonicalSha256`
 * sorts keys, so declaration order is irrelevant, but the *set* of fields is not:
 * a mismatch produces a stale token and the command is rejected with 409, which the
 * callers surface as a "run changed — refresh" conflict rather than a silent failure.
 */
import { type AnalysisRun, canonicalSha256, type Sha256Digest } from "@repo/api-contracts";

export const analysisRunStateHash = (run: AnalysisRun): Sha256Digest =>
  canonicalSha256({
    runId: run.runId,
    documentId: run.documentId,
    forceOcr: run.forceOcr,
    state: run.state,
    documentStateHash: run.documentStateHash,
    retryCount: run.retryCount,
    updatedAt: run.updatedAt,
    failure: run.failure
      ? {
          code: run.failure.code,
          failedAt: run.failure.failedAt,
          messageHash: canonicalSha256(run.failure.message),
          retryable: run.failure.retryable,
        }
      : null,
  });

/**
 * Idempotency keys de-duplicate accepted commands server-side. The contract
 * requires 8–128 chars; a UUID is well within range and unique per click.
 */
export const newIdempotencyKey = (): string => {
  const cryptoObj = typeof globalThis !== "undefined" ? globalThis.crypto : undefined;
  if (cryptoObj?.randomUUID) return cryptoObj.randomUUID();
  // Deterministic-length fallback for environments without WebCrypto.
  return `idem-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`.padEnd(
    12,
    "0",
  );
};
