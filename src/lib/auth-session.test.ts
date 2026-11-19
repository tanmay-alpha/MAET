import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import {
  SIGN_IN_NOT_CONFIGURED_MESSAGE,
  clearQueriesOnSessionChange,
  goTrueErrorMessage,
  safeRedirectPath,
  signInWithPassword,
  signOut,
  signUpWithPassword,
} from "./auth-session";
import { hasStoredSession, storeSession, storedSessionEmail } from "./auth-token";
import { MemoryStorage } from "@/test-utils/memory-storage";

// The code reads import.meta.env (Vite inlines it); in Bun it starts as process.env, but other
// test files may replace process.env, so tests set the object the code actually reads.
const testEnv = import.meta.env as Record<string, string | undefined>;

const SUPABASE_URL = "https://abcd1234.supabase.co";
const ANON_KEY = "anon-key";
const SESSION_KEY = "sb-abcd1234-auth-token";

interface Call {
  url: string;
  init: RequestInit | undefined;
}

describe("Supabase email + password auth", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: testEnv.VITE_SUPABASE_URL, key: testEnv.VITE_SUPABASE_ANON_KEY };
  let storage: MemoryStorage;
  let calls: Call[];
  let respond: (url: string) => Response | Promise<Response>;

  beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.window = {
      localStorage: storage,
      sessionStorage: new MemoryStorage(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Window & typeof globalThis;
    testEnv.VITE_SUPABASE_URL = `${SUPABASE_URL}/`;
    testEnv.VITE_SUPABASE_ANON_KEY = ANON_KEY;
    calls = [];
    respond = () => new Response(null, { status: 500 });
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return respond(String(url));
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

  const json = (status: number, body: unknown) =>
    new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
  const goTrueSession = (email = "trader@example.com") => ({
    access_token: "access-1",
    refresh_token: "refresh-1",
    token_type: "bearer",
    expires_in: 3600,
    user: { id: "user-1", email },
  });

  test("a correct password stores the session where supabase-js keeps it, replacing any other", async () => {
    storage.setItem("supabase.auth.token", JSON.stringify({ currentSession: { access_token: "someone-else" } }));
    respond = () => json(200, goTrueSession());

    expect(await signInWithPassword("  trader@example.com ", "hunter22")).toEqual({ ok: true });

    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/token?grant_type=password`);
    expect(calls[0]!.init?.method).toBe("POST");
    expect((calls[0]!.init?.headers as Record<string, string>).apikey).toBe(ANON_KEY);
    expect(JSON.parse(String(calls[0]!.init?.body))).toEqual({ email: "trader@example.com", password: "hunter22" });

    // The legacy key is read first, so leaving it would sign the user in as someone else.
    expect(storage.getItem("supabase.auth.token")).toBeNull();
    const stored = JSON.parse(storage.getItem(SESSION_KEY)!);
    expect(stored.access_token).toBe("access-1");
    expect(stored.refresh_token).toBe("refresh-1");
    // expires_at is derived from expires_in when GoTrue omits it, so the token gets refreshed in time.
    expect(stored.expires_at).toBeGreaterThan(Date.now() / 1000 + 3500);
    expect(stored.expires_at).toBeLessThanOrEqual(Date.now() / 1000 + 3600);
    expect(hasStoredSession()).toBe(true);
    expect(storedSessionEmail()).toBe("trader@example.com");
  });

  test("a wrong password says so and stores nothing", async () => {
    respond = () => json(400, { code: 400, error_code: "invalid_credentials", msg: "Invalid login credentials" });
    expect(await signInWithPassword("trader@example.com", "wrong")).toEqual({
      ok: false,
      message: "Incorrect email or password.",
    });
    expect(storage.length).toBe(0);
    expect(hasStoredSession()).toBe(false);
  });

  test("a 200 without tokens is not treated as a session", async () => {
    respond = () => json(200, { user: { id: "x" } });
    const result = await signInWithPassword("trader@example.com", "pw");
    expect(result.ok).toBe(false);
    expect(storage.length).toBe(0);
  });

  test("an unreachable sign-in service is reported, not thrown", async () => {
    respond = () => {
      throw new TypeError("Failed to fetch");
    };
    expect(await signInWithPassword("trader@example.com", "pw")).toEqual({
      ok: false,
      message: "Could not reach the sign-in service. Check your connection and try again.",
    });
  });

  test("without a configured project nothing is sent and the form says sign-in is not configured", async () => {
    delete testEnv.VITE_SUPABASE_URL;
    expect(await signInWithPassword("trader@example.com", "pw")).toEqual({ ok: false, message: SIGN_IN_NOT_CONFIGURED_MESSAGE });
    expect(await signUpWithPassword("trader@example.com", "pw")).toEqual({ status: "error", message: SIGN_IN_NOT_CONFIGURED_MESSAGE });
    expect(calls).toHaveLength(0);
  });

  test("sign-up on a project that confirms emails waits for the link and stores nothing", async () => {
    respond = () => json(200, { id: "user-2", email: "new@example.com", confirmation_sent_at: "2026-11-10T00:00:00Z" });
    expect(await signUpWithPassword(" new@example.com", "secret1")).toEqual({
      status: "confirmation-required",
      email: "new@example.com",
    });
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/signup`);
    expect(hasStoredSession()).toBe(false);
  });

  test("sign-up on an auto-confirming project signs the user in", async () => {
    respond = () => json(200, goTrueSession("new@example.com"));
    expect(await signUpWithPassword("new@example.com", "secret1")).toEqual({ status: "signed-in" });
    expect(storedSessionEmail()).toBe("new@example.com");
  });

  test("sign-up for an existing email says to sign in instead", async () => {
    respond = () => json(422, { code: 422, error_code: "user_already_exists", msg: "User already registered" });
    expect(await signUpWithPassword("trader@example.com", "secret1")).toEqual({
      status: "error",
      message: "An account with this email already exists. Sign in instead.",
    });
  });

  test("sign-out forgets every stored session at once and revokes the old one with its token", async () => {
    storeSession({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 });
    storage.setItem("sb-other-auth-token", JSON.stringify({ access_token: "stale" }));
    let storedWhileRevoking: string | null = "unset";
    respond = () => {
      storedWhileRevoking = storage.getItem(SESSION_KEY);
      return new Response(null, { status: 204 });
    };

    await signOut();

    expect(hasStoredSession()).toBe(false);
    expect(storage.length).toBe(0);
    expect(storedWhileRevoking).toBeNull();
    expect(calls[0]!.url).toBe(`${SUPABASE_URL}/auth/v1/logout?scope=local`);
    expect((calls[0]!.init?.headers as Record<string, string>).authorization).toBe("Bearer access-1");
  });

  test("sign-out works offline", async () => {
    storeSession({ access_token: "access-1", refresh_token: "refresh-1" });
    respond = () => {
      throw new TypeError("Failed to fetch");
    };
    await signOut();
    expect(hasStoredSession()).toBe(false);
  });
});

