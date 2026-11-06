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
    page.getByText("Paper account balances and positions require a signed-in account. Sign-in is coming soon."),
  ).toBeVisible();
  await expect(page.getByText("Net Asset Value (NAV)", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Free Margin", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset Account", exact: true })).toHaveCount(0);
  await expect(page.getByText("Paper Workstation", { exact: true })).toHaveCount(0);
  await expect(page.locator("header").getByText("Sign-in coming soon", { exact: true })).toBeVisible();
  await expect(page.getByText("Honest Market Data Policy", { exact: true })).toHaveCount(0);

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
    page.getByRole("status").filter({ hasText: "Paper account balances and positions require a signed-in account." }),
  ).toBeVisible();
  await expect(page.getByText("Portfolio equity", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Positions overview", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
  await expect(page.getByText("Paper Workstation", { exact: true })).toHaveCount(0);
  await expect(page.locator("header").getByText("Sign-in coming soon", { exact: true })).toBeVisible();
  await expect(page.locator("main").getByText("NIFTY 50", { exact: true })).toHaveCount(0);
  expect(api.requests.filter(({ url }) => url.pathname.startsWith("/api/trpc/"))).toEqual([]);
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
