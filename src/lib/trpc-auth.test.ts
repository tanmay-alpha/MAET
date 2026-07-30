import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { trpc, AuthenticationError } from "./trpc";

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

  test("rejects locally with AuthenticationError when signed out", async () => {
    window.localStorage.removeItem("supabase.auth.token");

    await expect(trpc.paperTrading.getState.query()).rejects.toThrow(AuthenticationError);
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
