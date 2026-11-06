import { BASE_PRICES } from "./support/data";
import { test, expect } from "./support/fixtures";

const inr = (value: number) =>
  `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

test("after hours: closed-market delayed quotes are labelled delayed, never live", async ({
  page,
  api,
}) => {
  api.session = "closed";
  await page.goto("/dashboard");

  // The REST snapshot landed, then the SSE tick replaced NIFTY 50's price.
  await expect(page.getByText(inr(api.tick.price), { exact: true })).toBeVisible();
  expect(api.requests.some((entry) => entry.url.pathname === "/api/market/stream")).toBe(true);

  await expect(
    page.getByText("Market closed · last available quotes · Backend authoritative state", {
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

  await expect(page.getByText(inr(api.tick.price), { exact: true })).toBeVisible();
  await expect(page.getByText(inr(BASE_PRICES.SENSEX), { exact: true })).toBeVisible();
  await expect(
    page.getByText("Live quotes · Backend authoritative state", { exact: true }),
  ).toBeVisible();
  await expect(page.getByText("Live", { exact: true })).toBeVisible();
  await expect(page.getByText("Delayed", { exact: true })).toHaveCount(0);
});
