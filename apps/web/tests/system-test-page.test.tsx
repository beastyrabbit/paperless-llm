import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SystemTestPage from "../app/system-test/page";

const mocks = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  getCapabilities: vi.fn(),
  testConnection: vi.fn(),
  startRun: vi.fn(),
  selectRandomCycle: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api", () => ({
  systemApi: {
    getReadiness: mocks.getReadiness,
    getPaperlessCapabilities: mocks.getCapabilities,
  },
  settingsApi: { testConnection: mocks.testConnection },
  analysisApi: {
    startRun: mocks.startRun,
    selectRandomCycle: mocks.selectRandomCycle,
  },
}));

const capabilities = {
  supportsOriginalContent: true,
  supportsVersionContent: true,
  supportsFullPagination: true,
  supportsBulkOperations: true,
  supportsTaskPolling: true,
  supportsNotes: true,
  supportsMutationRereads: true,
  supportsConditionalPreconditions: true,
};

describe("SystemTestPage", () => {
  beforeEach(() => {
    mocks.getReadiness.mockReset().mockResolvedValue({
      ok: true,
      data: { analysisReady: true, blockers: [] },
    });
    mocks.getCapabilities.mockReset().mockResolvedValue({ ok: true, data: capabilities });
    mocks.testConnection.mockReset().mockResolvedValue({
      ok: true,
      data: { status: "success", message: "Connected", details: null },
    });
    mocks.startRun.mockReset().mockResolvedValue({
      ok: true,
      data: { runId: "run_test_1", documentId: 42, accepted: true },
    });
    mocks.selectRandomCycle.mockReset().mockResolvedValue({
      ok: true,
      data: {
        status: 202,
        cycleKey: "system-test-canary",
        runId: "run_random_1",
        documentId: 73,
        taskUrl: "/api/analysis/runs/run_random_1",
        acceptedAt: "2026-07-24T10:00:00Z",
      },
    });
  });

  it("gates the paid live document action behind a passing read-only preflight", async () => {
    render(<SystemTestPage />);

    const start = screen.getByRole("button", { name: "Start specific document" });
    expect(start).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Run all checks" }));
    await waitFor(() => expect(screen.getByText("6/6")).toBeInTheDocument());
    expect(mocks.testConnection).toHaveBeenCalledTimes(4);

    fireEvent.change(screen.getByLabelText("Paperless document ID"), {
      target: { value: "42" },
    });
    expect(start).toBeEnabled();
    fireEvent.click(start);

    await waitFor(() =>
      expect(mocks.startRun).toHaveBeenCalledWith({ documentId: 42, forceOcr: false }),
    );
    expect(await screen.findByText("run_test_1")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open detailed run/i })).toHaveAttribute(
      "href",
      "/workbench/runs/run_test_1",
    );
  });

  it("uses the no-repeat canary cycle to pick a random document and starts its run", async () => {
    render(<SystemTestPage />);

    fireEvent.click(screen.getByRole("button", { name: "Run all checks" }));
    await waitFor(() => expect(screen.getByText("6/6")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Pick random & start" }));

    await waitFor(() =>
      expect(mocks.selectRandomCycle).toHaveBeenCalledWith({
        cycleKey: "system-test-canary",
        forceOcr: false,
      }),
    );
    expect(
      await screen.findByText(/randomly selected paperless document #73/i),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Paperless document ID")).toHaveValue("73");
    expect(screen.getByRole("link", { name: /open detailed run/i })).toHaveAttribute(
      "href",
      "/workbench/runs/run_random_1",
    );
  });

  it("keeps live analysis disabled when runtime readiness is blocked", async () => {
    mocks.getReadiness.mockResolvedValue({
      ok: true,
      data: { analysisReady: false, blockers: ["OCRmyPDF is unavailable."] },
    });
    render(<SystemTestPage />);

    fireEvent.click(screen.getByRole("button", { name: "Run all checks" }));

    expect(await screen.findByText("OCRmyPDF is unavailable.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Paperless document ID"), {
      target: { value: "42" },
    });
    expect(screen.getByRole("button", { name: "Start specific document" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Pick random & start" })).toBeDisabled();
  });
});
