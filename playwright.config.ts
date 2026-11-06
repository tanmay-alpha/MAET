import { defineConfig, devices } from "@playwright/test";

// The suite runs against a production build (src/scripts/preview.ts: `vite build` with the
// node-server preset, then `node .output/server/index.mjs`). VITE_API_URL points the
// bundle at a fake origin that tests/e2e/support/mock-api.ts answers via page.route, so
// no request reaches a real backend. https keeps the app's CSP (connect-src 'self' https:)
// in force.
const PORT = Number(process.env.E2E_PORT ?? 4310);
const BASE_URL = `http://127.0.0.1:${PORT}`;

export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: "./test-results/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI
    ? [["list"], ["html", { outputFolder: "test-results/playwright-report", open: "never" }]]
    : "list",
  use: {
    baseURL: BASE_URL,
    locale: "en-IN",
    timezoneId: "Asia/Kolkata",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1440, height: 900 } },
    },
    { name: "mobile", use: { ...devices["Pixel 7"] } },
  ],
  webServer: {
    command: `bun run --cwd src preview --port ${PORT}`,
    url: BASE_URL,
    // Never reuse a server: one built without the fake API origin would hit real backends.
    reuseExistingServer: false,
    timeout: 240_000,
    env: {
      VITE_API_URL: "https://api.test",
      VITE_SUPABASE_URL: "https://supabase.test",
      VITE_SUPABASE_ANON_KEY: "e2e-anon-key",
    },
  },
});
