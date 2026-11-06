import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { getCurrentAccessToken, hasStoredSession, watchStoredSession } from "./auth-token";
import { MemoryStorage } from "@/test-utils/memory-storage";

describe("hasStoredSession", () => {
  const originalWindow = globalThis.window;
  let storage: MemoryStorage;

  beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.window = { localStorage: storage } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
  });

  test("is false for a logged-out browser", () => {
    expect(hasStoredSession()).toBe(false);
  });

  test("is true for a Supabase session, even one whose access token has expired", () => {
    storage.setItem(
      "sb-project-auth-token",
      JSON.stringify({ access_token: "token", refresh_token: "refresh", expires_at: 1 })
    );
    expect(hasStoredSession()).toBe(true);
  });

  test("ignores unrelated or unreadable storage entries", () => {
    storage.setItem("maet.settings", JSON.stringify({ access_token: "not-a-session" }));
    storage.setItem("supabase.auth.token", "{not json");
    expect(hasStoredSession()).toBe(false);
  });
});

describe("refreshing an expired session", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY };
  let storage: MemoryStorage;

  function storeExpiredSession(refreshToken: string) {
    storage.setItem(
      "sb-project-auth-token",
      JSON.stringify({ access_token: "old-access", refresh_token: refreshToken, expires_at: 1, user: { email: "a@b.test" } }),
    );
  }

  beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.window = Object.assign(new EventTarget(), { localStorage: storage }) as unknown as Window & typeof globalThis;
    process.env.VITE_SUPABASE_URL = "https://project.supabase.test";
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["VITE_SUPABASE_URL", originalEnv.url], ["VITE_SUPABASE_ANON_KEY", originalEnv.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("stores the refreshed tokens in the same flat shape it read", async () => {
    storeExpiredSession("refresh-ok");
    globalThis.fetch = mock(async () =>
      Response.json({ access_token: "new-access", refresh_token: "refresh-2", expires_in: 3600, user: { email: "a@b.test" } }),
    ) as unknown as typeof fetch;

    expect(await getCurrentAccessToken()).toBe("new-access");
    const stored = JSON.parse(storage.getItem("sb-project-auth-token")!);
    expect(stored.access_token).toBe("new-access");
    expect(stored.refresh_token).toBe("refresh-2");
    expect(stored.expires_at).toBeGreaterThan(Date.now() / 1000);
  });

  test("a refresh token Supabase rejects signs the browser out and tells watchers", async () => {
    storeExpiredSession("refresh-revoked");
    globalThis.fetch = mock(async () =>
      Response.json({ error: "invalid_grant", error_description: "Invalid Refresh Token: Refresh Token Not Found" }, { status: 400 }),
    ) as unknown as typeof fetch;
    let notified = 0;
    const unwatch = watchStoredSession(() => notified++);

    expect(await getCurrentAccessToken()).toBeNull();
    unwatch();

    expect(hasStoredSession()).toBe(false);
    expect(storage.getItem("sb-project-auth-token")).toBeNull();
    expect(notified).toBe(1);
  });

  test("a network failure keeps the session but does not retry the refresh on every call", async () => {
    storeExpiredSession("refresh-offline");
    const fetchMock = mock(async () => {
      throw new TypeError("Failed to fetch");
    });
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    expect(await getCurrentAccessToken()).toBeNull();
    expect(await getCurrentAccessToken()).toBeNull();
    expect(await getCurrentAccessToken()).toBeNull();

    expect(hasStoredSession()).toBe(true);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  test("a Supabase outage (5xx) is transient too: the session stays", async () => {
    storeExpiredSession("refresh-5xx");
    globalThis.fetch = mock(async () => new Response("upstream down", { status: 503 })) as unknown as typeof fetch;

    expect(await getCurrentAccessToken()).toBeNull();
    expect(hasStoredSession()).toBe(true);
  });
});
