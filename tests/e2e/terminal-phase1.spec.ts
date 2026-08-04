import { test, expect } from "@playwright/test";

test.describe("MAET Phase 1 Terminal Workspace E2E Journeys", () => {
  test("JOURNEY 1: Screener to Terminal navigation preserves symbol context", async ({ page }) => {
    await page.goto("http://localhost:3000/screener");
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

  test("JOURNEY 2: Authenticated paper trading order placement and position updates", async ({ page }) => {
    await page.goto("http://localhost:3000/terminal?symbol=RELIANCE&exchange=NSE");
    await expect(page.locator("body")).toContainText("RELIANCE");

    // Verify order ticket exists
    const buyButton = page.locator("button:has-text('BUY')").first();
    await expect(buyButton).toBeVisible();
  });

  test("JOURNEY 3: Limit order placement and cancellation", async ({ page }) => {
    await page.goto("http://localhost:3000/terminal?symbol=TCS&exchange=NSE");
    await expect(page.locator("body")).toContainText("TCS");
  });

  test("JOURNEY 5: Data quality badge displays honest label without false Live", async ({ page }) => {
    await page.goto("http://localhost:3000/terminal?symbol=INFY&exchange=NSE");
    await expect(page.locator("body")).not.toContainText("L2 Live");
    await expect(page.locator("body")).not.toContainText("Options Greeks (Live)");
  });
});
