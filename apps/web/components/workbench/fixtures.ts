/**
 * Frozen contract fixtures for the analysis workbench shells.
 *
 * Every value here is typed against the `@repo/api-contracts` shapes, so the
 * TypeScript compiler is the conformance guarantee: if a contract field changes,
 * these fixtures stop compiling. The shells consume ONLY these fixtures — no
 * backend or provider calls, no TinyBase persistence of Paperless rows.
 */
import type {
  AnalysisCustomFieldDecision,
  AnalysisFailure,
  AnalysisFailureQueuePage,
  AnalysisFieldEvidence,
  AnalysisNewTagCandidate,
  AnalysisProposal,
  AnalysisReviewQueuePage,
  AnalysisRun,
  CustomFieldId,
  DocumentId,
  Sha256Digest,
  TagId,
} from "@repo/api-contracts";
import type { DocumentBaseline, EntityLabels } from "./view-types";

export type { AnalysisFailureQueueItem, AnalysisReviewQueueItem } from "./view-types";

// --- brand helpers (contract leaf types are branded; casts keep fixtures typed) ---
const hash = (seed: string): Sha256Digest => {
  const base = `${seed.replace(/[^a-f0-9]/g, "")}00000000`.slice(0, 8);
  return base.repeat(8) as Sha256Digest;
};
const doc = (n: number): DocumentId => n as DocumentId;
const tag = (n: number): TagId => n as TagId;
const field = (n: number): CustomFieldId => n as CustomFieldId;

/** Display labels for entity ids used by the fixtures (test-only bridge). */
export const entityLabels: EntityLabels = {
  tags: {
    11: "Invoice",
    12: "Utilities",
    14: "Tax-relevant",
    21: "Contract",
    33: "Insurance",
  },
  correspondents: {
    4: "Stadtwerke München",
    9: "Finanzamt München",
  },
  documentTypes: {
    2: "Invoice",
    5: "Statement",
  },
  customFields: {
    7: "Invoice total",
    8: "Due date",
  },
};

/** The document's current Paperless metadata fixture (the "before" side of the diff). */
export const documentBaseline: DocumentBaseline = {
  documentId: doc(4821),
  title: "Scan_2026-07-18_0007.pdf",
  correspondentId: null,
  documentTypeId: null,
  ordinaryTagIds: [12],
  customFields: [{ customFieldId: 7, value: "—" }],
};

// --- evidence building blocks -------------------------------------------------
const titleEvidence: AnalysisFieldEvidence = {
  field: "title",
  customFieldId: null,
  references: [
    { pageNumber: 1, blockId: "blk_p1_head_02", quoteHash: hash("e1a2b3c4") },
    { pageNumber: 1, blockId: "blk_p1_head_05", quoteHash: hash("e2b3c4d5") },
  ],
  rationale:
    "Header block names the issuer and billing period; combined they form a stable, human-readable title.",
  confidence: 0.94,
};

const correspondentEvidence: AnalysisFieldEvidence = {
  field: "correspondent",
  customFieldId: null,
  references: [{ pageNumber: 1, blockId: "blk_p1_sender_01", quoteHash: hash("c1d2e3f4") }],
  rationale: "Sender address block matches an existing correspondent by name and VAT id.",
  confidence: 0.88,
};

const tagsEvidence: AnalysisFieldEvidence = {
  field: "ordinary_tags",
  customFieldId: null,
  references: [
    { pageNumber: 1, blockId: "blk_p1_total_09", quoteHash: hash("a9b8c7d6") },
    { pageNumber: 2, blockId: "blk_p2_terms_03", quoteHash: hash("b8c7d6e5") },
  ],
  rationale: "Line-item totals and payment terms indicate an invoice with utility line items.",
  confidence: 0.79,
};

const customFieldEvidence: AnalysisFieldEvidence = {
  field: "custom_field",
  customFieldId: field(7),
  references: [{ pageNumber: 1, blockId: "blk_p1_total_09", quoteHash: hash("a9b8c7d6") }],
  rationale: "Grand-total line resolves the invoice total custom field.",
  confidence: 0.83,
};

