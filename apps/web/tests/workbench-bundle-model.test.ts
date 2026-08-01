import { describe, expect, it } from "vitest";
import { canonicalSha256 } from "@repo/api-contracts";
import type {
  AnalysisProposalProjection,
  AnalysisRun,
  DocumentDetail,
  Sha256Digest,
} from "@repo/api-contracts";
import {
  buildEntityLabels,
  canApproveBundle,
  computeRunStateHash,
  documentDetailToBaseline,
  emptyCatalogIndex,
  formatCustomFieldValue,
  freshnessStatus,
  isAvailableProjection,
  isExpiredProjection,
  isStaleProjection,
  newIdempotencyKey,
  shouldOfferForceOcr,
} from "../components/workbench/bundle-model";

const h = (seed: string): Sha256Digest => {
  const base = `${seed.replace(/[^a-f0-9]/g, "")}00000000`.slice(0, 8);
  return base.repeat(8) as Sha256Digest;
};

const baseRun: AnalysisRun = {
  runId: "ana_run_7Ab3cD",
  state: "awaiting_review",
  documentId: 4821 as AnalysisRun["documentId"],
  forceOcr: false,
  sourcePdfHash: h("50urce01"),
  documentStateHash: h("de11ad22"),
  createdAt: "2026-07-22T09:12:40Z",
  updatedAt: "2026-07-22T09:14:05Z",
  completedAt: null,
  retryCount: 0,
  failure: null,
};

const freshProjection: AnalysisProposalProjection = {
  proposalId: "prop_9Xk2mQ",
  runId: "ana_run_7Ab3cD",
  documentId: 4821 as AnalysisRun["documentId"],
  proposalHash: h("aa11bb22"),
  evidenceAvailability: "available",
  proposed: {
    title: "Utility invoice",
    correspondentId: 4,
    documentTypeId: 2,
    ordinaryTagIds: [],
    newTagCandidates: [],
    customFields: [],
  },
  ocrPreview: { descriptor: "OCR", previewHash: h("0c17ea90"), pageCount: 2, blockCount: 41 },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [{ pageNumber: 1, blockId: "b1", quoteHash: h("e1a2b3c4") }],
      rationale: "header",
      confidence: 0.9,
    },
  ],
  confidence: 0.82,
  review: { required: true, reasons: ["low_confidence"], rationale: "held" },
  rationale: "r",
  preconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  createdAt: "2026-07-22T09:14:05Z",
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  },
};

const staleProjection: AnalysisProposalProjection = {
  ...freshProjection,
  freshness: {
    status: "stale",
    stale: true,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
    currentPreconditions: [{ kind: "paperless_document_state", digest: h("ffffffff") }],
  },
};

const expiredProjection: AnalysisProposalProjection = {
  proposalId: "prop_9Xk2mQ",
  runId: "ana_run_7Ab3cD",
  documentId: 4821 as AnalysisRun["documentId"],
  proposalHash: h("aa11bb22"),
  evidenceAvailability: "evidence_expired",
  evidence: {
    availability: "evidence_expired",
    requiresRefresh: true,
    refreshAction: "retry",
    reason: "process_restarted",
  },
  proposed: {
    title: "Utility invoice",
    correspondentId: 4,
    documentTypeId: 2,
    ordinaryTagIds: [],
    newTagCandidates: [],
    customFields: [],
  },
  review: { required: true, reasons: ["evidence_expired"], rationale: "expired" },
  rationale: "r",
  preconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  createdAt: "2026-07-22T09:14:05Z",
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  },
};

const documentDetail: DocumentDetail = {
  id: 4821,
  title: "Scan_0007.pdf",
  correspondent: "Stadtwerke",
  correspondent_id: 9,
  document_type: "Letter",
  document_type_id: 3,
  created: "2026-07-01T00:00:00Z",
  modified: "2026-07-20T10:00:00Z",
  added: "2026-07-01T00:00:00Z",
  tags: [{ id: 12, name: "Utilities" }],
  processing_status: null,
  custom_fields: [{ field: 7, value: "old" }],
  content: null,
  original_file_name: null,
  archive_serial_number: null,
};

describe("projection discrimination + freshness", () => {
  it("discriminates available / expired", () => {
    expect(isAvailableProjection(freshProjection)).toBe(true);
    expect(isExpiredProjection(freshProjection)).toBe(false);
    expect(isExpiredProjection(expiredProjection)).toBe(true);
    expect(isAvailableProjection(expiredProjection)).toBe(false);
  });

  it("detects stale / current-missing", () => {
    expect(isStaleProjection(freshProjection)).toBe(false);
    expect(isStaleProjection(staleProjection)).toBe(true);
    expect(freshnessStatus(staleProjection)).toBe("stale");
  });
});

