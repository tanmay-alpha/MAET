import { test as base, expect, type Page } from "@playwright/test";
import { ACCESS_TOKEN, USER_ID } from "./data";
import { MockApi } from "./mock-api";

/** Every test gets a page whose backend traffic is answered by MockApi. */
export const test = base.extend<{ api: MockApi }>({
  api: async ({ page }, provide) => {
    const api = new MockApi(page);
    await api.install();
    await provide(api);
  },
});

export { expect };

/**
 * Seeds the Supabase session supabase-js would persist ("sb-<project>-auth-token"),
 * before any app script runs. It never expires, so no refresh request is attempted.
 */
export async function signIn(page: Page): Promise<void> {
  const session = {
    access_token: ACCESS_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    expires_at: 4_102_444_800,
    refresh_token: "e2e-refresh-token",
    user: { id: USER_ID, email: "e2e@maet.test", aud: "authenticated" },
  };
  await page.addInitScript((value) => {
    window.localStorage.setItem("sb-e2e-auth-token", value);
  }, JSON.stringify(session));
}
