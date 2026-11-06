import { test, expect } from "./support/fixtures";
import { API_ORIGIN } from "./support/mock-api";

test("signed out: /terminal makes no protected calls and asks the visitor to sign in", async ({
  page,
  api,
}) => {
  await page.goto("/terminal");

  const ticket = page.getByText("Order Ticket", { exact: true }).locator("xpath=../..");
  await expect(ticket.getByText("₹2450.00", { exact: true })).toBeVisible();
  await expect(
    ticket
      .getByRole("status")
      .filter({ hasText: "Paper trading requires a signed-in account. Sign-in is coming soon." }),
  ).toBeVisible();
  await expect(ticket.getByRole("button", { name: "BUY 10 RELIANCE", exact: true })).toBeDisabled();
  await expect(ticket.getByRole("button", { name: "BUY", exact: true })).toBeDisabled();

  // The market stream opens after the 400 ms subscription debounce, well after the paper
  // account query and paper stream would have started on mount.
  await expect
    .poll(() => api.requests.some((entry) => entry.url.pathname === "/api/market/stream"))
    .toBe(true);
  await expect(page.getByRole("status").filter({ hasText: "Paper trading requires a signed-in account." })).toHaveCount(1);
  await expect(page.getByText("Paper account balances and positions")).toHaveCount(0);
  await expect(page.getByText("Net Asset Value (NAV)", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Free Margin", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset Account", exact: true })).toHaveCount(0);
  await expect(page.getByText("Paper Workstation", { exact: true })).toHaveCount(0);
  await expect(page.locator("header").getByText("Sign-in coming soon", { exact: true })).toBeVisible();
  await expect(page.getByText("Honest Market Data Policy", { exact: true })).toHaveCount(0);
  await expect(page.locator('[title^="Quote source:"]').first()).toHaveAttribute("title", /Quote source: (Angel One|Yahoo)/);
  await expect(page.getByText(/^(YAH|ANG)$/)).toHaveCount(0);

  const protectedCalls = api.requests
    .filter(
      ({ url }) => url.pathname.startsWith("/api/trpc/") || url.pathname.startsWith("/api/paper/"),
    )
    .map(({ method, url }) => `${method} ${url.pathname}`);
  expect(protectedCalls).toEqual([]);
});

test("signed out: /dashboard hides account balances and trading actions", async ({ page, api }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Paper trading dashboard" })).toBeVisible();
  await expect(
    page.getByRole("status").filter({ hasText: "Paper account requires sign-in." }),
  ).toBeVisible();
  await expect(page.getByText("Portfolio equity", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Positions overview", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
  await expect(page.getByText("Paper Workstation", { exact: true })).toHaveCount(0);
  await expect(page.locator("header").getByText("Sign-in coming soon", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("NIFTY 50", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "NIFTY 50 movers" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Top 5 gainers" }).getByRole("row")).toHaveCount(6);
  await expect(page.getByRole("heading", { name: "Guest watchlist" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Research shortcuts" }).getByRole("link")).toHaveText(["Screener", "Charts", "Strategy Lab"]);
  const quoteRequests = api.requests.filter(({ url }) => url.pathname === "/api/market/quotes");
  expect(quoteRequests.some(({ url }) => url.searchParams.get("symbols")?.split(",").length === 50)).toBe(true);
  expect(quoteRequests.every(({ url }) => (url.searchParams.get("symbols")?.split(",").length ?? 0) <= 50)).toBe(true);
  expect(api.requests.filter(({ url }) => url.pathname.startsWith("/api/trpc/"))).toEqual([]);
});

test("signed out: dashboard restores the device watchlist and links each quote to its stock", async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem("maet_guest_watchlist_v1", JSON.stringify([{ symbol: "TCS", name: "Tata Consultancy Services", exchange: "NSE" }])));
  await page.goto("/dashboard");
  const watchlist = page.getByRole("region", { name: "Guest watchlist" });
  await expect(watchlist.getByRole("link", { name: "TCS", exact: true })).toHaveAttribute("href", "/stock/TCS");
  await expect(watchlist.getByRole("link", { name: "RELIANCE", exact: true })).toHaveCount(0);
  await expect(watchlist.getByText("₹3,890.55", { exact: true })).toBeVisible();
  await expect(watchlist.getByRole("link", { name: "Watchlists", exact: true })).toHaveAttribute("href", "/watchlists");
  expect(api.requests.filter(({ url }) => url.pathname.startsWith("/api/trpc/"))).toEqual([]);
});

const SIGNED_OUT_PAGES = [
  { path: "/portfolio", notice: "Portfolio returns and tax estimates require a signed-in account." },
  { path: "/journal", notice: "Trade theses and reviews require a signed-in account." },
  { path: "/replay", notice: "Replay sessions require a signed-in account." },
  { path: "/performance", notice: "Backtest results require a signed-in account." },
  { path: "/options/NIFTY", notice: "Options chains require a signed-in account." },
  { path: "/admin/data-quality", notice: "Ingestion audits and anomalies are visible to admin accounts." },
  { path: "/workspace", notice: "Watchlists, saved screeners and screener runs require a signed-in account." },
];

for (const { path, notice } of SIGNED_OUT_PAGES) {
  test(`signed out: ${path} explains sign-in and makes no protected tRPC calls`, async ({ page, api }) => {
    await page.goto(path);
    await expect(page.getByText(notice)).toBeVisible();

    const trpcCalls = api.requests
      .filter(({ url }) => url.pathname.startsWith("/api/trpc/"))
      .map(({ url }) => url.pathname);
    expect(trpcCalls).toEqual([]);
  });
}

test("signed out: /compare charts prices without requesting protected peer fundamentals", async ({ page, api }) => {
  await page.goto("/compare");
  // The tab bar is server-rendered, so a click can land before React attaches its handler.
  // Repeat it until the Valuation view (which carries the notice) is shown.
  await expect(async () => {
    await page.getByRole("button", { name: "Valuation", exact: true }).click();
    await expect(page.getByText("Peer fundamentals require a signed-in account.")).toBeVisible({
      timeout: 1_000,
    });
  }).toPass();
  await expect(page.getByRole("columnheader", { name: "Peer median" })).toHaveCount(0);
  expect(api.requests.some(({ url }) => url.pathname.includes("getPeerComparison"))).toBe(false);
});

test("signed out: Data status shows backend health and the quote source the APIs report", async ({ page, api }) => {
  await page.route(`${API_ORIGIN}/api/health`, (route) =>
    route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ status: "degraded", version: "587e24fa6a1a", checks: { database: false, redis: true, orchestrator: true, marketData: true } }),
    }),
  );
  await page.goto("/admin/data-quality");
  await expect(page.getByRole("heading", { level: 1, name: "Data status" })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Database down/ })).toBeVisible();
  await expect(page.getByRole("row", { name: /^Redis up/ })).toBeVisible();
  await expect(page.getByText(/^Database offline:/)).toBeVisible();
  await expect(page.getByText("build 587e24f", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText(/^(Angel One|Yahoo) · (live|delayed)/)).toBeVisible();
  expect(api.requests.filter(({ url }) => url.pathname.startsWith("/api/trpc/"))).toEqual([]);
});
