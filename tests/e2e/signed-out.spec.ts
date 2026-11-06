import { test, expect } from "./support/fixtures";

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
  await expect(
    page.getByText("No open positions. Place an order to execute a trade."),
  ).toBeVisible();

  const protectedCalls = api.requests
    .filter(
      ({ url }) => url.pathname.startsWith("/api/trpc/") || url.pathname.startsWith("/api/paper/"),
    )
    .map(({ method, url }) => `${method} ${url.pathname}`);
  expect(protectedCalls).toEqual([]);
});

const SIGNED_OUT_PAGES = [
  { path: "/journal", notice: "Trade theses and reviews require a signed-in account." },
  { path: "/replay", notice: "Replay sessions require a signed-in account." },
  { path: "/performance", notice: "Backtest results require a signed-in account." },
  { path: "/options/NIFTY", notice: "Options chains require a signed-in account." },
  { path: "/admin/data-quality", notice: "Data Quality Centre is available to admin users only." },
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
  await page.getByRole("button", { name: "Valuation", exact: true }).click();
  await expect(page.getByText("Peer fundamentals require a signed-in account.")).toBeVisible();
  expect(api.requests.some(({ url }) => url.pathname.includes("getPeerComparison"))).toBe(false);
});