const newTagCandidate: AnalysisNewTagCandidate = {
  candidateKey: "new_tag_district_heating",
  name: "District heating",
  color: "#0d9488",
  rationale:
    "Recurring 'Fernwärme' line item has no matching tag; a dedicated tag would improve future routing.",
  evidence: [{ pageNumber: 2, blockId: "blk_p2_line_04", quoteHash: hash("d4e5f6a7") }],
  confidence: 0.61,
};

const customFieldDecision: AnalysisCustomFieldDecision = {
  customFieldId: field(7),
  operation: "set",
  value: "184.20 EUR",
  valueHash: hash("f1e2d3c4"),
  evidence: customFieldEvidence,
};

// --- proposal (the review subject) -------------------------------------------
export const analysisProposal: AnalysisProposal = {
  proposalId: "prop_9Xk2mQ",
  runId: "ana_run_7Ab3cD",
  documentId: doc(4821),
  proposalHash: hash("aa11bb22"),
  proposed: {
    title: "Stadtwerke München — Utility invoice 2026-06",
    correspondentId: 4,
    documentTypeId: 2,
    ordinaryTagIds: [tag(11), tag(12), tag(14)],
    newTagCandidates: [newTagCandidate],
    customFields: [customFieldDecision],
  },
  ocrPreview: {
    descriptor: "Mistral OCR · 2 pages · 41 blocks · de-DE",
    previewHash: hash("0c17ea90"),
    pageCount: 2,
    blockCount: 41,
  },
  fieldEvidence: [titleEvidence, correspondentEvidence, tagsEvidence, customFieldEvidence],
  review: {
    required: true,
    reasons: ["new_catalog_candidate", "low_confidence"],
    rationale:
      "Proposal introduces a new tag candidate and the tag confidence is below the auto-apply threshold.",
  },
  confidence: 0.82,
  rationale:
    "Issuer, period and totals are consistent across pages; a new tag candidate and one soft field keep this in review.",
  preconditions: [
    { kind: "paperless_document_state", digest: hash("de11ad22") },
    { kind: "source_pdf", digest: hash("50urce01") },
    { kind: "analysis_proposal", digest: hash("aa11bb22") },
  ],
  createdAt: "2026-07-22T09:14:05Z",
};

// --- runs (timeline / state coverage) ----------------------------------------
const staleFailure: AnalysisFailure = {
  code: "STALE_PRECONDITION",
  message:
    "Document changed in Paperless after analysis started; the proposal no longer matches the current state.",
  failedAt: "2026-07-22T09:41:12Z",
  retryable: true,
  preconditions: [{ kind: "paperless_document_state", digest: hash("de11ad22") }],
};

const providerFailure: AnalysisFailure = {
  code: "PROVIDER_MALFORMED",
  message: "OCR provider returned a response that failed schema validation after 3 attempts.",
  failedAt: "2026-07-22T08:22:47Z",
  retryable: true,
  provider: "mistral-ocr",
};

const unavailableFailure: AnalysisFailure = {
  code: "PAPERLESS_UNAVAILABLE",
  message: "Paperless-ngx did not respond within the request budget while reading the document.",
  failedAt: "2026-07-22T07:58:03Z",
  retryable: true,
  provider: "paperless",
};

const rejectedFailure: AnalysisFailure = {
  code: "REJECTED",
  message: "Reviewer rejected the proposal; no metadata was written.",
  failedAt: "2026-07-21T16:30:10Z",
  retryable: false,
};

