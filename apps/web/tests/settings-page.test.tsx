import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import SettingsPage from "../app/settings/page";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams(""),
}));

vi.mock("../app/settings/components", () => ({
  ConnectionsTab: () => <div>Connections content</div>,
  RuntimeTab: () => <div>Runtime content</div>,
}));

describe("SettingsPage", () => {
  it("shows only deployment-owned connections and Paperless-first runtime", () => {
    render(<SettingsPage />);

    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Connections" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Paperless-first runtime" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /open system test/i })).toHaveAttribute(
      "href",
      "/system-test",
    );
    expect(screen.queryByRole("button", { name: /save settings/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/workflow tags/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/pipeline/i)).not.toBeInTheDocument();
  });
});
