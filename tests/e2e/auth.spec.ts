import type { Page } from "@playwright/test";
import {
  ACCESS_TOKEN,
  E2E_EMAIL,
  E2E_PASSWORD,
  REFRESH_TOKEN,
  SESSION_STORAGE_KEY,
  SUPABASE_ANON_KEY,
  USER_ID,
} from "./support/data";
import { test, expect, signIn } from "./support/fixtures";

/** The fixture account's cash; it must only ever appear because the server returned it for this session. */
const FIXTURE_CASH = "₹10,00,000.00 cash";

/** Every Supabase session key in this page's localStorage. */
function storedSessions(page: Page) {
  return page.evaluate(() =>
    Object.keys(localStorage).filter((key) => key === "supabase.auth.token" || key.endsWith("-auth-token")),
  );
}

async function submitSignIn(page: Page, email: string, password: string) {
  const form = page.getByRole("region", { name: "Account" });
  await form.getByRole("textbox", { name: "Email" }).fill(email);
  await form.getByLabel("Password").fill(password);
  await form.getByRole("button", { name: "Sign in", exact: true }).click();
}

test("sign-in: a correct password stores the session and returns to the page that asked", async ({ page, api }) => {
  await page.goto("/portfolio");
  await page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page).toHaveURL(/\/login\?redirect=%2Fportfolio$/);

  await submitSignIn(page, E2E_EMAIL, E2E_PASSWORD);

  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByText(FIXTURE_CASH, { exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByRole("button", { name: "Account menu" })).toBeVisible();

  const [grant] = api.authRequests;
  expect(grant?.url.pathname + grant?.url.search).toBe("/auth/v1/token?grant_type=password");
  expect(grant?.headers.apikey).toBe(SUPABASE_ANON_KEY);
  expect(grant?.body).toEqual({ email: E2E_EMAIL, password: E2E_PASSWORD });
  // Stored as supabase-js stores it, so the tRPC and SSE clients use it unchanged.
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SESSION_STORAGE_KEY);
  expect(stored).toMatchObject({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, user: { id: USER_ID, email: E2E_EMAIL } });
  expect(api.trpcCalls("paperTrading.getState").at(-1)?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
});

test("sign-in: a wrong password is reported and nothing is stored", async ({ page, api }) => {
  await page.goto("/login");
  await submitSignIn(page, E2E_EMAIL, "not the password");

  await expect(page.getByRole("alert")).toHaveText("Incorrect email or password.");
  await expect(page).toHaveURL(/\/login$/);
  expect(await storedSessions(page)).toEqual([]);
  expect(api.trpcCalls()).toEqual([]);
  // The form is usable again for a second attempt.
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
});

test("sign-up: a project that confirms emails shows the check-your-email state", async ({ page, api }) => {
  await page.goto("/login");
  await page.getByRole("button", { name: "Create an account", exact: true }).click();
  const form = page.getByRole("region", { name: "Account" });
  await form.getByRole("textbox", { name: "Email" }).fill("new.trader@maet.test");
  await form.getByLabel("Password").fill("a-new-password");
  await form.getByRole("button", { name: "Create account", exact: true }).click();

  await expect(page.getByRole("heading", { name: "Check your email" })).toBeVisible();
  await expect(page.getByRole("status")).toContainText("new.trader@maet.test");
  expect(api.authRequests.map(({ url }) => url.pathname)).toEqual(["/auth/v1/signup"]);
  expect(await storedSessions(page)).toEqual([]);
});

test("sign-out: clears the session, revokes it and drops the account data cached for it", async ({ page, api }) => {
  await signIn(page);
  await page.goto("/portfolio");
  await expect(page.getByText(FIXTURE_CASH, { exact: true })).toBeVisible();

  await page.getByRole("banner").getByRole("button", { name: "Account menu" }).click();
  await expect(page.getByRole("menu")).toContainText(E2E_EMAIL);
  await page.getByRole("menuitem", { name: "Sign out" }).click();

  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  await expect(page.getByText("Portfolio returns and tax estimates require a signed-in account.")).toBeVisible();
  await expect(page.getByText(FIXTURE_CASH, { exact: true })).toHaveCount(0);
  expect(await storedSessions(page)).toEqual([]);
  await expect.poll(() => api.authRequests.map(({ url }) => url.pathname)).toEqual(["/auth/v1/logout"]);
  expect(api.authRequests[0]?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);

  // Signing in again while the backend is down must not resurface the previous session's
  // cached balances: the account is reported unavailable instead.
  api.failProcedure("paperTrading.getState", { code: "INTERNAL_SERVER_ERROR", message: "Database unavailable" });
  await page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }).click();
  await submitSignIn(page, E2E_EMAIL, E2E_PASSWORD);
  await expect(page).toHaveURL(/\/portfolio$/);
  await expect(page.getByRole("status").filter({ hasText: "Paper account unavailable" })).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText(FIXTURE_CASH, { exact: true })).toHaveCount(0);
});

