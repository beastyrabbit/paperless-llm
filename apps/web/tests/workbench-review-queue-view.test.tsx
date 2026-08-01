import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listReviewQueue: vi.fn(),
  listProposals: vi.fn(),
  applyProposal: vi.fn(),
  rejectProposal: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/workbench/review",
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  analysisApi: {
    listReviewQueue: mocks.listReviewQueue,
    listProposals: mocks.listProposals,
    applyProposal: mocks.applyProposal,
    rejectProposal: mocks.rejectProposal,
  },
  documentsApi: { get: mocks.getDocument },
}));

import { ReviewQueueView } from "../components/workbench/review-queue-view";

const digest = (seed: string) => seed.padEnd(64, "0");

const sampleItem = {
  runId: "ana_run_9Zx1pR",
  proposalId: "prop_2Lm4nP",
  documentId: 4790,
  reasons: ["more_than_5_tags", "unusual_metadata"],
  proposalHash: digest("bb22cc33"),
  createdAt: "2026-07-22T08:47:19Z",
};

const availableProposal = {
  proposalId: sampleItem.proposalId,
  runId: sampleItem.runId,
  documentId: sampleItem.documentId,
  proposalHash: sampleItem.proposalHash,
  evidenceAvailability: "available",
  proposed: {
    title: "Utility invoice 2026-06",
    correspondentId: 4,
    documentTypeId: 2,
    ordinaryTagIds: [11, 12, 14],
    newTagCandidates: [],
    customFields: [],
  },
  ocrPreview: {
    descriptor: "Mistral OCR",
    previewHash: digest("0c"),
    pageCount: 2,
    blockCount: 41,
  },
  fieldEvidence: [
    {
      field: "title",
      customFieldId: null,
      references: [{ pageNumber: 1, blockId: "blk_1", quoteHash: digest("e1") }],
      rationale: "Header names the issuer and period.",
      confidence: 0.94,
    },
  ],
  confidence: 0.82,
  review: {
    required: true,
    reasons: sampleItem.reasons,
    rationale: "Held for review.",
  },
  rationale: "Held for review.",
  preconditions: [{ kind: "paperless_document_state", digest: digest("de11") }],
  createdAt: sampleItem.createdAt,
  freshness: {
    status: "fresh",
    stale: false,
    currentMissing: false,
    expectedPreconditions: [{ kind: "paperless_document_state", digest: digest("de11") }],
    currentPreconditions: [{ kind: "paperless_document_state", digest: digest("de11") }],
  },
};

const reviewPage = (items: unknown[]) => ({
  ok: true as const,
  status: 200,
  data: { items, page: { nextCursor: null, hasNextPage: false, limit: 25 } },
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getDocument.mockResolvedValue({
    ok: true,
    status: 200,
    data: {
      title: "Utility invoice 2026-06",
      correspondent: "Stadtwerke",
      processing_status: null,
    },
  });
  mocks.listProposals.mockResolvedValue(reviewPage([availableProposal]));
});

describe("ReviewQueueView", () => {
  it("shows a loading state then renders queued proposals with exact reasons and live title", async () => {
    mocks.listReviewQueue.mockResolvedValue(reviewPage([sampleItem]));
    render(<ReviewQueueView />);

    expect(screen.getByText("Loading review queue…")).toBeInTheDocument();

    await waitFor(() =>
      expect(screen.getByRole("button", { name: /Approve & apply/i })).toBeInTheDocument(),
    );
    expect(screen.getByText("More than 5 tags")).toBeInTheDocument();
    expect(screen.getByText("Unusual metadata")).toBeInTheDocument();
    // live Paperless title hydration
    await waitFor(() => expect(screen.getByText("Utility invoice 2026-06")).toBeInTheDocument());
    expect(mocks.getDocument).toHaveBeenCalledWith(4790);
  });

  it("lazily loads the evidence bundle and freshness on expand", async () => {
    mocks.listReviewQueue.mockResolvedValue(reviewPage([sampleItem]));
    render(<ReviewQueueView />);

    const toggle = await screen.findByRole("button", { name: /Utility invoice 2026-06/i });
    expect(mocks.listProposals).not.toHaveBeenCalled();
    fireEvent.click(toggle);

    await waitFor(() => expect(mocks.listProposals).toHaveBeenCalledWith("ana_run_9Zx1pR"));
    expect(await screen.findByText("Current")).toBeInTheDocument();
    expect(screen.getByText("Header names the issuer and period.")).toBeInTheDocument();
  });

  it("applies the whole bundle using the queue item's proposal hash", async () => {
    mocks.listReviewQueue.mockResolvedValue(reviewPage([sampleItem]));
    mocks.applyProposal.mockResolvedValue({ ok: true, status: 202, data: { action: "apply" } });
    render(<ReviewQueueView />);

    const trigger = await screen.findByRole("button", { name: /Approve & apply/i });
    fireEvent.click(trigger);
    // confirm inside the dialog
    const dialog = await screen.findByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve & apply" }));

    await waitFor(() => expect(mocks.applyProposal).toHaveBeenCalledTimes(1));
    const [runId, body] = mocks.applyProposal.mock.calls[0];
    expect(runId).toBe("ana_run_9Zx1pR");
    expect(body.expectedProposalHash).toBe(sampleItem.proposalHash);
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
  });

  it("renders the empty state when nothing awaits review", async () => {
    mocks.listReviewQueue.mockResolvedValue(reviewPage([]));
    render(<ReviewQueueView />);

    await waitFor(() => expect(screen.getByText("Nothing to review")).toBeInTheDocument());
  });

  it("surfaces an error state with a retry affordance", async () => {
    mocks.listReviewQueue.mockResolvedValue({
      ok: false,
      status: 503,
      error: "Service unavailable",
    });
    render(<ReviewQueueView />);

    await waitFor(() =>
      expect(screen.getByText("Could not load the review queue")).toBeInTheDocument(),
    );
    expect(screen.getByText("Service unavailable")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Try again" })).toBeInTheDocument();
  });
});
