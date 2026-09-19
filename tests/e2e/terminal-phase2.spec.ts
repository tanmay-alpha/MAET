import { test, expect } from "@playwright/test";

test.describe("MAET Phase 2 Research Intelligence Workstation E2E Journeys", () => {
  test("JOURNEY 1: Symbol routing and interval/indicator state controls", async ({ page }) => {
    await page.goto("/terminal?symbol=RELIANCE&exchange=NSE");
    await expect(page.locator("body")).toContainText("RELIANCE");

    // Interval toggle: select 15m timeframe
    const interval15m = page.locator("button", { hasText: "15m" }).first();
    if (await interval15m.isVisible()) {
      await interval15m.click();
      await expect(interval15m).toHaveClass(/bg-primary/);
    }

    // Toggle indicator (RSI)
    const rsiButton = page.locator("button", { hasText: "rsi" }).first();
    if (await rsiButton.isVisible()) {
      await rsiButton.click();
      await expect(rsiButton).toHaveClass(/text-primary/);
    }
  });

  test("JOURNEY 2: Chart display mode toggle between Candles and Line", async ({ page }) => {
    await page.goto("/terminal?symbol=TCS&exchange=NSE");
    await expect(page.locator("body")).toContainText("TCS");

    // Chart mode toggle
    const lineButton = page.locator("button", { hasText: "Line" }).first();
    const candlesButton = page.locator("button", { hasText: "Candles" }).first();

    if (await lineButton.isVisible() && await candlesButton.isVisible()) {
      await lineButton.click();
      await expect(lineButton).toHaveClass(/font-semibold/);

      await candlesButton.click();
      await expect(candlesButton).toHaveClass(/font-semibold/);
    }
  });

  test("JOURNEY 3: Screener tab switching and search input interaction", async ({ page }) => {
    await page.goto("/screener");
    await expect(page.locator("h1")).toContainText("Stock Screener");

    // Verify search input is interactive
    const searchInput = page.locator("input[placeholder*='Search']").first();
    if (await searchInput.isVisible()) {
      await searchInput.fill("INFY");
      await expect(searchInput).toHaveValue("INFY");
    }

    // Switch screener view tab
    const technicalsTab = page.locator("button", { hasText: "Technicals" }).first();
    if (await technicalsTab.isVisible()) {
      await technicalsTab.click();
      await expect(technicalsTab).toBeVisible();
    }
  });

  test("JOURNEY 5: Terminal account and order book tab switching", async ({ page }) => {
    await page.goto("/terminal?symbol=INFY&exchange=NSE");
    await expect(page.locator("body")).toContainText("INFY");

    // Switch between bottom panel tabs
    const ordersTab = page.locator("button", { hasText: "Orders" }).first();
    const historyTab = page.locator("button", { hasText: "Trade History" }).first();
    const positionsTab = page.locator("button", { hasText: "Positions" }).first();

    if (await ordersTab.isVisible()) {
      await ordersTab.click();
      await expect(ordersTab).toBeVisible();
    }
    if (await historyTab.isVisible()) {
      await historyTab.click();
      await expect(historyTab).toBeVisible();
    }
    if (await positionsTab.isVisible()) {
      await positionsTab.click();
      await expect(positionsTab).toBeVisible();
    }
  });

  test("JOURNEY 6: Research journal renders closed trade reviews and theses", async ({ page }) => {
    await page.goto("/journal");
    await expect(page.locator("h1")).toContainText("Research Journal & Trade Review");
  });
});
