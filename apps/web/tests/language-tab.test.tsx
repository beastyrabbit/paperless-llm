import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { LanguageTab } from "../app/settings/components/LanguageTab";

const mocks = vi.hoisted(() => ({
  updateSetting: vi.fn(),
  settings: new Map<string, string>(),
}));

vi.mock("next-intl", () => ({
  useLocale: () => "en",
  useTranslations: () => (key: string) => {
    const messages: Record<string, string> = {
      "language.uiLanguage": "UI Language",
      "language.uiLanguageDesc": "UI language description",
      "language.title": "Language",
      "language.controlsUiLanguage": "Controls UI language",
      "language.promptLanguage": "Prompt Language",
      "language.promptLanguageDesc": "Prompt language description",
      "language.selectLanguage": "Select language",
      "language.controlsPromptLanguage": "Controls prompt language",
      "language.tagAliases": "German Tag Aliases",
      "language.tagAliasesDesc": "Alias description",
      "language.aliasSource": "Source alias",
      "language.aliasTarget": "German tag",
      "language.removeAlias": "Remove alias",
      "language.addAlias": "Add alias",
      "language.saveAliases": "Save aliases",
      "language.resetAliases": "Reset to defaults",
      "language.tagAliasesNote": "Alias note",
      "language.duplicateAliasWarning": "Duplicate warning",
    };
    return messages[key] ?? key;
  },
}));

vi.mock("@/lib/locale", () => ({ setLocale: vi.fn() }));

vi.mock("@/lib/tinybase", () => ({
  useStringSetting: (key: string) => mocks.settings.get(key) ?? "",
  useTinyBase: () => ({ updateSetting: mocks.updateSetting }),
}));

describe("LanguageTab", () => {
  beforeEach(() => {
    mocks.updateSetting.mockReset();
    mocks.updateSetting.mockResolvedValue(true);
    mocks.settings.clear();
    mocks.settings.set("language", "en");
  });

  it("shows default aliases and saves edits", async () => {
    render(<LanguageTab />);

    expect(screen.getByDisplayValue("invoice")).toBeInTheDocument();
    fireEvent.change(screen.getByDisplayValue("Rechnung"), { target: { value: "Faktura" } });
    fireEvent.click(screen.getByRole("button", { name: /save aliases/i }));

    await waitFor(() =>
      expect(mocks.updateSetting).toHaveBeenCalledWith(
        "tag_language.aliases.de",
        expect.stringContaining("Faktura"),
      ),
    );
  });

  it("adds, removes, and resets aliases", async () => {
    render(<LanguageTab />);

    fireEvent.click(screen.getByRole("button", { name: /add alias/i }));
    expect(screen.getAllByLabelText("Source alias").at(-1)).toHaveValue("");

    fireEvent.click(screen.getAllByRole("button", { name: /remove alias/i })[0]);
    expect(screen.queryByDisplayValue("agriculture")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /reset to defaults/i }));
    await waitFor(() => expect(mocks.updateSetting).toHaveBeenCalledWith("tag_language.aliases.de", expect.stringContaining("Landwirtschaft")));
  });
});
