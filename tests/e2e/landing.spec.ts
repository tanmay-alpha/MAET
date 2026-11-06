import { test, expect } from "./support/fixtures";

test("landing exposes public heatmap, one index row and working research links", async ({ page, api }) => {
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    // The shared mock intentionally aborts Google Fonts; application errors still fail.
    // The node-server preview build has a known global stylesheet hash mismatch.
    const previewStylesheet = /\/assets\/styles-[^/]+\.css$/.test(message.location().url);
    if (message.type() === "error" && !message.location().url.startsWith("https://fonts.googleapis.com/") && !previewStylesheet) {
      errors.push(message.text());
    }
  });
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "NIFTY 50 heatmap" })).toBeVisible();
  await expect(page.getByTestId("heatmap-tile")).toHaveCount(50);
  await expect(page.getByText("50/50 changes available", { exact: true })).toBeVisible();
  await expect(page.getByTestId("landing-index")).toHaveCount(6);
  await expect(page.locator("#heatmap").getByText("Angel One · Live quotes", { exact: true })).toBeVisible();
  await expect(page.getByRole("table", { name: "Latest public equity quotes" }).getByRole("link", { name: "RELIANCE", exact: true })).toBeVisible();
  await expect(page.locator('a[href="#"]')).toHaveCount(0);
  await expect(page.getByText(/MIT licensed|Honest Market Data Policy|Flow feed unavailable|Sign in to see the verified market heatmap/)).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Docs", exact: true })).toHaveAttribute("href", "https://github.com/tanmay-alpha/MAET/blob/main/docs/ARCHITECTURE.md");
  await expect(page.getByRole("navigation", { name: "Footer", exact: true }).getByRole("link", { name: "Data Status", exact: true })).toHaveAttribute("href", "/admin/data-quality");
  expect(api.requests.filter(({ url }) => url.pathname.startsWith("/api/trpc/") || url.pathname.startsWith("/api/paper/"))).toEqual([]);
  const quoteRequests = api.requests.filter(({ url }) => url.pathname === "/api/market/quotes");
  expect(quoteRequests.every(({ url }) => (url.searchParams.get("symbols") ?? "").split(",").length <= 50)).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  expect(errors).toEqual([]);
});

test("landing reflects delayed provider and market-closed timestamps", async ({ page, api }) => {
  api.session = "closed";
  await page.goto("/");
  const heatmap = page.locator("#heatmap");
  await expect(heatmap.getByText("Yahoo Finance · Market closed · last available quotes", { exact: true })).toBeVisible();
  await expect(heatmap.getByText(/Quote times:.*IST/)).toBeVisible();
  await expect(heatmap.getByText(/Live quotes/)).toHaveCount(0);
  await heatmap.getByRole("link").filter({ hasText: "RELIANCE" }).click();
  await expect(page).toHaveURL(/\/stock\/RELIANCE$/);
});

test("landing keeps missing changes uncoloured instead of inventing prices", async ({ page, api }) => {
  void api;
  await page.route("**/api/market/quotes?**", async (route) => {
    const url = new URL(route.request().url());
    if ((url.searchParams.get("symbols") ?? "").split(",").length !== 50) return route.fallback();
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({
      asOf: "2026-11-06T10:15:00.000Z", source: "yahoo", delayed: true, marketPhase: "CLOSED", quotes: [], errors: [{ symbol: "RELIANCE", message: "Provider unavailable" }],
    }) });
  });
  await page.goto("/");
  await expect(page.getByText("0/50 changes available", { exact: true })).toBeVisible();
  const reliance = page.getByTestId("heatmap-tile").filter({ hasText: "RELIANCE" });
  await expect(reliance).toContainText("Unavailable");
  await expect(reliance).toContainText("—");
  await expect(reliance).toHaveClass(/bg-panel text-muted-foreground/);
});
