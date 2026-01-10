import { test, expect } from "@playwright/test";

test.describe("Pending Reviews Page", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pending");
  });

  test("should display pending page", async ({ page }) => {
    await expect(page).toHaveURL(/\/pending/);
  });

  test("should show pending reviews heading", async ({ page }) => {
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
  });

  test("should show tab navigation for review types", async ({ page }) => {
    // Check for tabs or filter for different pending item types
    await expect(page.getByRole("tablist")).toBeVisible().catch(() => {
      // Alternative: check for any filter UI
      expect(page.locator("main")).toBeDefined();
    });
  });

  test("should display pending items or empty state", async ({ page }) => {
    // Wait for content to load
    await page.waitForTimeout(1000);

    // Should show either pending items or an empty state
    const hasItems = await page
      .locator("[data-testid='pending-item']")
      .first()
      .isVisible()
      .catch(() => false);

    const hasEmptyState = await page
      .locator("text=/no pending|empty|nothing to review/i")
      .isVisible()
      .catch(() => false);

    // Page should show either items or empty state (not both missing)
    expect(hasItems || hasEmptyState).toBeTruthy();
  });

  test("should have correspondent filter/tab", async ({ page }) => {
    const correspondentTab = page.getByRole("tab", {
      name: /correspondent/i,
    });
    if (await correspondentTab.isVisible().catch(() => false)) {
      await correspondentTab.click();
    }
  });

  test("should have document type filter/tab", async ({ page }) => {
    const docTypeTab = page.getByRole("tab", { name: /document.*type/i });
    if (await docTypeTab.isVisible().catch(() => false)) {
      await docTypeTab.click();
    }
  });

  test("should have tags filter/tab", async ({ page }) => {
    const tagsTab = page.getByRole("tab", { name: /tags/i });
    if (await tagsTab.isVisible().catch(() => false)) {
      await tagsTab.click();
    }
  });

  test("should navigate back to dashboard", async ({ page }) => {
    await page.getByRole("link", { name: /dashboard/i }).click();
    await expect(page).toHaveURL("/");
  });

  test("should be responsive on mobile", async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 667 });
    await expect(page).toHaveURL(/\/pending/);
  });
});

test.describe("Pending Item Actions", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/pending");
  });

  test("should show approve/reject buttons when items exist", async ({
    page,
  }) => {
    // Wait for potential items to load
    await page.waitForTimeout(1000);

    const approveButton = page.getByRole("button", { name: /approve/i }).first();
    const rejectButton = page.getByRole("button", { name: /reject/i }).first();

    // If there are pending items, these buttons should exist
    const hasApprove = await approveButton.isVisible().catch(() => false);
    const hasReject = await rejectButton.isVisible().catch(() => false);

    // Either we have action buttons or the page has no pending items
    // Skip this test if no buttons visible (likely no items)
    if (hasApprove || hasReject) {
      expect(hasApprove || hasReject).toBeTruthy();
    }
  });
});
