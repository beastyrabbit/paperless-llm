/**
 * Demo Video Recording Script
 *
 * Records a walkthrough video of the application for the README.
 * Uses Playwright's built-in video recording feature.
 *
 * Usage:
 *   1. Start the application: bun run dev
 *   2. Run this script: bun run demo:record
 *
 * Output: demo-videos/*.webm
 */

import { chromium } from "playwright";

async function recordDemo() {
  console.log("Starting demo recording...");

  const browser = await chromium.launch({
    headless: false, // Show browser window during recording
  });

  const context = await browser.newContext({
    viewport: { width: 1280, height: 720 },
    recordVideo: {
      dir: "./demo-videos/",
      size: { width: 1280, height: 720 },
    },
  });

  const page = await context.newPage();
  const BASE_URL = process.env.DEMO_URL || "http://localhost:3000";
  const PAUSE = 2500; // Time to view each page (ms)

  try {
    // 1. Dashboard
    console.log("Recording: Dashboard");
    await page.goto(BASE_URL, { timeout: 60000 });
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(PAUSE);

    // 2. Documents list
    console.log("Recording: Documents");
    await page.click('a[href="/documents"]');
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(PAUSE);

    // 3. Document detail (click first document if exists)
    const firstDoc = page.locator("table tbody tr").first();
    if (await firstDoc.isVisible({ timeout: 3000 }).catch(() => false)) {
      console.log("Recording: Document detail");
      await firstDoc.click();
      await page.waitForLoadState("domcontentloaded");
      await page.waitForTimeout(PAUSE);
      // Go back to documents list
      await page.goBack();
      await page.waitForLoadState("domcontentloaded");
    }

    // 4. Pending reviews
    console.log("Recording: Pending reviews");
    await page.click('a[href="/pending"]');
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(PAUSE);

    // 5. Settings
    console.log("Recording: Settings");
    await page.click('a[href="/settings"]');
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(PAUSE);

    // Scroll down to show more content
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(1500);
    await page.evaluate(() => window.scrollBy(0, 400));
    await page.waitForTimeout(1500);

    // 6. Prompts
    console.log("Recording: Prompts");
    await page.click('a[href="/prompts"]');
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(PAUSE);

    // 7. Back to Dashboard for a clean ending
    console.log("Recording: Return to Dashboard");
    await page.click('a[href="/"]');
    await page.waitForLoadState("domcontentloaded");
    await page.waitForTimeout(1500);

    console.log("Recording complete!");
  } catch (error) {
    console.error("Error during recording:", error);
  } finally {
    // Close context to save the video
    await context.close();
    await browser.close();
  }

  console.log("\nVideo saved to: ./demo-videos/");
  console.log("\nTo convert to MP4, run:");
  console.log(
    '  ffmpeg -i demo-videos/*.webm -c:v libx264 -crf 23 docs/images/demo.mp4'
  );
}

recordDemo().catch(console.error);
