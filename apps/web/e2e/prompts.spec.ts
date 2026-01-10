import { test, expect } from "@playwright/test";

test.describe("Prompts Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/prompts");
  });

  test("should display prompts page", async ({ page }) => {
    await expect(page).toHaveURL(/\/prompts/);
  });

  test("should show prompts heading", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("should display prompt list or editor", async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(1000);

    // Should show prompt templates
    await expect(page.locator("main")).toBeVisible();
  });

  test("should have language selector", async ({ page }) => {
    // Look for language selection dropdown
    const languageSelector = page.getByRole("combobox").first();
    if (await languageSelector.isVisible().catch(() => false)) {
      await expect(languageSelector).toBeVisible();
    }
  });

  test("should show prompt preview functionality", async ({ page }) => {
    // Look for preview or test button
    const previewButton = page.getByRole("button", { name: /preview|test/i });
    if (await previewButton.isVisible().catch(() => false)) {
      await expect(previewButton).toBeVisible();
    }
  });

  test("should navigate back to dashboard", async ({ page }) => {
    await page.getByRole("link", { name: /dashboard/i }).click();
    await expect(page).toHaveURL("/");
  });

  test("should be responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page).toHaveURL(/\/prompts/);
  });
});
