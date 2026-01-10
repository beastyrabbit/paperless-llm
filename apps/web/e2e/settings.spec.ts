import { test, expect } from "@playwright/test";

test.describe("Settings Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/settings");
  });

  test("should display settings page with tabs", async ({ page }) => {
    await expect(page.getByRole("heading", { name: /settings/i })).toBeVisible();
    // Check for tab navigation
    await expect(page.getByRole("tablist")).toBeVisible();
  });

  test("should show connections tab by default", async ({ page }) => {
    await expect(page.getByRole("tab", { name: /connections/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("should switch to processing tab", async ({ page }) => {
    await page.getByRole("tab", { name: /processing/i }).click();
    await expect(page.getByRole("tab", { name: /processing/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("should switch to pipeline tab", async ({ page }) => {
    await page.getByRole("tab", { name: /pipeline/i }).click();
    await expect(page.getByRole("tab", { name: /pipeline/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("should switch to language tab", async ({ page }) => {
    await page.getByRole("tab", { name: /language/i }).click();
    await expect(page.getByRole("tab", { name: /language/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("should switch to maintenance tab", async ({ page }) => {
    await page.getByRole("tab", { name: /maintenance/i }).click();
    await expect(page.getByRole("tab", { name: /maintenance/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("should show save button", async ({ page }) => {
    await expect(page.getByRole("button", { name: /save/i })).toBeVisible();
  });

  test("should have paperless connection fields in connections tab", async ({
    page,
  }) => {
    // Check for Paperless URL input
    await expect(page.getByLabel(/server.*url/i).first()).toBeVisible();
    // Check for API token input
    await expect(page.getByLabel(/token/i).first()).toBeVisible();
  });

  test("should have Ollama fields in connections tab", async ({ page }) => {
    // Look for Ollama section
    await expect(page.locator("text=Ollama")).toBeVisible();
  });

  test("should persist tab selection in URL", async ({ page }) => {
    await page.getByRole("tab", { name: /processing/i }).click();
    await expect(page).toHaveURL(/tab=processing/);

    await page.getByRole("tab", { name: /maintenance/i }).click();
    await expect(page).toHaveURL(/tab=maintenance/);
  });

  test("should restore tab from URL parameter", async ({ page }) => {
    await page.goto("/settings?tab=processing");
    await expect(page.getByRole("tab", { name: /processing/i })).toHaveAttribute(
      "data-state",
      "active"
    );
  });

  test("should have test connection buttons", async ({ page }) => {
    // There should be test connection buttons for services
    const testButtons = page.getByRole("button").filter({ hasText: /test/i });
    await expect(testButtons.first()).toBeVisible();
  });
});
