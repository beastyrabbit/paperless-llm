import type { AnalysisRun, DocumentDetail, Sha256Digest } from "@repo/api-contracts";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const digest = "ab".repeat(32) as Sha256Digest;

const run: AnalysisRun = {
  runId: "run_canary_1",
  state: "analyzing",
  documentId: 73 as AnalysisRun["documentId"],
  forceOcr: false,
  sourcePdfHash: digest,
  documentStateHash: digest,
  createdAt: "2026-07-24T09:00:00Z",
  updatedAt: "2026-07-24T09:01:00Z",
  completedAt: null,
  retryCount: 0,
  failure: null,
};

const current: DocumentDetail = {
  id: 73,
  title: "Canary utility invoice",
  correspondent: "Stadtwerke",
  correspondent_id: 12,
  document_type: "Invoice",
  document_type_id: 9,
  created: "2026-07-01T00:00:00Z",
  modified: "2026-07-24T09:00:00Z",
  added: "2026-07-01T00:00:00Z",
  tags: [{ id: 4, name: "Utilities" }],
  processing_status: null,
  custom_fields: [],
  content: "OCR content",
  original_file_name: "invoice.pdf",
  archive_serial_number: null,
};

const mockWorkbench = vi.hoisted(() => vi.fn());
const mockReadiness = vi.hoisted(() => vi.fn());
const mockRetryRun = vi.hoisted(() => vi.fn());

vi.mock("next/navigation", () => ({
  useParams: () => ({ runId: "run_canary_1" }),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("next/link", () => ({
  default: ({ href, children }: { href: string; children: ReactNode }) => (
    <a href={href}>{children}</a>
  ),
}));

vi.mock("@/components/workbench/use-workbench", () => ({
  useWorkbench: mockWorkbench,
}));

vi.mock("@/lib/api", () => ({
  systemApi: { getReadiness: mockReadiness },
  analysisApi: { retryRun: mockRetryRun },
}));

import AnalysisRunDetailPage from "../app/workbench/runs/[runId]/page";

beforeEach(() => {
  mockWorkbench.mockReset().mockReturnValue({
    runId: run.runId,
    run,
    runs: [run],
    projection: null,
    current,
    currentLoading: false,
    currentError: null,
    catalogIndex: {
      tags: new Map(),
      correspondents: new Map(),
      documentTypes: new Map(),
      customFields: new Map(),
    },
    streamStatus: "open",
    busy: false,
    error: null,
    notice: null,
    approve: vi.fn(),
    reject: vi.fn(),
    forceOcr: vi.fn(),
    refreshCurrent: vi.fn(),
  });
  mockReadiness.mockReset().mockResolvedValue({
    ok: true,
    data: {
      scanner: { scope: "disabled" },
      providers: { paperless: { url: "http://paperless.test" } },
    },
  });
  mockRetryRun.mockReset().mockResolvedValue({
    ok: true,
    data: { runId: "run_canary_retry_1" },
  });
});

describe("AnalysisRunDetailPage", () => {
  it("shows a stable single-run validation surface with live Paperless facts", async () => {
    render(<AnalysisRunDetailPage />);

    await waitFor(() => expect(screen.getByText(/scanner scope:/i)).toHaveTextContent("disabled"));
    expect(mockWorkbench).toHaveBeenCalledWith("run_canary_1");
    expect(screen.getByRole("heading", { name: "Canary run validation" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Canary utility invoice" })).toBeInTheDocument();
    expect(screen.getByText("run_canary_1")).toBeInTheDocument();
    expect(screen.getByText("Stadtwerke")).toBeInTheDocument();
    expect(screen.getByText("Utilities")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open in paperless/i })).toHaveAttribute(
      "href",
      "http://paperless.test/documents/73/details",
    );
    expect(screen.getByRole("link", { name: /open in paperless/i })).toHaveAttribute(
      "target",
      "_blank",
    );
  });

  it("offers an expected-state retry for a retryable provider failure", async () => {
    mockWorkbench.mockReturnValue({
      ...mockWorkbench(),
      run: {
        ...run,
        state: "failed",
        failure: {
          code: "PROVIDER_FAILURE",
          message: "Codex process exited unsuccessfully.",
          failedAt: "2026-07-24T09:02:00Z",
          retryable: true,
          provider: "document-analysis",
        },
      },
    });

    render(<AnalysisRunDetailPage />);
    fireEvent.click(screen.getByRole("button", { name: "Retry this run" }));

    await waitFor(() => expect(mockRetryRun).toHaveBeenCalledTimes(1));
    const [retryRunId, body] = mockRetryRun.mock.calls[0] ?? [];
    expect(retryRunId).toBe("run_canary_1");
    expect(body.expectedRunStateHash).toMatch(/^[a-f0-9]{64}$/);
    expect(body.idempotencyKey).toMatch(/^[a-f0-9-]{36}$/);
  });
});
