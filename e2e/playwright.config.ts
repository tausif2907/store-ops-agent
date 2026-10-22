import { defineConfig } from "@playwright/test";
import { E2E_ENV, WEB_URL } from "./env";

/**
 * The dashboard in a real browser, against the real agent API, MCP server,
 * job worker, databases and Redis. Only the model is scripted, so it runs in
 * CI without a Claude key.
 *
 *   pnpm test:e2e
 */
export default defineConfig({
  testDir: "./tests",
  globalSetup: "./global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  timeout: 180_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL: WEB_URL,
    // Locally, the installed Chrome; CI installs Playwright's Chromium.
    channel: process.env.CI ? undefined : (process.env.E2E_BROWSER_CHANNEL ?? "chrome"),
    trace: "retain-on-failure",
  },
  webServer: [
    {
      command: "pnpm exec tsx stack.ts",
      url: `${E2E_ENV.AGENT_URL}/health`,
      env: E2E_ENV,
      reuseExistingServer: false,
      stdout: "pipe",
    },
    {
      command: "pnpm --dir ../apps/web exec next dev --port 3110",
      url: `${WEB_URL}/api/health`,
      env: E2E_ENV,
      reuseExistingServer: false,
      timeout: 240_000,
    },
  ],
});
