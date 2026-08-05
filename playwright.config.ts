import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: "list",
  use: {
    baseURL: process.env.PLAYWRIGHT_TEST_BASE_URL || "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "on",
    video: "retain-on-failure",
  },
  projects: [
    {
      name: "chrome-desktop",
      use: {
        channel: "chrome",
        viewport: { width: 1440, height: 900 },
      },
    },
    {
      name: "chrome-1366",
      use: {
        channel: "chrome",
        viewport: { width: 1366, height: 768 },
      },
    },
    {
      name: "chrome-1920",
      use: {
        channel: "chrome",
        viewport: { width: 1920, height: 1080 },
      },
    },
    {
      name: "chrome-mobile",
      use: {
        channel: "chrome",
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
  ],
  webServer: process.env.PLAYWRIGHT_TEST_BASE_URL ? undefined : {
    command: "bun run --cwd src dev --port 3000",
    url: "http://localhost:3000",
    reuseExistingServer: true,
    timeout: 120 * 1000,
  },
});
