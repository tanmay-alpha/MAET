import type { Page } from "@playwright/test";
import { test, expect, signIn } from "./support/fixtures";

const EXPIRED = "Your session has expired. Sign in again.";
const UNAVAILABLE = "Paper account unavailable: the server could not load it.";
/** The fixture account's cash; it must only ever appear because the server returned it. */
const FIXTURE_CASH = "₹10,00,000";
/** A token the fake backend answers with 401, like a revoked or expired stored session. */
const REJECTED_TOKEN = "e2e-rejected-access-token";
/** React Query retries a failed (non-401) query three times with backoff before erroring. */
const AFTER_RETRIES = { timeout: 20_000 };

/** The account actions each page offers, which must not work without a loaded account. */
async function expectAccountActionsBlocked(page: Page, path: string) {
  if (path === "/terminal") {
    const ticket = page.getByText("Order Ticket", { exact: true }).locator("xpath=../..");
    await expect(ticket.getByRole("button", { name: "BUY 10 RELIANCE", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Reset Account", exact: true })).toHaveCount(0);
    await expect(page.getByText("Net Asset Value (NAV)", { exact: true })).toHaveCount(0);
    return;
  }
  if (path === "/dashboard") {
    // No account actions, but the public market workspace stays useful below the notice.
    await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Reset", exact: true })).toHaveCount(0);
    await expect(page.getByText("Portfolio equity", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "NIFTY 50 movers" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Top 5 gainers" }).getByRole("row")).toHaveCount(6);
    await expect(page.getByRole("heading", { name: "Guest watchlist" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Research shortcuts" }).getByRole("link")).toHaveText(["Screener", "Charts", "Strategy Lab"]);
    await expect(page.getByText("Paper account requires sign-in.")).toHaveCount(0);
    return;
  }
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeDisabled();
}

const ACCOUNT_PAGES = ["/dashboard", "/terminal", "/portfolio"];

for (const path of ACCOUNT_PAGES) {
  test(`expired session: ${path} asks to sign in again and invents no balances`, async ({ page, api }) => {
    await signIn(page, REJECTED_TOKEN);
    await page.goto(path);

    await expect(page.getByRole("status").filter({ hasText: EXPIRED })).toHaveCount(1);
    await expect(page.getByRole("status").filter({ hasText: EXPIRED })).toBeVisible();
    await expectAccountActionsBlocked(page, path);
    await expect(page.locator("body")).not.toContainText(FIXTURE_CASH);
    await expect(page.getByText(/Backend authoritative state/)).toHaveCount(0);
    await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
    await expect(page.getByText("Portfolio XIRR · annualised")).toHaveCount(0);
    expect(api.trpcCalls("paperTrading.getState").length).toBeGreaterThan(0);
    // The stored session is left alone: a Supabase refresh may still recover it.
    expect(await page.evaluate(() => localStorage.getItem("sb-e2e-auth-token"))).toContain(REJECTED_TOKEN);
  });

  test(`backend down: ${path} says the paper account is unavailable and offers Retry`, async ({ page, api }) => {
    api.failProcedure("paperTrading.getState", { code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
    await signIn(page);
    await page.goto(path);

    const notice = page.getByRole("status").filter({ hasText: UNAVAILABLE });
    await expect(notice).toBeVisible(AFTER_RETRIES);
    await expect(notice).toHaveCount(1);
    await expect(notice.getByRole("button", { name: "Retry", exact: true })).toBeEnabled();
    await expectAccountActionsBlocked(page, path);
    await expect(page.locator("body")).not.toContainText(FIXTURE_CASH);
    await expect(page.getByText(EXPIRED)).toHaveCount(0);
    await expect(page.getByText("Portfolio XIRR · annualised")).toHaveCount(0);
  });
}

test("backend down: Retry loads the account once the server answers again", async ({ page, api }) => {
  api.failProcedure("paperTrading.getState", { code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  await signIn(page);
  await page.goto("/dashboard");
  const notice = page.getByRole("status").filter({ hasText: UNAVAILABLE });
  await expect(notice).toBeVisible(AFTER_RETRIES);

  api.failProcedure("paperTrading.getState", null);
  await notice.getByRole("button", { name: "Retry", exact: true }).click();

  await expect(page.getByText("Portfolio equity", { exact: true })).toBeVisible();
  await expect(page.getByText(`Cash: ${FIXTURE_CASH}.00`, { exact: true })).toBeVisible();
  await expect(notice).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toBeEnabled();
});

test("valid session: the /portfolio header keeps Quick Trade and Reset on screen at 390px", async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await signIn(page);
  await page.goto("/portfolio");
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeInViewport({ ratio: 1 });
});

test("valid session: /portfolio shows the server's account figures and enabled actions", async ({ page }) => {
  await signIn(page);
  await page.goto("/portfolio");
  await expect(page.getByText("Total Value", { exact: true })).toBeVisible();
  await expect(page.getByText(`${FIXTURE_CASH}.00 cash`, { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Quick Trade", exact: true })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeEnabled();
  await expect(page.getByText(EXPIRED)).toHaveCount(0);
  await expect(page.getByText(UNAVAILABLE)).toHaveCount(0);
});
