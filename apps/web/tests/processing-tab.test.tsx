import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProcessingTab } from "../app/settings/components/ProcessingTab";
import { processingApi } from "@/lib/api";

const mocks = vi.hoisted(() => ({
  refreshGlobalStatus: vi.fn(),
  releaseLock: vi.fn(),
  triggerAuto: vi.fn(),
  updateSetting: vi.fn(),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    () =>
    (key: string, values?: Record<string, unknown>): string => {
      const messages: Record<string, string> = {
        "autoProcessing.title": "Auto-Processing",
        "autoProcessing.description": "Automatically process documents",
        "autoProcessing.enable": "Enable Auto-Processing",
        "autoProcessing.enableDesc": "Process tagged documents",
        "lockRecovery.title": "Admin lock recovery",
        "lockRecovery.description": "Release a stuck lock",
        "lockRecovery.warning": "Only use this when processing is stuck.",
        "lockRecovery.useCurrent": `Use current document #${values?.docId ?? ""}`,
        "lockRecovery.docIdLabel": "Document ID",
        "lockRecovery.docIdPlaceholder": "e.g. 123",
        "lockRecovery.runIdLabel": "Run ID (optional)",
        "lockRecovery.runIdPlaceholder": "Leave empty to force release",
        "lockRecovery.runIdHelp": "Provide a run ID to guard release.",
        "lockRecovery.release": "Release lock",
        "lockRecovery.confirm": "Release this processing lock?",
        "lockRecovery.releaseFailed": "Failed to release lock",
      };
      return messages[key] ?? key;
    },
}));

vi.mock("@/lib/api", () => ({
  processingApi: {
    releaseLock: mocks.releaseLock,
    triggerAuto: mocks.triggerAuto,
  },
}));

vi.mock("@/lib/global-status", () => ({
  useGlobalStatus: () => ({
    autoStatus: {
      running: true,
      enabled: true,
      interval_minutes: 5,
      include_untagged: false,
      queue_length: 0,
      last_check_at: null,
      currently_processing_doc_id: 77,
      currently_processing_doc_title: "Document 77",
      current_step: null,
      processed_since_start: 0,
      errors_since_start: 0,
    },
    refresh: mocks.refreshGlobalStatus,
  }),
}));

vi.mock("@/lib/tinybase", () => ({
  useBooleanSetting: () => false,
  useNumberSetting: () => 5,
  useTinyBase: () => ({ updateSetting: mocks.updateSetting }),
}));

describe("ProcessingTab", () => {
  beforeEach(() => {
    mocks.refreshGlobalStatus.mockReset();
    mocks.releaseLock.mockReset();
    mocks.triggerAuto.mockReset();
    mocks.updateSetting.mockReset();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  it("releases a document lock from the admin recovery card", async () => {
    mocks.releaseLock.mockResolvedValue({
      ok: true,
      status: 200,
      data: {
        success: true,
        doc_id: 123,
        released: true,
        previous_lock: null,
        message: "Released document lock for document 123",
      },
    });

    render(<ProcessingTab />);

    expect(screen.getByText("Admin lock recovery")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Document ID"), { target: { value: "123" } });
    fireEvent.click(screen.getByRole("button", { name: /release lock/i }));

    await waitFor(() =>
      expect(processingApi.releaseLock).toHaveBeenCalledWith(123, { force: true }),
    );
    expect(await screen.findByText("Released document lock for document 123")).toBeInTheDocument();
    expect(mocks.refreshGlobalStatus).toHaveBeenCalled();
  });

  it("can prefill the current processing document id", () => {
    render(<ProcessingTab />);

    fireEvent.click(screen.getByRole("button", { name: /use current document #77/i }));

    expect(screen.getByLabelText("Document ID")).toHaveValue(77);
  });
});