describe("canApproveBundle", () => {
  it("allows approval only when available, fresh and awaiting review", () => {
    expect(canApproveBundle(freshProjection, baseRun)).toBe(true);
  });

  it("blocks approval when stale", () => {
    expect(canApproveBundle(staleProjection, baseRun)).toBe(false);
  });

  it("blocks approval when evidence expired", () => {
    expect(canApproveBundle(expiredProjection, baseRun)).toBe(false);
  });

  it("blocks approval when the run is not awaiting review", () => {
    expect(canApproveBundle(freshProjection, { ...baseRun, state: "analyzing" })).toBe(false);
    expect(canApproveBundle(freshProjection, null)).toBe(false);
  });
});

describe("shouldOfferForceOcr", () => {
  it("offers force OCR when the fresh-but-reviewable proposal is stale", () => {
    expect(shouldOfferForceOcr(staleProjection, baseRun)).toBe(true);
  });

  it("does not offer force OCR for a healthy fresh proposal", () => {
    expect(shouldOfferForceOcr(freshProjection, baseRun)).toBe(false);
  });

  it("offers force OCR for a failed run even without a projection", () => {
    expect(shouldOfferForceOcr(null, { ...baseRun, state: "failed" })).toBe(true);
  });
});

describe("current-value adapters", () => {
  it("maps document detail into a diff baseline", () => {
    const baseline = documentDetailToBaseline(documentDetail);
    expect(baseline.title).toBe("Scan_0007.pdf");
    expect(baseline.correspondentId).toBe(9);
    expect(baseline.ordinaryTagIds).toEqual([12]);
    expect(baseline.customFields).toEqual([{ customFieldId: 7, value: "old" }]);
  });

  it("formats custom field values", () => {
    expect(formatCustomFieldValue(null)).toBe("—");
    expect(formatCustomFieldValue("")).toBe("—");
    expect(formatCustomFieldValue(12)).toBe("12");
    expect(formatCustomFieldValue("184.20 EUR")).toBe("184.20 EUR");
  });

  it("resolves current entity names and falls back to #id", () => {
    const labels = buildEntityLabels(emptyCatalogIndex, documentDetail);
    expect(labels.correspondents[9]).toBe("Stadtwerke");
    expect(labels.documentTypes[3]).toBe("Letter");
    expect(labels.tags[12]).toBe("Utilities");
    // Unknown proposed correspondent id has no name → renderer uses #id.
    expect(labels.correspondents[4]).toBeUndefined();
  });

  it("prefers catalog index names but keeps current-doc names", () => {
    const labels = buildEntityLabels(
      { ...emptyCatalogIndex, tags: new Map([[99, "Contract"]]) },
      documentDetail,
    );
    expect(labels.tags[99]).toBe("Contract");
    expect(labels.tags[12]).toBe("Utilities");
  });
});

describe("computeRunStateHash", () => {
  it("is deterministic and matches the canonical run-state shape", () => {
    const expected = canonicalSha256({
      runId: baseRun.runId,
      documentId: baseRun.documentId,
      forceOcr: baseRun.forceOcr,
      state: baseRun.state,
      documentStateHash: baseRun.documentStateHash,
      retryCount: baseRun.retryCount,
      updatedAt: baseRun.updatedAt,
      failure: null,
    });
    expect(computeRunStateHash(baseRun)).toBe(expected);
    expect(computeRunStateHash(baseRun)).toBe(computeRunStateHash(baseRun));
  });

  it("changes when run state changes", () => {
    expect(computeRunStateHash(baseRun)).not.toBe(
      computeRunStateHash({ ...baseRun, state: "applying" }),
    );
  });

  it("hashes failure detail when present", () => {
    const failed: AnalysisRun = {
      ...baseRun,
      state: "failed",
      failure: {
        code: "PROVIDER_MALFORMED",
        message: "bad",
        failedAt: "2026-07-22T09:20:00Z",
        retryable: true,
      },
    };
    expect(computeRunStateHash(failed)).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe("newIdempotencyKey", () => {
  it("produces keys within the contract's 8–128 length window", () => {
    const key = newIdempotencyKey();
    expect(key.length).toBeGreaterThanOrEqual(8);
    expect(key.length).toBeLessThanOrEqual(128);
    expect(key).not.toBe(newIdempotencyKey());
  });
});
