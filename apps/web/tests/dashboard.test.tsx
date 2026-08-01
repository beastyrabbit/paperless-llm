import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Dashboard from "../app/page";

const mocks = vi.hoisted(() => ({
  getReadiness: vi.fn(),
  listRuns: vi.fn(),
  listEpochs: vi.fn(),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/lib/api", () => ({
  systemApi: { getReadiness: mocks.getReadiness },
  analysisApi: { listRuns: mocks.listRuns },
  catalogWorkbenchApi: { listEpochs: mocks.listEpochs },
}));

const readiness = {
  status: "ready",
  analysisReady: true,
  scanner: { scope: "disabled" },
  blockers: [],
};

describe("Paperless-first dashboard", () => {
  beforeEach(() => {
    mocks.getReadiness.mockReset().mockResolvedValue({ ok: true, data: readiness });
    mocks.listRuns.mockReset().mockResolvedValue({
      ok: true,
      data: {
        items: [
          { runId: "run_active", documentId: 11, state: "analyzing" },
          { runId: "run_review", documentId: 12, state: "awaiting_review" },
          { runId: "run_failed", documentId: 13, state: "failed" },
          { runId: "run_done", documentId: 14, state: "succeeded" },
        ],
      },
    });
    mocks.listEpochs.mockReset().mockResolvedValue({
      ok: true,
      data: { items: [{ epochId: "epoch_1", scope: ["tag"], state: "applied" }] },
    });
  });

  it("loads only the new analysis and catalog projections", async () => {
    render(<Dashboard />);

    expect(await screen.findByRole("heading", { name: "Dashboard" })).toBeInTheDocument();
    expect(await screen.findByText("Paperless-first analysis is ready")).toBeInTheDocument();
    expect(screen.getByText("run_active")).toBeInTheDocument();
    expect(screen.getByText("epoch_1")).toBeInTheDocument();
    expect(screen.getAllByText("1")).toHaveLength(4);
    expect(mocks.listRuns).toHaveBeenCalledWith({ limit: 20 });
    expect(mocks.listEpochs).toHaveBeenCalledWith({ limit: 5 });
  });

  it("refreshes the same read-only projections", async () => {
    render(<Dashboard />);
    await screen.findByText("run_active");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await waitFor(() => expect(mocks.getReadiness).toHaveBeenCalledTimes(2));
    expect(mocks.listRuns).toHaveBeenCalledTimes(2);
    expect(mocks.listEpochs).toHaveBeenCalledTimes(2);
  });
});