test("session expiry: an expired access token is refreshed through GoTrue before the API call", async ({ page, api }) => {
  await page.addInitScript(
    ([key, refreshToken, userId]) => {
      localStorage.setItem(
        key,
        JSON.stringify({ access_token: "expired-access-token", refresh_token: refreshToken, expires_at: 1_700_000_000, user: { id: userId } }),
      );
    },
    [SESSION_STORAGE_KEY, REFRESH_TOKEN, USER_ID] as const,
  );
  await page.goto("/portfolio");

  await expect(page.getByText(FIXTURE_CASH, { exact: true })).toBeVisible();
  expect(api.authRequests[0]?.url.search).toBe("?grant_type=refresh_token");
  expect(api.authRequests[0]?.body).toEqual({ refresh_token: REFRESH_TOKEN });
  expect(api.trpcCalls().every(({ headers }) => headers.authorization === `Bearer ${ACCESS_TOKEN}`)).toBe(true);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SESSION_STORAGE_KEY);
  expect(stored.access_token).toBe(ACCESS_TOKEN);
  expect(stored.expires_at).toBeGreaterThan(Date.now() / 1000);
});

test("session expiry: a revoked refresh token signs the browser out and says the session expired", async ({ page, api }) => {
  api.validRefreshTokens.clear();
  await page.addInitScript(
    ([key, refreshToken]) => {
      localStorage.setItem(key, JSON.stringify({ access_token: "expired-access-token", refresh_token: refreshToken, expires_at: 1_700_000_000 }));
    },
    [SESSION_STORAGE_KEY, REFRESH_TOKEN] as const,
  );
  await page.goto("/portfolio");

  // The server render is signed out anyway; wait for the browser to try the refresh and drop the session.
  await expect.poll(() => api.authRequests.map(({ url }) => url.pathname + url.search)).toEqual(["/auth/v1/token?grant_type=refresh_token"]);
  await expect.poll(() => storedSessions(page)).toEqual([]);
  await expect(page.getByText("Portfolio returns and tax estimates require a signed-in account.")).toBeVisible();
  await expect(page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true })).toBeVisible();
  // No API call carried the dead token.
  expect(api.trpcCalls().some(({ headers }) => headers.authorization?.includes("expired-access-token"))).toBe(false);

  await page.getByRole("banner").getByRole("link", { name: "Sign in", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Your session expired. Sign in again to continue." })).toBeVisible();
});

test("email link: landing with the session in the fragment signs in and leaves a clean URL", async ({ page, api }) => {
  const fragment = new URLSearchParams({
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    expires_in: "3600",
    token_type: "bearer",
    type: "signup",
  });
  await page.goto(`/#${fragment}`);

  await expect.poll(() => storedSessions(page)).toEqual([SESSION_STORAGE_KEY]);
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  // GoTrue vouched for the token before it was stored.
  expect(api.authRequests.map(({ url }) => url.pathname)).toEqual(["/auth/v1/user"]);
  expect(api.authRequests[0]?.headers.authorization).toBe(`Bearer ${ACCESS_TOKEN}`);
  const stored = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? "null"), SESSION_STORAGE_KEY);
  expect(stored).toMatchObject({ access_token: ACCESS_TOKEN, refresh_token: REFRESH_TOKEN, user: { id: USER_ID, email: E2E_EMAIL } });

  // Signed in for the app: the portfolio loads the account.
  await page.goto("/portfolio");
  await expect(page.getByText(FIXTURE_CASH, { exact: true })).toBeVisible();
  // The history entry the link created no longer carries the tokens.
  await page.goBack();
  await expect(page).toHaveURL(/\/$/);
  expect(await page.evaluate(() => window.location.href)).not.toContain("access_token");
});

test("email link: an expired link lands on /login with the reason and no tokens in the URL", async ({ page, api }) => {
  await page.goto("/#error=access_denied&error_code=otp_expired&error_description=Email+link+is+invalid+or+has+expired");

  await expect(page).toHaveURL(/\/login\?authError=/);
  await expect(page.getByRole("alert")).toHaveText(
    "This email link is invalid or has expired. Sign in, or sign up again to get a new link.",
  );
  expect(await page.evaluate(() => window.location.hash)).toBe("");
  expect(api.authRequests).toEqual([]);
  expect(await storedSessions(page)).toEqual([]);
});

test("email link: a token GoTrue does not recognise is not stored", async ({ page, api }) => {
  await page.goto("/#access_token=forged-token&refresh_token=forged-refresh&expires_in=3600&type=signup");

  await expect(page).toHaveURL(/\/login\?authError=/);
  await expect(page.getByRole("alert")).toHaveText("This sign-in link is no longer valid. Sign in with your email and password.");
  expect(api.authRequests.map(({ url }) => url.pathname)).toEqual(["/auth/v1/user"]);
  expect(await storedSessions(page)).toEqual([]);
  expect(await page.evaluate(() => window.location.href)).not.toContain("forged");
});
