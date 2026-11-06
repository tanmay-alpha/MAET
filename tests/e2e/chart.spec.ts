import type { Page } from "@playwright/test";
import type { MarketCandle } from "../../src/lib/market-api";
import { candlesFor } from "./support/data";
import { test, expect } from "./support/fixtures";

/** The Price card shows the last fixture candle's OHLC, two decimals, no grouping. */
async function expectLastCandle(page: Page, tf: MarketCandle["tf"]) {
  const last = candlesFor("RELIANCE", tf).at(-1)!;
  const card = page.getByRole("heading", { name: "Price", exact: true }).locator("..");
  for (const [label, value] of [
    ["Open", last.open],
    ["High", last.high],
    ["Low", last.low],
    ["Close", last.close],
  ] as const) {
    await expect(
      card.locator("div.flex.justify-between").filter({ hasText: new RegExp(`^${label}`) }),
    ).toHaveText(`${label}${value.toFixed(2)}`);
  }
}

test("chart: renders fixture candles, requests the selected timeframe and restores the layout after reload", async ({
  page,
  api,
}) => {
  await page.goto("/chart/RELIANCE");
  await expect(page.getByRole("heading", { level: 1, name: "RELIANCE" })).toBeVisible();

  await expectLastCandle(page, "5m");
  expect(api.candleRequests()).toContainEqual({ symbol: "RELIANCE", tf: "5m", range: "5d" });
  // lightweight-charts paints the series onto canvases sized to the chart container.
  const canvas = page.locator("canvas").first();
  await expect(canvas).toBeVisible();
  expect((await canvas.boundingBox())?.width).toBeGreaterThan(100);

  await page.getByRole("button", { name: "1 Year", exact: true }).click();
  await expect
    .poll(() => api.candleRequests().at(-1))
    .toEqual({ symbol: "RELIANCE", tf: "1d", range: "1y" });
  await expectLastCandle(page, "1d");

  await page.getByRole("button", { name: "3 Months", exact: true }).click();
  await expect
    .poll(() => api.candleRequests().at(-1))
    .toEqual({ symbol: "RELIANCE", tf: "1h", range: "3mo" });
  await expectLastCandle(page, "1h");

  await page.getByRole("button", { name: "1 Year", exact: true }).click();
  await page.getByTitle("Line Chart (L)").click();
  await page.getByRole("button", { name: "Moving Avg", exact: true }).click();
  await expect(page.getByText("SMA 20", { exact: true })).toBeVisible();
  await expectLastCandle(page, "1d");

  const stored = await page.evaluate(() =>
    window.localStorage.getItem("maet_chart_layout_RELIANCE"),
  );
  expect(JSON.parse(stored ?? "null")).toEqual({
    timeframe: "1D",
    chartType: "line",
    indicators: { volume: true, ma: true, rsi: false, macd: false },
    drawingTool: null,
  });

  const beforeReload = api.candleRequests().length;
  await page.reload();
  await expect(page.getByRole("heading", { level: 1, name: "RELIANCE" })).toBeVisible();
  await expect
    .poll(() => api.candleRequests().slice(beforeReload))
    .toContainEqual({ symbol: "RELIANCE", tf: "1d", range: "1y" });
  await expectLastCandle(page, "1d");
  await expect(page.getByText("SMA 20", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "1 Year", exact: true })).toHaveClass(
    /\bbg-primary\b/,
  );
  await expect(page.getByRole("button", { name: "5 Days", exact: true })).not.toHaveClass(
    /\bbg-primary\b/,
  );
  await expect(page.getByTitle("Line Chart (L)")).toHaveClass(/\bbg-primary\b/);
  await expect(page.getByTitle("Candlestick Chart (C)")).not.toHaveClass(/\bbg-primary\b/);
});
