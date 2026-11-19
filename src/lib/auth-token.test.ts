import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  getCurrentAccessToken,
  hasStoredSession,
  sessionEndedByExpiry,
  storedSessionIdentity,
  supabaseAuthConfig,
  watchStoredSession,
} from "./auth-token";
import { MemoryStorage } from "@/test-utils/memory-storage";

// The code reads import.meta.env (Vite inlines it); in Bun it starts as process.env, but other
// test files may replace process.env, so tests set the object the code actually reads.
const testEnv = import.meta.env as Record<string, string | undefined>;

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

describe("supabaseAuthConfig", () => {
  const originalEnv = { url: testEnv.VITE_SUPABASE_URL, key: testEnv.VITE_SUPABASE_ANON_KEY };
  afterEach(() => {
    testEnv.VITE_SUPABASE_URL = originalEnv.url;
    testEnv.VITE_SUPABASE_ANON_KEY = originalEnv.key;
    if (originalEnv.url === undefined) delete testEnv.VITE_SUPABASE_URL;
    if (originalEnv.key === undefined) delete testEnv.VITE_SUPABASE_ANON_KEY;
  });

  test("is null unless both the project URL and the anon key are set: there is no fallback project", () => {
    delete testEnv.VITE_SUPABASE_URL;
    delete testEnv.VITE_SUPABASE_ANON_KEY;
    expect(supabaseAuthConfig()).toBeNull();
    testEnv.VITE_SUPABASE_URL = "https://ref.supabase.co";
    expect(supabaseAuthConfig()).toBeNull();
    testEnv.VITE_SUPABASE_ANON_KEY = "  ";
    expect(supabaseAuthConfig()).toBeNull();
    testEnv.VITE_SUPABASE_ANON_KEY = "anon";
    expect(supabaseAuthConfig()).toEqual({ url: "https://ref.supabase.co", anonKey: "anon" });
  });
});

describe("getCurrentAccessToken", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: testEnv.VITE_SUPABASE_URL, key: testEnv.VITE_SUPABASE_ANON_KEY };
  const KEY = "sb-ref-auth-token";
  const nowSec = () => Math.floor(Date.now() / 1000);
  let storage: MemoryStorage;
  let refreshCalls: Array<{ url: string; body: unknown }>;
  let respond: () => Response;

  beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.window = {
      localStorage: storage,
      sessionStorage: new MemoryStorage(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Window & typeof globalThis;
    testEnv.VITE_SUPABASE_URL = "https://ref.supabase.co";
    testEnv.VITE_SUPABASE_ANON_KEY = "anon";
    refreshCalls = [];
    respond = () => new Response(null, { status: 500 });
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      refreshCalls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return respond();
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    testEnv.VITE_SUPABASE_URL = originalEnv.url;
    testEnv.VITE_SUPABASE_ANON_KEY = originalEnv.key;
    if (originalEnv.url === undefined) delete testEnv.VITE_SUPABASE_URL;
    if (originalEnv.key === undefined) delete testEnv.VITE_SUPABASE_ANON_KEY;
  });

  const storeV2 = (expiresAt: number) =>
    storage.setItem(
      KEY,
      JSON.stringify({ access_token: "old", refresh_token: "r1", expires_at: expiresAt, user: { id: "user-1", email: "a@b.c" } }),
    );

  test("returns a v2 session's token as is until it expires", async () => {
    storeV2(nowSec() + 600);
    expect(await getCurrentAccessToken()).toBe("old");
    expect(refreshCalls).toHaveLength(0);
  });

  test("refreshes a v2 session whose top-level expires_at has passed, keeping its shape and user", async () => {
    storeV2(nowSec() - 5);
    respond = () => new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    let notified = 0;
    const stop = watchStoredSession(() => notified++);

    expect(await getCurrentAccessToken()).toBe("new");
    stop();

    expect(refreshCalls).toEqual([{ url: "https://ref.supabase.co/auth/v1/token?grant_type=refresh_token", body: { refresh_token: "r1" } }]);
    const stored = JSON.parse(storage.getItem(KEY)!);
    expect(stored).toMatchObject({ access_token: "new", refresh_token: "r2", user: { id: "user-1", email: "a@b.c" } });
    expect(stored.currentSession).toBeUndefined();
    expect(stored.expires_at).toBeGreaterThan(nowSec() + 3500);
    expect(notified).toBe(1);
    expect(storedSessionIdentity()).toBe("user-1");
  });

  test("concurrent callers share one refresh request", async () => {
    storeV2(nowSec() - 5);
    respond = () => new Response(JSON.stringify({ access_token: "new", refresh_token: "r2", expires_in: 3600 }), { status: 200 });
    expect(await Promise.all([getCurrentAccessToken(), getCurrentAccessToken(), getCurrentAccessToken()])).toEqual(["new", "new", "new"]);
    expect(refreshCalls).toHaveLength(1);
  });

  test("a refresh token GoTrue rejects ends the session and records why", async () => {
    storeV2(nowSec() - 5);
    respond = () =>
      new Response(JSON.stringify({ code: 400, error_code: "refresh_token_not_found", msg: "Invalid Refresh Token" }), { status: 400 });
    let notified = 0;
    const stop = watchStoredSession(() => notified++);

    expect(await getCurrentAccessToken()).toBeNull();
    stop();

    expect(hasStoredSession()).toBe(false);
    expect(sessionEndedByExpiry()).toBe(true);
    expect(notified).toBe(1);
  });

  test("an unreachable or failing GoTrue keeps the session for a later attempt", async () => {
    storeV2(nowSec() - 5);
    respond = () => new Response("bad gateway", { status: 502 });
    expect(await getCurrentAccessToken()).toBeNull();
    expect(hasStoredSession()).toBe(true);
    expect(sessionEndedByExpiry()).toBe(false);
  });

  test("refreshes a legacy { currentSession } session in its own shape", async () => {
    storage.setItem(
      "supabase.auth.token",
      JSON.stringify({ currentSession: { access_token: "old", refresh_token: "r1", expires_at: nowSec() - 5 }, expiresAt: nowSec() - 5 }),
    );
    respond = () => new Response(JSON.stringify({ access_token: "new", expires_at: nowSec() + 3600 }), { status: 200 });
    expect(await getCurrentAccessToken()).toBe("new");
    const stored = JSON.parse(storage.getItem("supabase.auth.token")!);
    expect(stored.currentSession).toMatchObject({ access_token: "new", refresh_token: "r1" });
    expect(stored.access_token).toBeUndefined();
  });
});