describe("goTrueErrorMessage", () => {
  test("maps current and legacy GoTrue error shapes to what the user should do", () => {
    expect(goTrueErrorMessage(400, { error: "invalid_grant", error_description: "Invalid login credentials" })).toBe(
      "Incorrect email or password.",
    );
    expect(goTrueErrorMessage(400, { error_code: "email_not_confirmed", msg: "Email not confirmed" })).toBe(
      "Confirm your email address first: open the link in the email we sent you.",
    );
    expect(goTrueErrorMessage(429, { error_code: "over_email_send_rate_limit", msg: "email rate limit exceeded" })).toBe(
      "Too many attempts. Wait a minute and try again.",
    );
    expect(goTrueErrorMessage(429, null)).toBe("Too many attempts. Wait a minute and try again.");
    expect(goTrueErrorMessage(503, "<html>")).toBe("The sign-in service is unavailable (HTTP 503). Try again later.");
    expect(goTrueErrorMessage(422, { error_code: "weak_password", msg: "Password should be at least 6 characters." })).toBe(
      "Password should be at least 6 characters.",
    );
    expect(goTrueErrorMessage(418, {})).toBe("Sign-in failed (HTTP 418).");
  });
});

describe("safeRedirectPath", () => {
  test("keeps same-origin paths with their query and hash", () => {
    expect(safeRedirectPath("/orders")).toBe("/orders");
    expect(safeRedirectPath("/chart/RELIANCE?tf=5m#x")).toBe("/chart/RELIANCE?tf=5m#x");
  });

  test("falls back for anything that could leave the app or loop back to /login", () => {
    for (const value of [
      undefined,
      42,
      "",
      "orders",
      "https://evil.example/",
      "//evil.example",
      "/\\evil.example",
      "/\t/evil.example",
      "javascript:alert(1)",
      "/login",
      "/login?redirect=/orders",
    ]) {
      expect(safeRedirectPath(value)).toBe("/dashboard");
    }
  });

  test("whatever the input, the result resolves on the app's own origin", () => {
    // mulberry32 over an alphabet rich in URL syntax and control characters.
    let state = 1110;
    const random = () => {
      state = (state + 0x6d2b79f5) >>> 0;
      let t = state;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const alphabet = ["/", "\\", ":", ".", "@", "?", "#", "%", "a", "e", "v", "l", "\t", "\n", "\r", "\u0000", " ", "http", "//"];
    const origin = "https://maet.example";
    for (let run = 0; run < 5_000; run++) {
      const length = Math.floor(random() * 10);
      const candidate = Array.from({ length }, () => alphabet[Math.floor(random() * alphabet.length)]).join("");
      const result = safeRedirectPath(candidate);
      expect(new URL(result, origin).origin).toBe(origin);
      expect(result === "/dashboard" || result === candidate).toBe(true);
    }
  });
});

describe("clearQueriesOnSessionChange", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: testEnv.VITE_SUPABASE_URL, key: testEnv.VITE_SUPABASE_ANON_KEY };

  beforeEach(() => {
    globalThis.window = {
      localStorage: new MemoryStorage(),
      sessionStorage: new MemoryStorage(),
      addEventListener: () => {},
      removeEventListener: () => {},
    } as unknown as Window & typeof globalThis;
    testEnv.VITE_SUPABASE_URL = SUPABASE_URL;
    testEnv.VITE_SUPABASE_ANON_KEY = ANON_KEY;
    globalThis.fetch = mock(async () => new Response(null, { status: 204 })) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    testEnv.VITE_SUPABASE_URL = originalEnv.url;
    testEnv.VITE_SUPABASE_ANON_KEY = originalEnv.key;
    if (originalEnv.url === undefined) delete testEnv.VITE_SUPABASE_URL;
    if (originalEnv.key === undefined) delete testEnv.VITE_SUPABASE_ANON_KEY;
  });

  test("clears cached queries when the user changes, never on a token refresh of the same user", async () => {
    storeSession({ access_token: "a1", refresh_token: "r1", user: { id: "alice" } });
    let clears = 0;
    const stop = clearQueriesOnSessionChange({ clear: () => void clears++ });

    storeSession({ access_token: "a2", refresh_token: "r2", user: { id: "alice" } });
    expect(clears).toBe(0);

    await signOut();
    expect(clears).toBe(1);

    storeSession({ access_token: "b1", refresh_token: "r3", user: { id: "bob" } });
    expect(clears).toBe(2);

    storeSession({ access_token: "c1", refresh_token: "r4", user: { id: "carol" } });
    expect(clears).toBe(3);

    stop();
    await signOut();
    expect(clears).toBe(3);
  });
});
