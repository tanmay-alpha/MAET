import type { Locator, Page } from "@playwright/test";
import { test, expect } from "./support/fixtures";

const NONE_IN_RANGE = "No dividends or splits reported by Yahoo Finance in this range.";

/**
 * Sweeps the pointer across a chart's price pane and returns every tooltip line shown.
 * lightweight-charts draws markers on a canvas, so hovering is the only way to read them.
 */
async function tooltipsAcross(page: Page, chart: Locator): Promise<string[]> {
  const pane = chart.locator("canvas").first();
  await expect(pane).toBeVisible();
  const box = (await pane.boundingBox())!;
  // Record every tooltip the page shows, so the sweep needs one round trip per step.
  await page.evaluate(() => {
    const seen = new Set<string>();
    Object.assign(window, { __tooltips: seen });
    new MutationObserver(() => {
      for (const tooltip of document.querySelectorAll<HTMLElement>('[role="tooltip"]')) {
        for (const line of tooltip.innerText.split("\n")) if (line.trim()) seen.add(line.trim());
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
  });
  // 60 fixture bars span the pane: a step under half a bar width visits each one.
  const step = Math.max(1, Math.floor(box.width / 150));
  for (let x = box.x + 1; x < box.x + box.width - 1; x += step) {
    await page.mouse.move(x, box.y + box.height / 2);
  }
  return page.evaluate(() => [...(Reflect.get(window, "__tooltips") as Set<string>)].sort());
}

test("stock page: dividend and split markers with hover details, a toggle and the corporate actions table", async ({
  page,
}) => {
  await page.goto("/stock/RELIANCE");

  const table = page.getByRole("region", { name: "Corporate actions" });
  await expect(table.getByRole("row")).toHaveText([
    "Ex-dateActionDetails",
    "14 Oct 2026Dividend₹24.00 per share",
    "21 Sep 2026Split/bonus2 for 1 · 1:1 as bonus",
    "14 Aug 2025Dividend₹5.50 per share (split-adjusted)",
    "19 Aug 2024Dividend₹5.00 per share (split-adjusted)",
    "7 Sep 2017Reverse split1 for 10",
  ]);
  await expect(table.getByText("Source: Yahoo Finance", { exact: true })).toBeVisible();

  const chart = page.locator("section").filter({ has: page.getByRole("heading", { name: "Price history · 1Y daily" }) });
  const toggle = chart.getByRole("button", { name: "Dividends & splits" });
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expect(chart.getByText("1 dividend · 1 split in range · Yahoo Finance", { exact: true })).toBeVisible();
  expect(await tooltipsAcross(page, chart)).toEqual([
    "Dividend ₹24.00 · ex-date 14 Oct 2026 · Yahoo Finance",
    "Split/bonus 2 for 1 · ex-date 21 Sep 2026 · Yahoo Finance",
  ]);

  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "false", { timeout: 1_000 });
  }).toPass();
  await expect(chart.getByText(/in range · Yahoo Finance$/)).toHaveCount(0);
  expect(await tooltipsAcross(page, chart)).toEqual([]);
  // The table lists the provider's events whether or not the chart shows them.
  await expect(table.getByRole("row")).toHaveCount(6);
});

test("stock page: says so when the provider reports no dividends or splits", async ({ page, api }) => {
  api.corporateActions = [];
  await page.goto("/stock/RELIANCE");

  const table = page.getByRole("region", { name: "Corporate actions" });
  await expect(table.getByText(NONE_IN_RANGE, { exact: true })).toBeVisible();
  await expect(table.getByRole("table")).toHaveCount(0);
  const chart = page.locator("section").filter({ has: page.getByRole("heading", { name: "Price history · 1Y daily" }) });
  await expect(chart.getByText(NONE_IN_RANGE, { exact: true })).toBeVisible();
});

test("full chart: dividends and splits are off by default and follow the selected range", async ({ page }) => {
  await page.goto("/chart/RELIANCE");
  await expect(page.getByRole("heading", { level: 1, name: "RELIANCE" })).toBeVisible();

  const toggle = page.getByRole("button", { name: "Dividends & splits" });
  await expect(toggle).toHaveAttribute("aria-pressed", "false");
  // The page is server-rendered: repeat the click until React handles it.
  await expect(async () => {
    await toggle.click();
    await expect(toggle).toHaveAttribute("aria-pressed", "true", { timeout: 1_000 });
  }).toPass();

  // Five days of 5-minute bars hold none of the fixture events.
  await expect(page.getByText(NONE_IN_RANGE, { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "1 Year", exact: true }).click();
  await expect(page.getByText("1 dividend · 1 split in range · Yahoo Finance", { exact: true })).toBeVisible();
});
