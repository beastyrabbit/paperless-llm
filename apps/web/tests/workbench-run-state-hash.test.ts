import type { AnalysisRun } from "@repo/api-contracts";
import { canonicalSha256 } from "@repo/api-contracts";
import { describe, expect, it } from "vitest";
import { analysisRunStateHash, newIdempotencyKey } from "../components/workbench/run-state-hash";

const digest = (seed: string) => `${seed}`.padEnd(64, "0").slice(0, 64);

const baseRun = {
  runId: "ana_run_3Hj9kL",
  state: "failed",
  documentId: 4823,
  forceOcr: false,
  sourcePdfHash: digest("50urce"),
  documentStateHash: digest("de33ad44"),
  createdAt: "2026-07-22T08:20:00Z",
  updatedAt: "2026-07-22T08:22:47Z",
  completedAt: "2026-07-22T08:22:47Z",
  retryCount: 3,
  failure: {
    code: "PROVIDER_MALFORMED",
    message: "OCR provider returned a response that failed schema validation after 3 attempts.",
    failedAt: "2026-07-22T08:22:47Z",
    retryable: true,
    provider: "mistral-ocr",
  },
} as unknown as AnalysisRun;

describe("analysisRunStateHash", () => {
  it("is deterministic for the same run", () => {
    expect(analysisRunStateHash(baseRun)).toBe(analysisRunStateHash(baseRun));
  });

  it("matches the backend canonical shape (runId, state, forceOcr, documentStateHash, retryCount, updatedAt, failure)", () => {
    // Mirrors apps/backend/src/api/analysis/command-handlers.ts#analysisRunStateHash.
    // If a field is dropped or renamed on either side, the token goes stale and
    // this guard fails before a real 409 ever reaches a user.
    const expected = canonicalSha256({
      runId: baseRun.runId,
      documentId: baseRun.documentId,
      forceOcr: baseRun.forceOcr,
      state: baseRun.state,
      documentStateHash: baseRun.documentStateHash,
      retryCount: baseRun.retryCount,
      updatedAt: baseRun.updatedAt,
      failure: {
        code: baseRun.failure?.code,
        failedAt: baseRun.failure?.failedAt,
        messageHash: canonicalSha256(baseRun.failure?.message),
        retryable: baseRun.failure?.retryable,
      },
    });
    expect(analysisRunStateHash(baseRun)).toBe(expected);
  });

  it("hashes null for a run with no failure", () => {
    const clean = { ...baseRun, state: "awaiting_review", failure: null } as unknown as AnalysisRun;
    const expected = canonicalSha256({
      runId: clean.runId,
      documentId: clean.documentId,
      forceOcr: clean.forceOcr,
      state: clean.state,
      documentStateHash: clean.documentStateHash,
      retryCount: clean.retryCount,
      updatedAt: clean.updatedAt,
      failure: null,
    });
    expect(analysisRunStateHash(clean)).toBe(expected);
  });

  it("changes when any hashed field changes", () => {
    const original = analysisRunStateHash(baseRun);
    expect(analysisRunStateHash({ ...baseRun, retryCount: 4 } as AnalysisRun)).not.toBe(original);
    expect(analysisRunStateHash({ ...baseRun, state: "retrying" } as AnalysisRun)).not.toBe(
      original,
    );
    expect(
      analysisRunStateHash({
        ...baseRun,
        documentStateHash: digest("ffffff"),
      } as AnalysisRun),
    ).not.toBe(original);
  });
});

describe("newIdempotencyKey", () => {
  it("produces contract-valid keys (8–128 chars) that are unique per call", () => {
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a.length).toBeGreaterThanOrEqual(8);
    expect(a.length).toBeLessThanOrEqual(128);
    expect(a).not.toBe(b);
  });
});
