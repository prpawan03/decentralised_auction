import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end config.
 *
 * NOTE: browsers are deliberately NOT downloaded as part of this package's
 * install. Run `npx playwright install chromium` once before `npm run e2e`.
 *
 * The specs assume a chain node and a dev server; the webServer block below
 * starts the app, and the specs skip themselves cleanly when no node is
 * reachable, so a developer without a running chain gets a skip rather than a
 * wall of red.
 */
export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  forbidOnly: Boolean(process.env["CI"]),
  retries: process.env["CI"] ? 2 : 0,
  /* Serial in CI for stable traces; Playwright picks a sane default locally. */
  ...(process.env["CI"] ? { workers: 1 } : {}),
  reporter: process.env["CI"] ? [["github"], ["html", { open: "never" }]] : [["list"]],

  timeout: 30_000,
  expect: { timeout: 7_000 },

  use: {
    baseURL: process.env["E2E_BASE_URL"] ?? "http://127.0.0.1:5173",
    trace: "on-first-retry",
    screenshot: "only-on-failure",
    video: "off",
  },

  projects: [
    {
      /**
       * The most important project in this file.
       *
       * A brand-new Chromium context has NO wallet extension and NO
       * window.ethereum. If the app only works with MetaMask installed, every
       * test in read-only.spec.ts fails here — which is exactly the regression
       * that made the previous app invisible without a wallet.
       */
      name: "no-wallet-chromium",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile-no-wallet",
      use: { ...devices["Pixel 7"] },
    },
  ],

  webServer: {
    command: "npm run dev -- --port 5173 --strictPort",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: !process.env["CI"],
    timeout: 120_000,
    stdout: "ignore",
    stderr: "pipe",
  },
});
