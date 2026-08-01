import { describe, expect, it } from "vitest";
import {
  bucketFailures,
  failureMeta,
  getRecoveryOptions,
  isRecoverable,
  severityTone,
} from "../components/workbench/failure-model";
import { type AnalysisFailureQueueItem, failureQueue } from "../components/workbench/fixtures";

const itemByCode = (code: string): AnalysisFailureQueueItem => {
  const found = failureQueue.items.find((item) => item.failure.code === code);
  if (!found) throw new Error(`fixture missing failure code ${code}`);
  return found;
};

describe("failureMeta", () => {
  it("classifies failure severities", () => {
    expect(failureMeta("PAPERLESS_UNAVAILABLE").severity).toBe("degraded");
    expect(failureMeta("STALE_PRECONDITION").severity).toBe("stale");
    expect(failureMeta("PROVIDER_MALFORMED").severity).toBe("transient");
    expect(failureMeta("REJECTED").severity).toBe("permanent");
  });

  it("maps severities to tones", () => {
    expect(severityTone("permanent")).toBe("danger");
    expect(severityTone("stale")).toBe("warn");
    expect(severityTone("transient")).toBe("info");
  });
});

describe("getRecoveryOptions", () => {
  it("offers retry + force OCR for a stale, retryable run", () => {
    const options = getRecoveryOptions(itemByCode("STALE_PRECONDITION"));
    const actions = options.map((option) => option.action);
    expect(actions).toContain("retry");
    expect(actions).toContain("force_ocr");
    expect(actions).toContain("cancel");
    expect(actions).toContain("inspect");
  });

  it("does not offer retry for a permanent failure", () => {
    const options = getRecoveryOptions(itemByCode("REJECTED"));
    const actions = options.map((option) => option.action);
    expect(actions).not.toContain("retry");
    expect(actions).not.toContain("cancel");
    expect(actions).toEqual(["inspect"]);
  });

  it("marks cancel as the only destructive option", () => {
    const options = getRecoveryOptions(itemByCode("PROVIDER_MALFORMED"));
    const destructive = options.filter((option) => option.destructive).map((o) => o.action);
    expect(destructive).toEqual(["cancel"]);
  });

  it("does not offer force OCR for a plain transient failure", () => {
    const options = getRecoveryOptions(itemByCode("PROVIDER_MALFORMED"));
    expect(options.map((o) => o.action)).not.toContain("force_ocr");
  });
});

describe("isRecoverable + bucketFailures", () => {
  it("treats permanent failures as unrecoverable", () => {
    expect(isRecoverable(itemByCode("REJECTED"))).toBe(false);
    expect(isRecoverable(itemByCode("STALE_PRECONDITION"))).toBe(true);
  });

  it("buckets the fixture queue", () => {
    const buckets = bucketFailures(failureQueue.items);
    expect(buckets.recoverable).toBeGreaterThan(0);
    expect(buckets.permanent).toBeGreaterThan(0);
    expect(buckets.stale).toBeGreaterThan(0);
    expect(buckets.recoverable + buckets.permanent).toBeLessThanOrEqual(failureQueue.items.length + buckets.stale);
  });
});
