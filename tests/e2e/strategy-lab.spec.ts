/**
 * Strategy Lab E2E — Playwright test suite.
 * Tests user-facing journeys for Phase 3.
 *
 * Prerequisites:
 * - App running on TEST_BASE_URL (default: http://localhost:5173)
 * - Authenticated session available
 */

import { test, expect, type Page } from "@playwright/test";

const BASE = process.env.TEST_BASE_URL ?? "http://localhost:5173";

// ============================================================
// Helpers
// ============================================================

async function goTo(page: Page, path: string) {
  await page.goto(`${BASE}${path}`, { waitUntil: "domcontentloaded" });
}

async function waitForHeading(page: Page, text: string) {
  await expect(page.getByRole("heading", { name: text, exact: false }).first()).toBeVisible({ timeout: 10000 });
}

async function waitForText(page: Page, text: string) {
  await expect(page.getByText(text, { exact: false }).first()).toBeVisible({ timeout: 10000 });
}

// ============================================================
// Journey 1: Strategy Lab navigation
// ============================================================

test.describe("Journey 1: Strategy Lab page loads", () => {
  test("1.1 /strategies renders Strategy Lab heading", async ({ page }) => {
    await goTo(page, "/strategies");
    await waitForText(page, "Strategy Lab");
  });

  test("1.2 Strategy Lab has Library tab", async ({ page }) => {
    await goTo(page, "/strategies");
    await waitForText(page, "Strategy Library");
  });

  test("1.3 Strategy Library shows educational templates", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("Strategy Library").first().click();
    await waitForText(page, "SMA Crossover");
  });

  test("1.4 Strategy Library shows disclaimer", async ({ page }) => {
    await goTo(page, "/strategies");
    await waitForText(page, "Paper Only");
  });

  test("1.5 My Strategies tab is present", async ({ page }) => {
    await goTo(page, "/strategies");
    await waitForText(page, "My Strategies");
  });
});

// ============================================================
// Journey 2: Template detail
// ============================================================

test.describe("Journey 2: Template detail panel", () => {
  test("2.1 Clicking SMA Crossover shows hypothesis", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("SMA Crossover").first().click();
    await waitForText(page, "Hypothesis");
  });

  test("2.2 Template detail shows Known Limitations", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("SMA Crossover").first().click();
    await waitForText(page, "Known Limitations");
  });

  test("2.3 Template detail shows Educational Disclaimer", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("SMA Crossover").first().click();
    await waitForText(page, "Educational Disclaimer");
  });

  test("2.4 Template detail shows typical timeframes", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("SMA Crossover").first().click();
    await waitForText(page, "Typical Timeframes");
  });
});

// ============================================================
// Journey 3: New Strategy tab
// ============================================================

test.describe("Journey 3: New Strategy creation", () => {
  test("3.1 New Strategy tab shows starting options", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("New Strategy").last().click();
    await waitForText(page, "Create New Strategy");
  });

  test("3.2 New Strategy tab shows Blank Strategy option", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("New Strategy").last().click();
    await waitForText(page, "Blank Strategy");
  });

  test("3.3 New Strategy tab lists Phase 3 capabilities", async ({ page }) => {
    await goTo(page, "/strategies");
    await page.getByText("New Strategy").last().click();
    await waitForText(page, "Walk-forward validation");
  });
});

// ============================================================
// Journey 4: Sidebar navigation
// ============================================================

test.describe("Journey 4: Sidebar Strategy Lab group", () => {
  test("4.1 Sidebar shows Strategy Lab group", async ({ page }) => {
    await goTo(page, "/");
    await waitForText(page, "Strategy Lab");
  });

  test("4.2 Sidebar has Performance link", async ({ page }) => {
    await goTo(page, "/");
    await waitForText(page, "Performance");
  });

  test("4.3 Sidebar has Bar Replay link", async ({ page }) => {
    await goTo(page, "/");
    await waitForText(page, "Bar Replay");
  });
});

// ============================================================
// Journey 5: Bar Replay page
// ============================================================

test.describe("Journey 5: Bar Replay page", () => {
  test("5.1 /replay renders Bar Replay heading", async ({ page }) => {
    await goTo(page, "/replay");
    await waitForText(page, "Bar Replay");
  });

  test("5.2 Replay page shows Isolated Account badge", async ({ page }) => {
    await goTo(page, "/replay");
    await waitForText(page, "Isolated Account");
  });

  test("5.3 Replay page has symbol input", async ({ page }) => {
    await goTo(page, "/replay");
    await expect(page.locator("input").first()).toBeVisible({ timeout: 5000 });
  });
});

// ============================================================
// Journey 6: Performance page
// ============================================================

test.describe("Journey 6: Performance page", () => {
  test("6.1 /performance renders Performance Overview heading", async ({ page }) => {
    await goTo(page, "/performance");
    await waitForText(page, "Performance Overview");
  });
});

// ============================================================
// Journey 7: Strategy Lab paper-only disclaimer
// ============================================================

test.describe("Journey 7: Paper-only guarantees", () => {
  test("7.1 /strategies has Paper Only label", async ({ page }) => {
    await goTo(page, "/strategies");
    await waitForText(page, "Paper Only");
  });

  test("7.2 /replay has Isolated Account badge", async ({ page }) => {
    await goTo(page, "/replay");
    await waitForText(page, "Isolated Account");
  });
});
