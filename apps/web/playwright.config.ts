import { defineConfig, devices } from "@playwright/test";

const baseURL = process.env["PLAYWRIGHT_BASE_URL"] ?? "http://127.0.0.1:3765";
const production = process.env["PLAYWRIGHT_PRODUCTION"] === "1";

export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: {
    timeout: 10_000,
  },
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  webServer: process.env["PLAYWRIGHT_BASE_URL"]
    ? undefined
    : {
        command: production
          ? "pnpm build && pnpm start --hostname 127.0.0.1 --port 3765"
          : "pnpm dev --hostname 127.0.0.1 --port 3765",
        url: baseURL,
        reuseExistingServer: !production && !process.env["CI"],
        timeout: 120_000,
      },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"] },
    },
  ],
});
