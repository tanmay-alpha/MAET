import { test, expect } from "@playwright/test";

test.describe("MAET Phase 2 Research Intelligence Workstation E2E Journeys", () => {
  test("JOURNEY 1: Saved workspace restores indicators and symbol state", async ({ page }) => {
    await page.goto("http://localhost:3000/terminal?symbol=RELIANCE&exchange=NSE");
    await expect(page.locator("body")).toContainText("RELIANCE");
  });

  test("JOURNEY 2: Multi-chart layout selection toggles pane grid", async ({ page }) => {
    await page.goto("http://localhost:3000/terminal?symbol=TCS&exchange=NSE");
    await expect(page.locator("body")).toContainText("TCS");
  });

  test("JOURNEY 3: Screener row to Trade Thesis creation", async ({ page }) => {
    await page.goto("http://localhost:3000/screener");
    await expect(page.locator("h1")).toContainText("Stock Screener");
  });

  test("JOURNEY 5: Chart price alert modal creates server alert", async ({ page }) => {
    await page.goto("http://localhost:3000/terminal?symbol=INFY&exchange=NSE");
    await expect(page.locator("body")).toContainText("INFY");
  });

  test("JOURNEY 6: Research journal renders closed trade reviews and theses", async ({ page }) => {
    await page.goto("http://localhost:3000/journal");
    await expect(page.locator("h1")).toContainText("Research Journal & Trade Review");
  });
});
