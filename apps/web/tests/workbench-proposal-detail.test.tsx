import type {
  AnalysisProposalProjection,
  AnalysisRun,
  DocumentDetail,
  Sha256Digest,
  TagId,
} from "@repo/api-contracts";
import { act, fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { emptyCatalogIndex } from "../components/workbench/bundle-model";
import { ProposalDetail } from "../components/workbench/proposal-detail";

const h = (seed: string): Sha256Digest => {
  const base = `${seed.replace(/[^a-f0-9]/g, "")}00000000`.slice(0, 8);
  return base.repeat(8) as Sha256Digest;
};

const run: AnalysisRun = {
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

const document: DocumentDetail = {
  id: 4821,
  title: "Scan_0007.pdf",
  correspondent: null,
  correspondent_id: null,
  document_type: null,
  document_type_id: null,
  created: "2026-07-01T00:00:00Z",
  modified: "2026-07-20T10:00:00Z",
  added: "2026-07-01T00:00:00Z",
  tags: [],
  processing_status: null,
  custom_fields: [],
  content: null,
  original_file_name: null,
  archive_serial_number: null,
};

const available: AnalysisProposalProjection = {
  proposalId: "prop_9Xk2mQ",
  runId: "ana_run_7Ab3cD",
  documentId: 4821 as AnalysisRun["documentId"],
  proposalHash: h("aa11bb22"),
  evidenceAvailability: "available",
  proposed: {
    title: "Utility invoice 2026-06",
    correspondentId: null,
    documentTypeId: null,
    ordinaryTagIds: [19 as TagId, 73 as TagId],
    newTagCandidates: [],
    customFields: [],
  },
  entityLabels: {
    tags: [
      { id: 19, name: "Steuer" },
      { id: 73, name: "VAT" },
    ],
    correspondents: [],
    documentTypes: [],
  },
  ocrPreview: {
    descriptor: "Mistral OCR · 2 pages",
    previewHash: h("0c17ea90"),
    pageCount: 2,
    blockCount: 41,
  },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [{ pageNumber: 1, blockId: "blk_1", quoteHash: h("e1a2b3c4") }],
      rationale: "Header names the issuer and period.",
      confidence: 0.9,
    },
  ],
  confidence: 0.82,
  review: { required: true, reasons: ["low_confidence"], rationale: "Below auto-apply threshold." },
  rationale: "Consistent across pages.",
  preconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  createdAt: "2026-07-22T09:14:05Z",
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  },
};

const stale: AnalysisProposalProjection = {
  ...available,
  freshness: {
    status: "stale",
    stale: true,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
    currentPreconditions: [{ kind: "paperless_document_state", digest: h("ffffffff") }],
  },
};

const expired: AnalysisProposalProjection = {
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
    title: "Utility invoice 2026-06",
    correspondentId: null,
    documentTypeId: null,
    ordinaryTagIds: [19 as TagId, 73 as TagId],
    newTagCandidates: [],
    customFields: [],
  },
  entityLabels: {
    tags: [
      { id: 19, name: "Steuer" },
      { id: 73, name: "VAT" },
    ],
    correspondents: [],
    documentTypes: [],
  },
  review: { required: true, reasons: ["evidence_expired"], rationale: "Evidence gone." },
  rationale: "Consistent.",
  preconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  createdAt: "2026-07-22T09:14:05Z",
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: h("de11ad22") }],
  },
};

const noop = () => {};

const renderDetail = (
  projection: AnalysisProposalProjection,
  overrides: Partial<Parameters<typeof ProposalDetail>[0]> = {},
) =>
  render(
    <ProposalDetail
      run={run}
      projection={projection}
      current={document}
      catalogIndex={emptyCatalogIndex}
      onApprove={noop}
      onReject={noop}
      onForceOcr={noop}
      onRefreshCurrent={noop}
      {...overrides}
    />,
  );

describe("ProposalDetail", () => {
  it("renders the bundle diff + evidence and enables approval when fresh", () => {
    renderDetail(available);
    expect(screen.getByText("Proposal bundle")).toBeInTheDocument();
    expect(screen.getByText("82% confidence")).toBeInTheDocument();
    // Diff surfaces the proposed title.
    expect(screen.getByText("Utility invoice 2026-06")).toBeInTheDocument();
    expect(screen.getByText("Steuer")).toBeInTheDocument();
    expect(screen.getByText("VAT")).toBeInTheDocument();
    expect(screen.queryByText("Tag #19")).not.toBeInTheDocument();
    expect(screen.queryByText("Tag #73")).not.toBeInTheDocument();
    // Evidence rationale is rendered.
    expect(screen.getByText(/Header names the issuer/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve & apply/ })).toBeEnabled();
  });

  it("requires explicit confirmation before applying the whole bundle", async () => {
    const onApprove = vi.fn();
    renderDetail(available, { onApprove });

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Approve & apply/ }));
    });
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/writes the proposed title/i)).toBeInTheDocument();
    expect(onApprove).not.toHaveBeenCalled();

    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: /Apply bundle/ }));
    });
    expect(onApprove).toHaveBeenCalledTimes(1);
  });

  it("blocks approval and shows a conflict banner when stale", () => {
    renderDetail(stale);
    expect(screen.getByText(/Document changed since analysis/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve & apply/ })).toBeDisabled();
    // A stale reviewable run offers a force-OCR path.
    expect(screen.getByRole("button", { name: /Force OCR/ })).toBeInTheDocument();
  });

  it("keeps named proposal values visible when transient evidence has expired", () => {
    renderDetail(expired);
    expect(screen.getAllByText("Evidence expired").length).toBeGreaterThan(0);
    expect(screen.getByText("Persisted metadata proposal")).toBeInTheDocument();
    expect(screen.getByText("Steuer")).toBeInTheDocument();
    expect(screen.getByText("VAT")).toBeInTheDocument();
    expect(screen.queryByText("Tag #19")).not.toBeInTheDocument();
    expect(screen.queryByText("Tag #73")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve & apply/ })).toBeDisabled();
  });
});
