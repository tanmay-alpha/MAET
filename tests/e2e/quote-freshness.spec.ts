import { BASE_PRICES } from "./support/data";
import { test, expect } from "./support/fixtures";

const price = (value: number) => value.toLocaleString("en-IN");

test("after hours: closed-market delayed quotes are labelled delayed, never live", async ({
  page,
  api,
}) => {
  api.session = "closed";
  await page.goto("/dashboard");

  // The REST snapshot landed, then the SSE tick replaced NIFTY 50's price.
  await expect(page.getByText(price(api.tick.price), { exact: true }).first()).toBeVisible();
  expect(api.requests.some((entry) => entry.url.pathname === "/api/market/stream")).toBe(true);

  await expect(
    page.getByText("Market closed · last available quotes", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.getByText(/Live quotes/)).toHaveCount(0);
  // App-shell ticker badge.
  await expect(page.getByText("Delayed", { exact: true })).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toHaveCount(0);
});

test("market hours: real-time broker quotes are labelled live", async ({ page, api }) => {
  api.session = "open";
  await page.goto("/dashboard");

  await expect(page.getByText(price(api.tick.price), { exact: true }).first()).toBeVisible();
  await expect(page.getByText(price(BASE_PRICES.SENSEX), { exact: true }).first()).toBeVisible();
  await expect(
    page.getByText("Live quotes", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText("Delayed", { exact: true })).toHaveCount(0);
});
