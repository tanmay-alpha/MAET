import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { trpc, AuthenticationError, retryUnlessUnauthenticated } from "./trpc";

describe("Authenticated tRPC Client", () => {
  const originalFetch = globalThis.fetch;
  const originalWindow = globalThis.window;

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
    globalThis.window = originalWindow;
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
