import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import SettingsPage from "../app/settings/page";

const mocks = vi.hoisted(() => ({
  replace: vi.fn(),
  saveSettings: vi.fn(),
  updateSetting: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace }),
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("next-intl", () => ({
  useTranslations:
    (namespace: string) =>
    (key: string): string => {
      const messages: Record<string, string> = {
        "common.saved": "Saved",
        "settings.saveSettings": "Save settings",
        "settings.subtitle": "Configure document processing",
        "settings.tabs.advanced": "Advanced",
        "settings.tabs.aiDocumentTypes": "AI document types",
        "settings.tabs.aiTags": "AI tags",
        "settings.tabs.connections": "Connections",
        "settings.tabs.customFields": "Custom fields",
        "settings.tabs.language": "Language",
        "settings.tabs.maintenance": "Maintenance",
        "settings.tabs.pipeline": "Pipeline",
        "settings.tabs.processing": "Processing",
        "settings.tabs.workflowTags": "Workflow tags",
        "settings.title": "Settings",
      };
      return messages[`${namespace}.${key}`] ?? key;
    },
}));

vi.mock("@/lib/tinybase", () => ({
  useBooleanSetting: () => false,
  useNumberSetting: () => 5,
  useStringSetting: () => "",
  useTinyBase: () => ({
    isSyncing: false,
    saveSettings: mocks.saveSettings,
    updateSetting: mocks.updateSetting,
  }),
}));

vi.mock("../app/settings/components", () => ({
  AdvancedTab: () => <div>Advanced tab</div>,
  AiDocumentTypesTab: () => <div>AI document types tab</div>,
  AiTagsTab: () => <div>AI tags tab</div>,
  ConnectionsTab: () => <div>Connections tab</div>,
  CustomFieldsTab: () => <div>Custom fields tab</div>,
  LanguageTab: () => <div>Language tab</div>,
  MaintenanceTab: () => <div>Maintenance tab</div>,
  PipelineTab: () => <div>Pipeline tab</div>,
  ProcessingTab: () => <div>Processing tab</div>,
  WorkflowTagsTab: () => <div>Workflow tags tab</div>,
}));

describe("SettingsPage", () => {
  beforeEach(() => {
    mocks.replace.mockReset();
    mocks.saveSettings.mockReset();
    mocks.updateSetting.mockReset();
  });

  it("saves TinyBase settings and shows success state", async () => {
    mocks.saveSettings.mockResolvedValue(undefined);

    render(<SettingsPage />);

    fireEvent.click(await screen.findByRole("button", { name: /save settings/i }));

    await waitFor(() => expect(mocks.saveSettings).toHaveBeenCalledTimes(1));
    expect(await screen.findByRole("button", { name: /saved/i })).toBeInTheDocument();
  });
});
