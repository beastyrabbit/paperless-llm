import { act, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GlobalStatusProvider, useGlobalStatus } from "../lib/global-status";

const jsonResponse = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });

const queuePayload = {
  pending: 2,
  ocr_done: 1,
  title_done: 0,
  correspondent_done: 0,
  document_type_done: 0,
  tags_done: 0,
  processed: 8,
  total_in_pipeline: 7,
  total_documents: 42,
};

const autoPayload = {
  running: true,
  enabled: true,
  interval_minutes: 5,
  include_untagged: false,
  queue_length: 7,
  last_check_at: "2026-05-15T10:00:00.000Z",
  currently_processing_doc_id: null,
  currently_processing_doc_title: null,
  current_step: null,
  processed_since_start: 4,
  errors_since_start: 0,
};

const ollamaPayload = {
  running: true,
  models: [],
};

function StatusConsumer({ label }: { label: string }) {
  const { queueStats, autoStatus } = useGlobalStatus();
  return (
    <div>
      {label}:{queueStats?.total_in_pipeline ?? "loading"}:{autoStatus?.enabled ? "on" : "off"}
    </div>
  );
}

describe("GlobalStatusProvider", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("uses one polling interval and one endpoint request per tick for multiple consumers", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/documents/queue") return jsonResponse(queuePayload);
      if (url === "/api/processing/auto/status") return jsonResponse(autoPayload);
      if (url === "/api/settings/ollama/status") return jsonResponse(ollamaPayload);
      return jsonResponse({ error: `Unhandled ${url}` }, 404);
    });
    vi.stubGlobal("fetch", fetchMock);
    const setIntervalSpy = vi.spyOn(window, "setInterval");

    render(
      <GlobalStatusProvider>
        <StatusConsumer label="sidebar" />
        <StatusConsumer label="dashboard" />
      </GlobalStatusProvider>,
    );

    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.getByText("sidebar:7:on")).toBeInTheDocument();
    expect(screen.getByText("dashboard:7:on")).toBeInTheDocument();
    expect(setIntervalSpy).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });

    expect(fetchMock).toHaveBeenCalledTimes(6);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/documents/queue")).toHaveLength(2);
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/processing/auto/status")).toHaveLength(
      2,
    );
    expect(fetchMock.mock.calls.filter(([url]) => url === "/api/settings/ollama/status")).toHaveLength(
      2,
    );
  });
});
