import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import DashboardError from "../app/error";
import RootLayout from "../app/layout";
import { LegalLinks } from "../components/legal-links";
import de from "../messages/de.json";
import en from "../messages/en.json";

vi.mock("next-intl/server", () => ({ getLocale: async () => "en", getMessages: async () => en }));
vi.mock("@/components/sidebar", () => ({ Sidebar: () => <aside>Sidebar</aside> }));
vi.mock("@/lib/global-status", () => ({
  GlobalStatusProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@/lib/tinybase", () => ({
  AppTinyBaseProvider: ({ children }: { children: ReactNode }) => children,
}));

describe("legal links in the shared layout", () => {
  it.each([
    {
      locale: "de",
      messages: de,
      notice: "Impressum",
      privacy: "Datenschutz",
      noticePath: "/impressum",
      privacyPath: "/datenschutz",
    },
    {
      locale: "en",
      messages: en,
      notice: "Legal notice",
      privacy: "Privacy",
      noticePath: "/legal-notice",
      privacyPath: "/privacy",
    },
  ])("renders plain anchors in $locale", ({
    locale,
    messages,
    notice,
    privacy,
    noticePath,
    privacyPath,
  }) => {
    render(
      <NextIntlClientProvider locale={locale} messages={messages}>
        <LegalLinks />
      </NextIntlClientProvider>,
    );
    expect(screen.getByRole("link", { name: notice })).toHaveAttribute("href", noticePath);
    expect(screen.getByRole("link", { name: privacy })).toHaveAttribute("href", privacyPath);
    expect(screen.getAllByRole("link")).toHaveLength(2);
  });

  it("keeps the footer outside the route error boundary", async () => {
    const html = renderToStaticMarkup(
      await RootLayout({
        children: <DashboardError error={new Error("Unavailable")} reset={() => {}} />,
      }),
    );
    const document = new DOMParser().parseFromString(html, "text/html");
    expect(document.querySelector("main")?.textContent).toContain("Dashboard could not be loaded");
    expect(document.querySelector('footer a[href="/legal-notice"]')?.textContent).toBe(
      "Legal notice",
    );
    expect(document.querySelector('footer a[href="/privacy"]')?.textContent).toBe("Privacy");
    expect(document.querySelector("main footer")).toBeNull();
  });
});
