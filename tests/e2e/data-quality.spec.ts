import type { Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";
import { mockDataQualityReport } from "./support/data-quality-data";

const VIEWPORTS = [
  { width: 360, height: 780 },
  { width: 768, height: 1024 },
  { width: 1440, height: 900 },
] as const;

async function expectNoPageOverflow(page: Page) {
  const overflow = await page.evaluate(() => ({
    document: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    body: document.body.scrollWidth - document.body.clientWidth,
  }));
  expect(overflow.document).toBeLessThanOrEqual(0);
  expect(overflow.body).toBeLessThanOrEqual(0);
}

const row = (page: Page, symbol: string) => page.locator(`[data-testid="symbol-row"][data-symbol="${symbol}"]`);

for (const viewport of VIEWPORTS) {
  test(`data quality at ${viewport.width}px: badges, gaps panel, no page overflow`, async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "desktop", "viewports are set explicitly; one project is enough");
    await page.setViewportSize(viewport);
    await mockDataQualityReport(page);
    await page.goto("/data-quality");

    await expect(page.getByRole("heading", { name: "Market data quality", level: 1 })).toBeVisible();
    await expect(page.getByTestId("report-meta")).toContainText("2026-11-05");

    // Summary cards: coverage, counts in words, last quote with source and a delayed label.
    const summary = page.getByRole("region", { name: "Summary" });
    await expect(summary).toContainText("75%");
    await expect(page.getByTestId("freshness-counts")).toHaveText("2 fresh · 1 stale · 1 missing");
    await expect(page.getByTestId("last-quote-source")).toContainText("Yahoo");
    await expect(page.getByTestId("last-quote-source")).toContainText("Delayed");

    // Freshness badges carry text, not just colour.
    await expect(row(page, "TCS").getByTestId("freshness-badge")).toHaveText("Fresh");
    await expect(row(page, "INFY").getByTestId("freshness-badge")).toHaveText("Stale");
    await expect(row(page, "WIPRO").getByTestId("freshness-badge")).toHaveText("Missing");
    await expect(row(page, "INFY")).toContainText("4 sessions behind");
    await expect(row(page, "RELIANCE")).toContainText("high < low, close outside range");
    await expect(row(page, "WIPRO")).toContainText("No stored quote");

    // Default sort: worst freshness first.
    await expect(page.getByTestId("symbol-row").first()).toHaveAttribute("data-symbol", "WIPRO");

    // Gaps panel lists every detected gap with a worded severity.
    const gaps = page.getByRole("region", { name: /Pipeline gaps/ });
    await expect(gaps.getByTestId("pipeline-gap")).toHaveCount(3);
    await expect(gaps.locator('[data-gap-id="price_daily_not_consumed"]')).toContainText("Critical");
    await expect(gaps.locator('[data-gap-id="corporate_actions_empty"]')).toContainText("Warning");

    // The table scrolls inside its own container; the page never scrolls sideways.
    await expectNoPageOverflow(page);
    await page.screenshot({ path: `test-results/data-quality/data-quality-${viewport.width}.png`, fullPage: true });
  });
}

test("data quality: sort and filter the symbol table", async ({ page }) => {
  await mockDataQualityReport(page);
  await page.goto("/data-quality");
  const table = page.getByRole("table");
  await expect(table.getByTestId("symbol-row")).toHaveCount(4);

  await page.getByLabel("Show").selectOption("stale");
  await expect(table.getByTestId("symbol-row")).toHaveCount(1);
  await expect(table.getByTestId("symbol-row")).toHaveAttribute("data-symbol", "INFY");

  await page.getByLabel("Show").selectOption("invalid");
  await expect(table.getByTestId("symbol-row")).toHaveAttribute("data-symbol", "RELIANCE");

  await page.getByLabel("Show").selectOption("all");
  await page.getByLabel("Search").fill("infos");
  await expect(table.getByTestId("symbol-row")).toHaveAttribute("data-symbol", "INFY");
  await page.getByLabel("Search").fill("");

  const symbolHeader = page.getByRole("columnheader", { name: "Symbol" });
  await symbolHeader.getByRole("button").click();
  await expect(symbolHeader).toHaveAttribute("aria-sort", "descending");
  await expect(table.getByTestId("symbol-row").first()).toHaveAttribute("data-symbol", "WIPRO");
  await symbolHeader.getByRole("button").click();
  await expect(symbolHeader).toHaveAttribute("aria-sort", "ascending");
  await expect(table.getByTestId("symbol-row").first()).toHaveAttribute("data-symbol", "INFY");

  await page.getByLabel("Search").fill("nothing-matches");
  await expect(page.getByText("No symbols match this filter.")).toBeVisible();
});

test("data quality: error state retries and recovers", async ({ page }) => {
  const mock = await mockDataQualityReport(page);
  mock.failing = true;
  await page.goto("/data-quality");

  const alert = page.getByRole("alert").filter({ hasText: "could not be loaded" });
  await expect(alert).toBeVisible({ timeout: 15_000 });
  await expectNoPageOverflow(page);

  mock.failing = false;
  await alert.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByTestId("freshness-badge").first()).toBeVisible();
  await expect(alert).toHaveCount(0);
});

test("data quality: empty universe shows an explanation instead of an empty table", async ({ page }) => {
  const mock = await mockDataQualityReport(page);
  mock.report.symbols = [];
  mock.report.universe.symbolCount = 0;
  await page.goto("/data-quality");
  await expect(page.getByText("No symbols in this universe yet.")).toBeVisible();
  await expect(page.getByRole("table")).toHaveCount(0);
  await expect(page.getByRole("region", { name: /Pipeline gaps/ })).toBeVisible();
});
