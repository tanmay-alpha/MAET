import { test, expect } from "./support/fixtures";

test("chart route renders before lightweight-charts loads, with a status placeholder the chart replaces in place", async ({
  page,
}) => {
  // Hold the lazily imported chart chunk until the placeholder has been measured.
  let release!: () => void;
  const held = new Promise<void>((resolve) => (release = resolve));
  await page.route(/\/assets\/candlestick-chart-[^/]+\.js$/, async (route) => {
    await held;
    await route.fallback();
  });

  await page.goto("/chart/RELIANCE");
  await expect(page.getByRole("heading", { level: 1, name: "RELIANCE" })).toBeVisible();
  const placeholder = page.getByRole("status").filter({ hasText: "Loading chart…" });
  await expect(placeholder).toBeVisible();
  const before = await placeholder.boundingBox();

  release();
  const chart = page.getByRole("img", { name: /^RELIANCE candlestick chart/ });
  await expect(chart).toBeVisible();
  await expect(placeholder).toHaveCount(0);
  // The chart frame is the canvas container's parent; it takes exactly the placeholder's box.
  const after = await chart.locator("..").boundingBox();
  expect(before).not.toBeNull();
  expect(after).toEqual(before);
});
