import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  listFailures: vi.fn(),
  getRun: vi.fn(),
  retryRun: vi.fn(),
  forceOcr: vi.fn(),
  cancelRun: vi.fn(),
  getDocument: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/workbench/failures",
}));

vi.mock("@/lib/api", () => ({
  API_BASE: "",
  analysisApi: {
    listFailures: mocks.listFailures,
    getRun: mocks.getRun,
    retryRun: mocks.retryRun,
    forceOcr: mocks.forceOcr,
    cancelRun: mocks.cancelRun,
  },
  documentsApi: { get: mocks.getDocument },
}));

import { FailuresView } from "../components/workbench/failures-view";

const digest = (seed: string) => seed.padEnd(64, "0");

const providerFailureItem = {
  runId: "ana_run_3Hj9kL",
  documentId: 4823,
  failure: {
    code: "PROVIDER_MALFORMED",
    message: "OCR provider returned an invalid payload.",
    failedAt: "2026-07-22T08:22:47Z",
    retryable: true,
    provider: "mistral-ocr",
  },
  retryCount: 3,
  updatedAt: "2026-07-22T08:22:47Z",
};

const rejectedFailureItem = {
  runId: "ana_run_0Pd3qW",
  documentId: 4762,
  failure: {
    code: "REJECTED",
    message: "Reviewer rejected the proposal; no metadata was written.",
    failedAt: "2026-07-21T16:30:10Z",
    retryable: false,
  },
  retryCount: 0,
  updatedAt: "2026-07-21T16:30:10Z",
};

const failurePage = (items: unknown[]) => ({
  ok: true as const,
  status: 200,
  data: { items, page: { nextCursor: null, hasNextPage: false, limit: 25 } },
});

const runFor = (item: typeof providerFailureItem) => ({
  ok: true as const,
  status: 200,
  data: {
    runId: item.runId,
    state: "failed",
    documentId: item.documentId,
    forceOcr: false,
    sourcePdfHash: digest("src"),
    documentStateHash: digest("state"),
    createdAt: "2026-07-22T08:20:00Z",
    updatedAt: item.updatedAt,
    completedAt: item.updatedAt,
    retryCount: item.retryCount,
    failure: item.failure,
  },
});

beforeEach(() => {
  for (const fn of Object.values(mocks)) fn.mockReset();
  mocks.getDocument.mockResolvedValue({
    ok: true,
    status: 200,
    data: { title: "Doc title", correspondent: null, processing_status: null },
  });
});

describe("FailuresView", () => {
  it("renders sanitized cause, stage and retry history for a failed run", async () => {
    mocks.listFailures.mockResolvedValue(failurePage([providerFailureItem]));
    render(<FailuresView />);

    expect(screen.getByText("Loading failed runs…")).toBeInTheDocument();

    await waitFor(() => expect(screen.getByText("PROVIDER_MALFORMED")).toBeInTheDocument());
    expect(screen.getByText("Provider response malformed")).toBeInTheDocument();
    expect(screen.getByText("stage: mistral-ocr")).toBeInTheDocument();
    expect(screen.getByText(/3 prior retries/)).toBeInTheDocument();
  });

  it("marks a permanent failure as paused with no retry action", async () => {
    mocks.listFailures.mockResolvedValue(failurePage([rejectedFailureItem]));
    render(<FailuresView />);

    await waitFor(() => expect(screen.getByText("Rejected")).toBeInTheDocument());
    expect(screen.getByText("Paused")).toBeInTheDocument();
    expect(screen.getByText("Paused — no automatic retry")).toBeInTheDocument();
    // pause trigger surfaces the sanitized failure code; no locks on this item
    expect(screen.getByText(/Pause trigger:/)).toBeInTheDocument();
    expect(screen.getByText("No identity locks recorded for this pause.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry run" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Inspect run" })).toBeInTheDocument();
  });

  it("retries a run with a freshly computed run-state token and reloads", async () => {
    mocks.listFailures.mockResolvedValue(failurePage([providerFailureItem]));
    mocks.getRun.mockResolvedValue(runFor(providerFailureItem));
    mocks.retryRun.mockResolvedValue({ ok: true, status: 202, data: { action: "retry" } });
    render(<FailuresView />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry run" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry run" }));

    await waitFor(() => expect(mocks.retryRun).toHaveBeenCalledTimes(1));
    expect(mocks.getRun).toHaveBeenCalledWith("ana_run_3Hj9kL");
    const [runId, body] = mocks.retryRun.mock.calls[0];
    expect(runId).toBe("ana_run_3Hj9kL");
    expect(body.expectedRunStateHash).toMatch(/^[0-9a-f]{64}$/);
    expect(body.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    // list is refetched after a successful action
    expect(mocks.listFailures.mock.calls.length).toBeGreaterThanOrEqual(2);
    await waitFor(() => expect(screen.getByText("Retry accepted")).toBeInTheDocument());
  });

  it("surfaces a conflict when the run changed under the queue", async () => {
    mocks.listFailures.mockResolvedValue(failurePage([providerFailureItem]));
    mocks.getRun.mockResolvedValue(runFor(providerFailureItem));
    mocks.retryRun.mockResolvedValue({
      ok: false,
      status: 409,
      error: "State transition conflict",
    });
    render(<FailuresView />);

    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Retry run" })).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByRole("button", { name: "Retry run" }));

    await waitFor(() => expect(screen.getByText(/Expected-identity conflict/)).toBeInTheDocument());
  });

  it("renders the empty state when there are no failures", async () => {
    mocks.listFailures.mockResolvedValue(failurePage([]));
    render(<FailuresView />);

    await waitFor(() => expect(screen.getByText("No failed runs")).toBeInTheDocument());
  });
});
