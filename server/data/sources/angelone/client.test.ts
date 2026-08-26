import { describe, it, expect, afterEach } from "bun:test";
import { generateTotp, getAngelOneMarketQuotes, getAngelOneOptionGreeks, login, parseAngelOneExchangeTime, setAngelOneMarketSession } from "./client";

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
        data: { fetched: [{ symbolToken: "2885", ltp: 1_410.5, tradeVolume: 12_345, close: 1_400, exchFeedTime: "21-Jun-2023 10:46:10", netChange: 10.5, percentChange: 0.75 }] },
      });
    }) as unknown as typeof fetch;
    expect(await getAngelOneMarketQuotes([{ symbol: "RELIANCE", token: "2885" }])).toEqual([{
      symbol: "RELIANCE",
      price: 1_410.5,
      volume: 12_345,
      ts: "2023-06-21T05:16:10.000Z",
      previousClose: 1_400,
      change: 10.5,
      changePct: 0.75,
    }]);
  });

  it("rejects snapshots without a valid exchange feed time", async () => {
    setAngelOneMarketSession({ jwt: "JWT", feedToken: "FEED", refreshToken: "REFRESH", clientCode: "C", apiKey: "K", obtainedAt: new Date().toISOString() });
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: { fetched: [{ symbolToken: "2885", ltp: 1_410.5, tradeVolume: 12_345 }] },
    })) as unknown as typeof fetch;

    expect(await getAngelOneMarketQuotes([{ symbol: "RELIANCE", token: "2885" }])).toEqual([]);
    expect(parseAngelOneExchangeTime("31-Feb-2026 10:00:00")).toBeUndefined();
  });
});

describe("angelone option greeks", () => {
  it("sends an authenticated underlying and expiry request and parses provider values", async () => {
    setAngelOneMarketSession({ jwt: "JWT", feedToken: "FEED", refreshToken: "REFRESH", clientCode: "C", apiKey: "K", obtainedAt: new Date().toISOString() });
    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("https://apiconnect.angelone.in/rest/secure/angelbroking/marketData/v1/optionGreek");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer JWT");
      expect(JSON.parse(init?.body as string)).toEqual({ name: "NIFTY", expirydate: "28AUG2026" });
      return Response.json({
        status: true,
        data: [{
          name: "NIFTY",
          expiry: "28AUG2026",
          strikePrice: "24500.0000",
          optionType: "CE",
          delta: "0.5123",
          gamma: "0.0012",
          theta: "-12.4000",
          vega: "8.7000",
          impliedVolatility: "14.2300",
          tradeVolume: "12345",
        }],
      });
    }) as unknown as typeof fetch;

    expect(await getAngelOneOptionGreeks({ name: "NIFTY", expirydate: "28AUG2026" })).toEqual([{
      name: "NIFTY",
      expiry: "28AUG2026",
      strikePrice: 24500,
      optionType: "CE",
      delta: 0.5123,
      gamma: 0.0012,
      theta: -12.4,
      vega: 8.7,
      impliedVolatility: 14.23,
      tradeVolume: 12345,
    }]);
  });

  it("preserves unavailable metrics without fabricating option fields", async () => {
    setAngelOneMarketSession({ jwt: "JWT", feedToken: "FEED", refreshToken: "REFRESH", clientCode: "C", apiKey: "K", obtainedAt: new Date().toISOString() });
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: [{
        name: "NIFTY",
        expiry: "28AUG2026",
        strikePrice: "24500",
        optionType: "PE",
        delta: "not-a-number",
        gamma: null,
        theta: "",
        vega: "NaN",
        impliedVolatility: undefined,
        tradeVolume: "invalid",
      }],
    })) as unknown as typeof fetch;

    const [greek] = await getAngelOneOptionGreeks({ name: "NIFTY", expirydate: "28AUG2026" });
    expect(greek).toMatchObject({ name: "NIFTY", expiry: "28AUG2026", strikePrice: 24500, optionType: "PE" });
    expect(greek.delta).toBeUndefined();
    expect(greek.gamma).toBeUndefined();
    expect(greek.theta).toBeUndefined();
    expect(greek.vega).toBeUndefined();
    expect(greek.impliedVolatility).toBeUndefined();
    expect(greek.tradeVolume).toBeUndefined();
    expect(greek).not.toHaveProperty("rho");
    expect(greek).not.toHaveProperty("ts");
    expect(greek).not.toHaveProperty("timestamp");
  });

  it("returns no provider data without an active session", async () => {
    let called = false;
    globalThis.fetch = (async () => {
      called = true;
      return Response.json({ status: true, data: [] });
    }) as unknown as typeof fetch;

    expect(await getAngelOneOptionGreeks({ name: "NIFTY", expirydate: "28AUG2026" })).toEqual([]);
    expect(called).toBe(false);
  });

  it("returns no provider data for Angel One's no-data response", async () => {
    setAngelOneMarketSession({ jwt: "JWT", feedToken: "FEED", refreshToken: "REFRESH", clientCode: "C", apiKey: "K", obtainedAt: new Date().toISOString() });
    globalThis.fetch = (async () => Response.json({ status: false, message: "No Data Available" })) as unknown as typeof fetch;

    expect(await getAngelOneOptionGreeks({ name: "NIFTY", expirydate: "28AUG2026" })).toEqual([]);
  });

  it("keeps HTTP and unsuccessful provider responses explicit", async () => {
    setAngelOneMarketSession({ jwt: "JWT", feedToken: "FEED", refreshToken: "REFRESH", clientCode: "C", apiKey: "K", obtainedAt: new Date().toISOString() });
    globalThis.fetch = (async () => new Response("upstream unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(getAngelOneOptionGreeks({ name: "NIFTY", expirydate: "28AUG2026" })).rejects.toThrow("angelone option greek failed: 503");

    globalThis.fetch = (async () => Response.json({ status: false, message: "Invalid request" })) as unknown as typeof fetch;
    await expect(getAngelOneOptionGreeks({ name: "NIFTY", expirydate: "28AUG2026" })).rejects.toThrow("angelone option greek returned an unsuccessful response");
  });
});
