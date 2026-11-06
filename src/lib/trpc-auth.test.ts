import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { trpc, AuthenticationError, retryUnlessUnauthenticated } from "./trpc";
import { hasStoredSession } from "./auth-token";
import { MemoryStorage } from "@/test-utils/memory-storage";

describe("Authenticated tRPC Client", () => {
  const originalFetch = globalThis.fetch;
  const originalLocalStorage = globalThis.localStorage;

  beforeEach(() => {
    // Mock window and localStorage
    const storage: Record<string, string> = {};
    const localStorageMock = {
      getItem: (key: string) => storage[key] ?? null,
      setItem: (key: string, value: string) => {
        storage[key] = value;
      },
      removeItem: (key: string) => {
        delete storage[key];
      },
      clear: () => {
        for (const k in storage) delete storage[k];
      },
      length: 0,
      key: (i: number) => Object.keys(storage)[i] ?? null,
    };

    globalThis.window = {
      localStorage: localStorageMock,
    } as unknown as Window & typeof globalThis;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  test("sends public procedures without an Authorization header when signed out", async () => {
    window.localStorage.removeItem("supabase.auth.token");

    let requested = false;
    let capturedHeader: string | null | undefined;
    globalThis.fetch = mock(async (_url: string | URL | Request, init?: RequestInit) => {
      requested = true;
      capturedHeader = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
      return new Response(JSON.stringify({ result: { data: { ok: true } } }), { status: 200 });
    }) as unknown as typeof fetch;

    await trpc.screenerDsl.parseAndCompile.mutate({ natural: "pe below 20" });

    expect(requested).toBe(true);
    expect(capturedHeader).toBeNull();
  });

  test("maps a server 401 to AuthenticationError", async () => {
    window.localStorage.removeItem("supabase.auth.token");
    globalThis.fetch = mock(async () =>
      new Response(JSON.stringify({ error: { message: "UNAUTHORIZED" } }), { status: 401 })
    ) as unknown as typeof fetch;

    await expect(trpc.paperTrading.getState.query()).rejects.toThrow(AuthenticationError);
  });

  test("queries are not retried after the server rejects the session", () => {
    expect(retryUnlessUnauthenticated(0, new AuthenticationError())).toBe(false);
    expect(retryUnlessUnauthenticated(0, new Error("tRPC query failed: Bad Gateway"))).toBe(true);
    expect(retryUnlessUnauthenticated(3, new Error("tRPC query failed: Bad Gateway"))).toBe(false);
  });

  test("sends Bearer token header on queries", async () => {
    const session = {
      currentSession: {
        access_token: "test-valid-access-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    };
    window.localStorage.setItem("supabase.auth.token", JSON.stringify(session));

    let capturedHeader: string | null = null;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedHeader = (init?.headers as Record<string, string>)?.Authorization ?? null;
      return new Response(
        JSON.stringify({
          result: {
            data: {
              account: { id: "acc-1", cashBalance: 1000000 },
              positions: [],
              orders: [],
              fills: [],
              asOf: new Date().toISOString(),
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const state = await trpc.paperTrading.getState.query();
    expect(state.account.cashBalance).toBe(1000000);
    expect(capturedHeader).toBe("Bearer test-valid-access-token");
  });

  test("encodes a query input as the tRPC input parameter", async () => {
    const session = {
      currentSession: {
        access_token: "test-options-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    };
    window.localStorage.setItem("supabase.auth.token", JSON.stringify(session));

    let capturedUrl = "";
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      capturedUrl = String(url);
      return new Response(JSON.stringify({ result: { data: [] } }), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }) as unknown as typeof fetch;

    await trpc.options.listExpiries.query({ underlying: "NIFTY" });

    const requestUrl = new URL(capturedUrl, "http://localhost");
    expect(requestUrl.searchParams.get("input")).toBe(JSON.stringify({ underlying: "NIFTY" }));
  });

  test("sends Bearer token and Content-Type on mutations", async () => {
    const session = {
      currentSession: {
        access_token: "test-mutation-token",
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      },
    };
    window.localStorage.setItem("supabase.auth.token", JSON.stringify(session));

    let capturedHeaders: Record<string, string> = {};
    let capturedBody: string | null = null;

    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      capturedHeaders = (init?.headers as Record<string, string>) ?? {};
      capturedBody = (init?.body as string) ?? null;
      return new Response(
        JSON.stringify({
          result: {
            data: {
              order: { id: "ord-123", status: "FILLED" },
            },
          },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    const res = await trpc.paperTrading.placeOrder.mutate({
      type: "MARKET",
      symbol: "RELIANCE",
      exchange: "NSE",
      side: "BUY",
      quantity: 10,
      clientOrderId: "12345678-1234-1234-1234-123456789012",
      idempotencyKey: "idem-key-1",
    });

    expect(res.order.id).toBe("ord-123");
    expect(capturedHeaders["Authorization"]).toBe("Bearer test-mutation-token");
    expect(capturedHeaders["Content-Type"]).toBe("application/json");
    expect(capturedBody).toContain("RELIANCE");
  });
});

describe("a 401 for a session the browser still holds", () => {
  const originalWindow = globalThis.window;
  const originalFetch = globalThis.fetch;
  const originalEnv = { url: process.env.VITE_SUPABASE_URL, key: process.env.VITE_SUPABASE_ANON_KEY };
  const SUPABASE = "https://project.supabase.test";
  let storage: MemoryStorage;

  const okState = () => Response.json({ result: { data: { account: null, positions: [], orders: [], fills: [] } } });
  const unauthorized = () => Response.json({ error: { message: "UNAUTHORIZED" } }, { status: 401 });
  const bearer = (init?: RequestInit) => (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;

  beforeEach(() => {
    storage = new MemoryStorage();
    globalThis.window = Object.assign(new EventTarget(), { localStorage: storage }) as unknown as Window & typeof globalThis;
    process.env.VITE_SUPABASE_URL = SUPABASE;
    process.env.VITE_SUPABASE_ANON_KEY = "anon";
    // Not expired by the clock: only the server knows it was revoked.
    storage.setItem(
      "sb-project-auth-token",
      JSON.stringify({ access_token: "revoked-access", refresh_token: "refresh-1", expires_at: Math.floor(Date.now() / 1000) + 3600 }),
    );
  });

  afterEach(() => {
    globalThis.window = originalWindow;
    globalThis.fetch = originalFetch;
    for (const [name, value] of [["VITE_SUPABASE_URL", originalEnv.url], ["VITE_SUPABASE_ANON_KEY", originalEnv.key]] as const) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
  });

  test("forces a refresh and retries once with the new token", async () => {
    const sent: Array<string | null> = [];
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      if (String(url).startsWith(SUPABASE)) {
        return Response.json({ access_token: "fresh-access", refresh_token: "refresh-2", expires_in: 3600 });
      }
      sent.push(bearer(init));
      return bearer(init) === "Bearer fresh-access" ? okState() : unauthorized();
    }) as unknown as typeof fetch;

    await trpc.paperTrading.getState.query();

    expect(sent).toEqual(["Bearer revoked-access", "Bearer fresh-access"]);
    expect(JSON.parse(storage.getItem("sb-project-auth-token")!).access_token).toBe("fresh-access");
  });

  test("signs out locally when the server still rejects the refreshed token", async () => {
    let apiCalls = 0;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (String(url).startsWith(SUPABASE)) {
        return Response.json({ access_token: "fresh-access", refresh_token: "refresh-2", expires_in: 3600 });
      }
      apiCalls++;
      return unauthorized();
    }) as unknown as typeof fetch;

    await expect(trpc.paperTrading.getState.query()).rejects.toThrow(AuthenticationError);
    expect(apiCalls).toBe(2);
    expect(hasStoredSession()).toBe(false);
  });

  test("signs out locally when Supabase rejects the refresh token", async () => {
    let apiCalls = 0;
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (String(url).startsWith(SUPABASE)) {
        return Response.json({ error: "invalid_grant", error_description: "Refresh Token Not Found" }, { status: 400 });
      }
      apiCalls++;
      return unauthorized();
    }) as unknown as typeof fetch;

    await expect(trpc.paperTrading.getState.query()).rejects.toThrow(AuthenticationError);
    expect(apiCalls).toBe(1);
    expect(hasStoredSession()).toBe(false);
  });

  test("keeps the session when Supabase is unreachable (it may recover)", async () => {
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      if (String(url).startsWith(SUPABASE)) throw new TypeError("Failed to fetch");
      return unauthorized();
    }) as unknown as typeof fetch;

    await expect(trpc.paperTrading.getState.query()).rejects.toThrow(AuthenticationError);
    expect(hasStoredSession()).toBe(true);
  });
});
