import { describe, it, expect, afterEach } from "bun:test";
import { generateTotp, getAngelOneMarketQuotes, login, setAngelOneMarketSession } from "./client";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  setAngelOneMarketSession(undefined);
});

describe("angelone login", () => {
  it("generates the RFC 6238 SHA-1 TOTP vector", () => {
    expect(generateTotp("GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ", 59_000)).toBe("287082");
  });

  it("sends TOTP in the request body and parses session", async () => {
    let captured: any = null;
    globalThis.fetch = (async (url, init) => {
      captured = { url: String(url), body: init?.body, headers: init?.headers };
      return new Response(
        JSON.stringify({
          status: true,
          data: {
            jwtToken: "JWT",
            feedToken: "FEED",
            refreshToken: "REFRESH",
          },
        }),
        { status: 200 }
      );
    }) as unknown as typeof fetch;
    const s = await login({ apiKey: "K", clientCode: "C", password: "P", totpSecret: "JBSWY3DPEHPK3PXP" });
    expect(s.jwt).toBe("JWT");
    expect(s.feedToken).toBe("FEED");
    expect(s.refreshToken).toBe("REFRESH");
    const body = JSON.parse(captured.body);
    expect(body.totp).toMatch(/^\d{6}$/);
    expect(body.clientcode).toBe("C");
  });

  it("loads an authenticated market snapshot for requested tokens", async () => {
    setAngelOneMarketSession({ jwt: "JWT", feedToken: "FEED", refreshToken: "REFRESH", clientCode: "C", apiKey: "K", obtainedAt: new Date().toISOString() });
    globalThis.fetch = (async (_url, init) => {
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer JWT");
      return Response.json({
        status: true,
        data: { fetched: [{ symbolToken: "2885", ltp: 1_410.5, tradeVolume: 12_345, close: 1_400, netChange: 10.5, percentChange: 0.75 }] },
      });
    }) as unknown as typeof fetch;
    expect(await getAngelOneMarketQuotes([{ symbol: "RELIANCE", token: "2885" }])).toEqual([{
      symbol: "RELIANCE",
      price: 1_410.5,
      volume: 12_345,
      previousClose: 1_400,
      change: 10.5,
      changePct: 0.75,
    }]);
  });
});
