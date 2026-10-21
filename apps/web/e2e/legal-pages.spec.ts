import { expect, type Page, test } from "@playwright/test";

// Run with PLAYWRIGHT_PRODUCTION=1, or PLAYWRIGHT_BASE_URL pointing at next start.
// API responses are intercepted in the browser; no backend or AI provider is used.
async function mockUnavailableBackend(page: Page) {
  await page.route("**/api/**", (route) =>
    route.fulfill({
      status: 503,
      contentType: "application/json",
      body: JSON.stringify({ error: "Backend intentionally unavailable in legal-page tests" }),
    }),
  );
}

const locales = [
  {
    locale: "en",
    notice: "Legal notice",
    privacy: "Privacy",
    noticePath: "/legal-notice",
    privacyPath: "/privacy",
    noticeHeading: "Legal Notice (Impressum)",
    privacyHeading: "Privacy Policy",
  },
  {
    locale: "de",
    notice: "Impressum",
    privacy: "Datenschutz",
    noticePath: "/impressum",
    privacyPath: "/datenschutz",
    noticeHeading: "Impressum",
    privacyHeading: "Datenschutzerklärung",
  },
] as const;

for (const viewport of [
  { width: 1280, height: 800 },
  { width: 375, height: 812 },
]) {
  test.describe(`${viewport.width}px`, () => {
    test.use({ viewport });

    for (const locale of locales) {
      test(`${locale.locale} app links open standalone legal documents`, async ({
        page,
        context,
        baseURL,
      }) => {
        if (locale.locale === "de") {
          await context.addCookies([
            { name: "NEXT_LOCALE", value: "de", url: baseURL ?? "http://127.0.0.1:3765" },
          ]);
        }
        await mockUnavailableBackend(page);

        for (const target of [
          { label: locale.notice, path: locale.noticePath, heading: locale.noticeHeading },
          { label: locale.privacy, path: locale.privacyPath, heading: locale.privacyHeading },
        ]) {
          await page.goto("/");
          const link = page.getByRole("link", { name: target.label, exact: true });
          await expect(link).toBeVisible();
          await expect(link).toHaveAttribute("href", target.path);
          const bounds = await link.boundingBox();
          expect(bounds).not.toBeNull();
          if (bounds) {
            expect(bounds.x).toBeGreaterThanOrEqual(0);
            expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
            expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
          }

          const navigation = page.waitForResponse(
            (response) => new URL(response.url()).pathname === target.path,
          );
          await link.click();
          const response = await navigation;
          await page.waitForLoadState("networkidle");

          expect(response.status()).toBe(200);
          expect(response.headers()["content-type"]).toContain("text/html");
          expect(response.headers()["x-robots-tag"]).toBe("noindex");
          await expect(page).toHaveURL(new RegExp(`${target.path}$`));
          await expect(
            page.getByRole("heading", { level: 1, name: target.heading, exact: true }),
          ).toBeVisible();
          await expect(page.locator('meta[name="robots"]')).toHaveAttribute("content", "noindex");
          await expect(page.locator("html")).toHaveAttribute("lang", locale.locale);
          await expect(page.locator("address")).toContainText("Tobias Heer");
          await expect(page.locator("address")).toContainText(
            "c/o Impressumservice Dein-Impressum",
          );
          await expect(page.locator("address")).toContainText("Stettiner Str. 41");
          await expect(page.locator("footer")).toContainText("impressum-paperless-llm@heerlab.com");
          await expect(page.locator("footer")).toContainText(
            "datenschutz-paperless-llm@heerlab.com",
          );
          await expect(
            page.locator('footer a[href="https://beastyrabbit.com/kontakt?from=paperless-llm"]'),
          ).toBeVisible();
          expect(await page.locator("script").count()).toBe(0);
          expect(
            await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          ).toBe(true);
          // Capture a fresh load of the legal document, after the app has unloaded.
          // Its sidebar may still prefetch app routes while the link is being clicked.
          const requests: string[] = [];
          const onRequest = (request: { url(): string }) => requests.push(request.url());
          page.on("request", onRequest);
          await page.reload();
          await page.waitForLoadState("networkidle");
          page.off("request", onRequest);
          expect(requests.map((url) => new URL(url).pathname)).toEqual([target.path]);
          console.log(
            `${viewport.width}px ${target.path} network requests: ${JSON.stringify(requests)}`,
          );
        }
      });
    }

    test("not-found page retains the legal footer", async ({ page }) => {
      await mockUnavailableBackend(page);
      await page.goto("/missing-legal-page-test");
      await expect(page.getByRole("heading", { name: "404" })).toBeVisible();
      await expect(page.getByRole("link", { name: "Legal notice", exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "Privacy", exact: true })).toBeVisible();
    });
  });
}

test("trailing slashes redirect to the exact public paths", async ({ request }) => {
  for (const path of ["/impressum", "/datenschutz", "/legal-notice", "/privacy"]) {
    const response = await request.get(`${path}/`, { maxRedirects: 0 });
    expect(response.status()).toBe(308);
    expect(response.headers()["location"]).toBe(path);
  }
});
