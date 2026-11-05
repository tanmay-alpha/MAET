import { test, expect } from "@playwright/test";

test.describe("MAET Phase 1 Terminal Workspace E2E Journeys", () => {
  test("JOURNEY 1: Screener to Terminal navigation preserves symbol context", async ({ page }) => {
    await page.goto("/screener");
    await expect(page.locator("h1")).toContainText("Stock Screener");

    // Search for RELIANCE
    const searchInput = page.locator("input[placeholder*='Search']");
    await searchInput.fill("RELIANCE");

    // Click "Terminal" button on RELIANCE row
    const terminalButton = page.locator("button:has-text('Terminal')").first();
    await terminalButton.click();

    // Verify terminal URL and context
    await expect(page).toHaveURL(/\/terminal/);
    await expect(page.locator("body")).toContainText("RELIANCE");
  });

  // Placing orders needs a signed-in Supabase session, which this suite does not set up;
  // it only checks that the ticket renders for the symbol in the URL.
  test("JOURNEY 2: Terminal opens the order ticket for the symbol in the URL", async ({ page }) => {
    await page.goto("/terminal?symbol=RELIANCE&exchange=NSE");
    await expect(page.locator("body")).toContainText("RELIANCE");

    const buyButton = page.locator("button:has-text('BUY')").first();
    await expect(buyButton).toBeVisible();
  });

  test("JOURNEY 5: Data quality badge displays honest label without false Live", async ({ page }) => {
    await page.goto("/terminal?symbol=INFY&exchange=NSE");
    await expect(page.locator("body")).not.toContainText("L2 Live");
    await expect(page.locator("body")).not.toContainText("Options Greeks (Live)");
  });
});