export const analysisRuns: readonly AnalysisRun[] = [
  {
    runId: "ana_run_7Ab3cD",
    state: "awaiting_review",
    documentId: doc(4821),
    forceOcr: false,
    sourcePdfHash: hash("50urce01"),
    documentStateHash: hash("de11ad22"),
    createdAt: "2026-07-22T09:12:40Z",
    updatedAt: "2026-07-22T09:14:05Z",
    completedAt: null,
    retryCount: 0,
    failure: null,
  },
  {
    runId: "ana_run_5Kd8fG",
    state: "analyzing",
    documentId: doc(4822),
    forceOcr: true,
    sourcePdfHash: hash("50urce02"),
    documentStateHash: hash("de22ad33"),
    createdAt: "2026-07-22T09:40:00Z",
    updatedAt: "2026-07-22T09:41:30Z",
    completedAt: null,
    retryCount: 0,
    failure: null,
  },
  {
    runId: "ana_run_3Hj9kL",
    state: "failed",
    documentId: doc(4823),
    forceOcr: false,
    sourcePdfHash: null,
    documentStateHash: hash("de33ad44"),
    createdAt: "2026-07-22T08:20:00Z",
    updatedAt: "2026-07-22T08:22:47Z",
    completedAt: "2026-07-22T08:22:47Z",
    retryCount: 3,
    failure: providerFailure,
  },
  {
    runId: "ana_run_2Gf7hK",
    state: "retrying",
    documentId: doc(4824),
    forceOcr: false,
    sourcePdfHash: hash("50urce04"),
    documentStateHash: hash("de44ad55"),
    createdAt: "2026-07-22T07:55:00Z",
    updatedAt: "2026-07-22T07:59:10Z",
    completedAt: null,
    retryCount: 1,
    failure: null,
  },
  {
    runId: "ana_run_1Ce4bJ",
    state: "succeeded",
    documentId: doc(4820),
    forceOcr: false,
    sourcePdfHash: hash("50urce00"),
    documentStateHash: hash("de00ad11"),
    createdAt: "2026-07-22T06:10:00Z",
    updatedAt: "2026-07-22T06:12:33Z",
    completedAt: "2026-07-22T06:12:33Z",
    retryCount: 0,
    failure: null,
  },
];

export const activeRunId = "ana_run_7Ab3cD";

// --- review queue -------------------------------------------------------------
export const reviewQueue: AnalysisReviewQueuePage = {
  items: [
    {
      runId: "ana_run_7Ab3cD",
      proposalId: "prop_9Xk2mQ",
      documentId: doc(4821),
      reasons: ["new_catalog_candidate", "low_confidence"],
      proposalHash: hash("aa11bb22"),
      createdAt: "2026-07-22T09:14:05Z",
    },
    {
      runId: "ana_run_9Zx1pR",
      proposalId: "prop_2Lm4nP",
      documentId: doc(4790),
      reasons: ["more_than_5_tags"],
      proposalHash: hash("bb22cc33"),
      createdAt: "2026-07-22T08:47:19Z",
    },
    {
      runId: "ana_run_4Qw6tY",
      proposalId: "prop_6Rt8vB",
      documentId: doc(4771),
      reasons: ["conflicting_evidence", "unusual_metadata"],
      proposalHash: hash("cc33dd44"),
      createdAt: "2026-07-22T08:05:52Z",
    },
  ],
  page: { nextCursor: null, hasNextPage: false, limit: 25 },
};

// --- failure queue ------------------------------------------------------------
export const failureQueue: AnalysisFailureQueuePage = {
  items: [
    {
      runId: "ana_run_3Hj9kL",
      documentId: doc(4823),
      failure: providerFailure,
      retryCount: 3,
      updatedAt: "2026-07-22T08:22:47Z",
    },
    {
      runId: "ana_run_8Nb2mV",
      documentId: doc(4801),
      failure: staleFailure,
      retryCount: 0,
      updatedAt: "2026-07-22T09:41:12Z",
    },
    {
      runId: "ana_run_6Vc5xZ",
      documentId: doc(4788),
      failure: unavailableFailure,
      retryCount: 2,
      updatedAt: "2026-07-22T07:58:03Z",
    },
    {
      runId: "ana_run_0Pd3qW",
      documentId: doc(4762),
      failure: rejectedFailure,
      retryCount: 0,
      updatedAt: "2026-07-21T16:30:10Z",
    },
  ],
  page: { nextCursor: null, hasNextPage: false, limit: 25 },
};
