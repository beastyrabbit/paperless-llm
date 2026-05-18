import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AppTinyBaseProvider, useStringSetting, useTinyBase } from "../lib/tinybase";

function SettingsProbe() {
  const paperlessUrl = useStringSetting("paperless.url");
  const aliases = useStringSetting("tag_language.aliases.de");
  const { lastSyncError, updateSetting } = useTinyBase();

  return (
    <div>
      <div data-testid="paperless-url">{paperlessUrl}</div>
      <div data-testid="aliases">{aliases}</div>
      <div data-testid="sync-error">{lastSyncError ?? ""}</div>
      <button type="button" onClick={() => void updateSetting("paperless.url", "http://changed")}>
        Change URL
      </button>
      <button
        type="button"
        onClick={() =>
          void updateSetting("tag_language.aliases.de", JSON.stringify([{ source: "invoice", target: "Faktura" }]))
        }
      >
        Change aliases
      </button>
    </div>
  );
}

describe("AppTinyBaseProvider", () => {
  it("rolls back optimistic setting updates and exposes an error when PATCH fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") {
        return new Response("save failed", { status: 500, statusText: "Server Error" });
      }

      return Response.json({
        paperless_url: "http://original",
        tag_language_aliases_de: JSON.stringify([{ source: "invoice", target: "Rechnung" }]),
        tags: {
          todo: "todo-custom",
          summary_done: "summary-custom",
          manual_review: "review-custom",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppTinyBaseProvider>
        <SettingsProbe />
      </AppTinyBaseProvider>,
    );

    await screen.findByText("http://original");
    expect(screen.getByTestId("aliases")).toHaveTextContent("Rechnung");

    fireEvent.click(screen.getByRole("button", { name: /change url/i }));

    await waitFor(() => expect(screen.getByTestId("paperless-url")).toHaveTextContent("http://original"));
    expect(screen.getByTestId("sync-error")).toHaveTextContent("HTTP 500");
  });

  it("maps editable tag aliases to the settings API", async () => {
    const fetchMock = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method === "PATCH") return Response.json({});
      return Response.json({ tag_language_aliases_de: "" });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(
      <AppTinyBaseProvider>
        <SettingsProbe />
      </AppTinyBaseProvider>,
    );

    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    fireEvent.click(screen.getByRole("button", { name: /change aliases/i }));

    await waitFor(() =>
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining("/api/settings"),
        expect.objectContaining({
          method: "PATCH",
          body: JSON.stringify({
            tag_language_aliases_de: JSON.stringify([{ source: "invoice", target: "Faktura" }]),
          }),
        }),
      ),
    );
  });
});
