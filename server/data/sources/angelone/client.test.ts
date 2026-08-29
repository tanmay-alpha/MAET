import { describe, it, expect, afterEach } from "bun:test";
import {
  generateTotp,
  getAngelOneFullMarketQuotes,
  getAngelOneMarketQuotes,
  getAngelOneOptionGreeks,
  login,
  parseAngelOneExchangeTime,
  resolveAngelOneOptionContracts,
  setAngelOneMarketSession,
} from "./client";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  setAngelOneMarketSession(undefined);
});

function activateMarketSession(): void {
  setAngelOneMarketSession({
    jwt: "JWT",
    feedToken: "FEED",
    refreshToken: "REFRESH",
    clientCode: "C",
    apiKey: "K",
    obtainedAt: "2026-08-29T00:00:00.000Z",
  });
}

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

describe("angelone full market quotes", () => {
  it("normalizes a provider-backed NFO FULL quote", async () => {
    activateMarketSession();
    globalThis.fetch = (async (url, init) => {
      expect(String(url)).toBe("https://apiconnect.angelone.in/rest/secure/angelbroking/market/v1/quote/");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer JWT");
      return Response.json({
        status: true,
        data: {
          fetched: [{
            exchange: "NFO",
            tradingSymbol: "NIFTY28AUG2624500CE",
            symbolToken: "58662",
            ltp: 112.5,
            open: 108.25,
            high: 119.75,
            low: 104.5,
            close: 106.8,
            lastTradeQty: 75,
            exchFeedTime: "21-Jun-2023 10:46:10",
            exchTradeTime: "21-Jun-2023 10:46:08",
            netChange: -5.7,
            percentChange: -5.34,
            avgPrice: 111.2,
            tradeVolume: 123_450,
            opnInterest: 987_600,
            lowerCircuit: 1,
            upperCircuit: 500,
            totBuyQuan: 22_500,
            totSellQuan: 18_750,
            "52WeekLow": 2.5,
            "52WeekHigh": 415,
            depth: {
              buy: [
                { price: 112.4, quantity: 750, orders: 4 },
                { price: 112.3, quantity: 1_500, orders: 8 },
              ],
              sell: [
                { price: 112.6, quantity: 525, orders: 3 },
                { price: 112.7, quantity: 975, orders: 5 },
              ],
            },
          }],
        },
      });
    }) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).toEqual([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
      ltp: 112.5,
      open: 108.25,
      high: 119.75,
      low: 104.5,
      close: 106.8,
      volume: 123_450,
      openInterest: 987_600,
      netChange: -5.7,
      percentChange: -5.34,
      averagePrice: 111.2,
      totalBuyQuantity: 22_500,
      totalSellQuantity: 18_750,
      bestBidPrice: 112.4,
      bestBidQuantity: 750,
      bestAskPrice: 112.6,
      bestAskQuantity: 525,
      exchangeFeedAt: "2023-06-21T05:16:10.000Z",
      exchangeTradeAt: "2023-06-21T05:16:08.000Z",
    }]);
  });

  it("groups trimmed NSE and NFO identities in one provider request", async () => {
    activateMarketSession();
    let providerBody: unknown;
    globalThis.fetch = (async (_url, init) => {
      providerBody = JSON.parse(init?.body as string);
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([
      { exchange: "NSE", token: " 2885 ", tradingSymbol: " RELIANCE " },
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500CE" },
      { exchange: "NFO", token: "58663", tradingSymbol: "NIFTY28AUG2624500PE" },
    ])).toEqual([]);
    expect(providerBody).toEqual({
      mode: "FULL",
      exchangeTokens: {
        NSE: ["2885"],
        NFO: ["58662", "58663"],
      },
    });
  });

  it("leaves missing and malformed optional market fields unavailable", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: {
        fetched: [{
          exchange: "NFO",
          tradingSymbol: "NIFTY28AUG2624500CE",
          symbolToken: "58662",
          ltp: -1,
          open: "invalid",
          high: Number.POSITIVE_INFINITY,
          low: -0.01,
          tradeVolume: 12.5,
          opnInterest: -1,
          openInterest: 99_999,
          netChange: "invalid",
          percentChange: Number.NEGATIVE_INFINITY,
          avgPrice: -1,
          totBuyQuan: Number.MAX_SAFE_INTEGER + 1,
          totSellQuan: "invalid",
          depth: {
            buy: [{ price: -1, quantity: 1.5, orders: 1 }],
            sell: [],
          },
          exchFeedTime: "21-Jun-2023 10:46:10",
        }],
      },
    })) as unknown as typeof fetch;

    const [quote] = await getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }]);
    expect(quote.ltp).toBeUndefined();
    expect(quote.open).toBeUndefined();
    expect(quote.high).toBeUndefined();
    expect(quote.low).toBeUndefined();
    expect(quote.close).toBeUndefined();
    expect(quote.volume).toBeUndefined();
    expect(quote.openInterest).toBeUndefined();
    expect(quote.netChange).toBeUndefined();
    expect(quote.percentChange).toBeUndefined();
    expect(quote.averagePrice).toBeUndefined();
    expect(quote.totalBuyQuantity).toBeUndefined();
    expect(quote.totalSellQuantity).toBeUndefined();
    expect(quote.bestBidPrice).toBeUndefined();
    expect(quote.bestBidQuantity).toBeUndefined();
    expect(quote.bestAskPrice).toBeUndefined();
    expect(quote.bestAskQuantity).toBeUndefined();
  });

  it("preserves legitimate zero market values", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: {
        fetched: [{
          exchange: "NFO",
          tradingSymbol: "NIFTY28AUG2624500PE",
          symbolToken: "58663",
          ltp: 0,
          open: 0,
          high: 0,
          low: 0,
          close: 0,
          tradeVolume: 0,
          opnInterest: 0,
          netChange: 0,
          percentChange: 0,
          avgPrice: 0,
          totBuyQuan: 0,
          totSellQuan: 0,
          depth: {
            buy: [{ price: 0, quantity: 0, orders: 0 }],
            sell: [{ price: 0, quantity: 0, orders: 0 }],
          },
          exchFeedTime: "21-Jun-2023 10:46:10",
        }],
      },
    })) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58663",
      tradingSymbol: "NIFTY28AUG2624500PE",
    }])).toEqual([{
      exchange: "NFO",
      token: "58663",
      tradingSymbol: "NIFTY28AUG2624500PE",
      ltp: 0,
      open: 0,
      high: 0,
      low: 0,
      close: 0,
      volume: 0,
      openInterest: 0,
      netChange: 0,
      percentChange: 0,
      averagePrice: 0,
      totalBuyQuantity: 0,
      totalSellQuantity: 0,
      bestBidPrice: 0,
      bestBidQuantity: 0,
      bestAskPrice: 0,
      bestAskQuantity: 0,
      exchangeFeedAt: "2023-06-21T05:16:10.000Z",
      exchangeTradeAt: undefined,
    }]);
  });

  it("skips rows without a valid exchange feed timestamp", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: {
        fetched: [{
          exchange: "NFO",
          tradingSymbol: "NIFTY28AUG2624500CE",
          symbolToken: "58662",
          opnInterest: 987_600,
          exchFeedTime: "31-Feb-2026 10:00:00",
          exchTradeTime: "21-Jun-2023 10:46:08",
        }],
      },
    })) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).toEqual([]);
  });

  it("keeps a valid feed row when the exchange trade timestamp is unavailable", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: {
        fetched: [{
          exchange: "NFO",
          tradingSymbol: "NIFTY28AUG2624500CE",
          symbolToken: "58662",
          opnInterest: 987_600,
          exchFeedTime: "21-Jun-2023 10:46:10",
          exchTradeTime: "not-a-provider-time",
        }],
      },
    })) as unknown as typeof fetch;

    const [quote] = await getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }]);
    expect(quote.exchangeFeedAt).toBe("2023-06-21T05:16:10.000Z");
    expect(quote.exchangeTradeAt).toBeUndefined();
  });

  it("ignores unrequested and mismatched identities but accepts an omitted provider symbol", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: {
        fetched: [
          { exchange: "NFO", tradingSymbol: "UNKNOWN", symbolToken: "99999", exchFeedTime: "21-Jun-2023 10:46:10" },
          { exchange: "NSE", tradingSymbol: "NIFTY28AUG2624500CE", symbolToken: "58662", exchFeedTime: "21-Jun-2023 10:46:10" },
          { exchange: "NFO", tradingSymbol: "WRONGSYMBOL", symbolToken: "58663", exchFeedTime: "21-Jun-2023 10:46:10" },
          { exchange: "NFO", symbolToken: "58664", opnInterest: 100, exchFeedTime: "21-Jun-2023 10:46:10" },
          { exchange: "NFO", tradingSymbol: " nifty28aug2624600pe ", symbolToken: "58665", opnInterest: 200, exchFeedTime: "21-Jun-2023 10:46:11" },
          { exchange: "NFO", tradingSymbol: " ", symbolToken: "58666", opnInterest: 300, exchFeedTime: "21-Jun-2023 10:46:12" },
        ],
      },
    })) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500CE" },
      { exchange: "NFO", token: "58663", tradingSymbol: "NIFTY28AUG2624500PE" },
      { exchange: "NFO", token: "58664", tradingSymbol: "NIFTY28AUG2624600CE" },
      { exchange: "NFO", token: "58665", tradingSymbol: "NIFTY28AUG2624600PE" },
      { exchange: "NFO", token: "58666", tradingSymbol: "NIFTY28AUG2624700CE" },
    ])).toEqual([
      expect.objectContaining({ token: "58664", tradingSymbol: "NIFTY28AUG2624600CE", openInterest: 100 }),
      expect.objectContaining({ token: "58665", tradingSymbol: "NIFTY28AUG2624600PE", openInterest: 200 }),
      expect.objectContaining({ token: "58666", tradingSymbol: "NIFTY28AUG2624700CE", openInterest: 300 }),
    ]);
  });

  it("returns quotes in deduplicated request order", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({
      status: true,
      data: {
        fetched: [
          { exchange: "NFO", tradingSymbol: "NIFTY28AUG2624500PE", symbolToken: "58663", exchFeedTime: "21-Jun-2023 10:46:11" },
          { exchange: "NFO", tradingSymbol: "NIFTY28AUG2624500CE", symbolToken: "58662", exchFeedTime: "21-Jun-2023 10:46:10" },
        ],
      },
    })) as unknown as typeof fetch;

    const quotes = await getAngelOneFullMarketQuotes([
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500CE" },
      { exchange: "NFO", token: "58663", tradingSymbol: "NIFTY28AUG2624500PE" },
    ]);
    expect(quotes.map((quote) => quote.token)).toEqual(["58662", "58663"]);
  });

  it("deduplicates identical normalized request identities", async () => {
    activateMarketSession();
    let providerBody: unknown;
    globalThis.fetch = (async (_url, init) => {
      providerBody = JSON.parse(init?.body as string);
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500CE" },
      { exchange: "NFO", token: " 58662 ", tradingSymbol: " NIFTY28AUG2624500CE " },
    ])).toEqual([]);
    expect(providerBody).toEqual({
      mode: "FULL",
      exchangeTokens: { NFO: ["58662"] },
    });
  });

  it("rejects case-variant request symbols as conflicting identities", async () => {
    activateMarketSession();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500CE" },
      { exchange: "NFO", token: "58662", tradingSymbol: "nifty28aug2624500ce" },
    ])).rejects.toThrow("conflicting trading symbols for NFO:58662");
    expect(fetchCalled).toBe(false);
  });

  it("rejects conflicting trading symbols before fetch", async () => {
    activateMarketSession();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500CE" },
      { exchange: "NFO", token: "58662", tradingSymbol: "NIFTY28AUG2624500PE" },
    ])).rejects.toThrow("conflicting trading symbols for NFO:58662");
    expect(fetchCalled).toBe(false);
  });

  it("accepts 50 unique instruments in one provider request", async () => {
    activateMarketSession();
    let requestedTokens: string[] = [];
    globalThis.fetch = (async (_url, init) => {
      const providerBody = JSON.parse(init?.body as string) as {
        exchangeTokens: { NFO: string[] };
      };
      requestedTokens = providerBody.exchangeTokens.NFO;
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;
    const requests = Array.from({ length: 50 }, (_, index) => ({
      exchange: "NFO" as const,
      token: String(index + 1),
      tradingSymbol: `NIFTY28AUG26${24_000 + index}CE`,
    }));

    expect(await getAngelOneFullMarketQuotes(requests)).toEqual([]);
    expect(requestedTokens).toHaveLength(50);
  });

  it("rejects 51 unique instruments before fetch", async () => {
    activateMarketSession();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;
    const requests = Array.from({ length: 51 }, (_, index) => ({
      exchange: "NFO" as const,
      token: String(index + 1),
      tradingSymbol: `NIFTY28AUG26${24_000 + index}CE`,
    }));

    await expect(getAngelOneFullMarketQuotes(requests)).rejects.toThrow("maximum of 50 unique instruments");
    expect(fetchCalled).toBe(false);
  });

  it("rejects empty request identity strings before fetch", async () => {
    activateMarketSession();
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: " ",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).rejects.toThrow("token must not be empty");
    await expect(getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: " ",
    }])).rejects.toThrow("trading symbol must not be empty");
    expect(fetchCalled).toBe(false);
  });

  it("includes the HTTP status in transport failures", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).rejects.toThrow("angelone full market quote failed: 429");
  });

  it("keeps unsuccessful provider responses explicit", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({ status: false, message: "Invalid request" })) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).rejects.toThrow("angelone full market quote returned an unsuccessful response");
  });

  it("rejects a malformed successful provider payload", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => Response.json({ status: true, data: { fetched: {} } })) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).rejects.toThrow("angelone full market quote returned a malformed response");
  });

  it("reports invalid JSON as a malformed provider response", async () => {
    activateMarketSession();
    globalThis.fetch = (async () => new Response("not-json", {
      headers: { "Content-Type": "application/json" },
    })) as unknown as typeof fetch;

    await expect(getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).rejects.toThrow("angelone full market quote returned a malformed response");
  });

  it("returns no provider data without an active session", async () => {
    let fetchCalled = false;
    globalThis.fetch = (async () => {
      fetchCalled = true;
      return Response.json({ status: true, data: { fetched: [] } });
    }) as unknown as typeof fetch;

    expect(await getAngelOneFullMarketQuotes([{
      exchange: "NFO",
      token: "58662",
      tradingSymbol: "NIFTY28AUG2624500CE",
    }])).toEqual([]);
    expect(fetchCalled).toBe(false);
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

describe("angelone option contracts", () => {
  it("resolves and sorts valid NFO options from the instrument master", async () => {
    globalThis.fetch = (async (url) => {
      expect(String(url)).toBe("https://margincalculator.angelone.in/OpenAPI_File/files/OpenAPIScripMaster.json");
      return Response.json([
        { token: "17500PE", symbol: "NIFTY28AUG2617500PE", name: "NIFTY", expiry: "28AUG2026", strike: "1750000.000000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "570PE", symbol: "ABC28AUG26570PE", name: "ABC", expiry: "28AUG2026", strike: "57000.000000", lotsize: "100", instrumenttype: "OPTSTK", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "17500CE", symbol: "NIFTY28AUG2617500CE", name: " NIFTY ", expiry: "28AUG2026", strike: "1750000.000000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "17600PE", symbol: "NIFTY28AUG2617600PE", name: "NIFTY", expiry: "28AUG2026", strike: "1760000.000000", lotsize: "75", instrumenttype: "OPTSTK", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "CASH", symbol: "NIFTY-EQ", name: "NIFTY", expiry: "", strike: "0.000000", lotsize: "1", instrumenttype: "EQ", exch_seg: "NSE", tick_size: "5.000000" },
        { token: "FUT", symbol: "NIFTY28AUG26FUT", name: "NIFTY", expiry: "28AUG2026", strike: "0.000000", lotsize: "75", instrumenttype: "FUTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "OTHER-UNDERLYING", symbol: "BANKNIFTY28AUG2617500CE", name: "BANKNIFTY", expiry: "28AUG2026", strike: "1750000.000000", lotsize: "15", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "OTHER-EXPIRY", symbol: "NIFTY04SEP2617500CE", name: "NIFTY", expiry: "04SEP2026", strike: "1750000.000000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "ZERO-STRIKE", symbol: "NIFTY28AUG260CE", name: "NIFTY", expiry: "28AUG2026", strike: "0", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "NEGATIVE-STRIKE", symbol: "NIFTY28AUG2617500PE", name: "NIFTY", expiry: "28AUG2026", strike: "-1750000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "NAN-STRIKE", symbol: "NIFTY28AUG2617500CE", name: "NIFTY", expiry: "28AUG2026", strike: "NaN", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "BAD-LOT", symbol: "NIFTY28AUG2617600CE", name: "NIFTY", expiry: "28AUG2026", strike: "1760000", lotsize: "75.5", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "AMBIGUOUS-SIDE", symbol: "NIFTY28AUG2617600XX", name: "NIFTY", expiry: "28AUG2026", strike: "1760000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "", symbol: "NIFTY28AUG2617600CE", name: "NIFTY", expiry: "28AUG2026", strike: "1760000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
        { token: "MISSING-SYMBOL", symbol: "", name: "NIFTY", expiry: "28AUG2026", strike: "1760000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
      ]);
    }) as unknown as typeof fetch;

    expect(await resolveAngelOneOptionContracts({ name: "nifty", expiry: "28aug2026" })).toEqual([
      { token: "17500CE", tradingSymbol: "NIFTY28AUG2617500CE", name: " NIFTY ", expiry: "28AUG2026", strikePrice: 17500, optionType: "CE", lotSize: 75 },
      { token: "17500PE", tradingSymbol: "NIFTY28AUG2617500PE", name: "NIFTY", expiry: "28AUG2026", strikePrice: 17500, optionType: "PE", lotSize: 75 },
      { token: "17600PE", tradingSymbol: "NIFTY28AUG2617600PE", name: "NIFTY", expiry: "28AUG2026", strikePrice: 17600, optionType: "PE", lotSize: 75 },
    ]);
  });

  it("returns no contracts when the master has no matching provider rows", async () => {
    globalThis.fetch = (async () => Response.json([
      { token: "123", symbol: "NIFTY28AUG2617500CE", name: "NIFTY", expiry: "28AUG2026", strike: "1750000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
    ])) as unknown as typeof fetch;

    expect(await resolveAngelOneOptionContracts({ name: "NIFTY", expiry: "04SEP2026" })).toEqual([]);
  });

  it("keeps master HTTP and data-contract failures explicit", async () => {
    globalThis.fetch = (async () => new Response("upstream unavailable", { status: 503 })) as unknown as typeof fetch;
    await expect(resolveAngelOneOptionContracts({ name: "NIFTY", expiry: "28AUG2026" })).rejects.toThrow("angelone instrument master failed: 503");

    globalThis.fetch = (async () => Response.json({ status: true, data: [] })) as unknown as typeof fetch;
    await expect(resolveAngelOneOptionContracts({ name: "NIFTY", expiry: "28AUG2026" })).rejects.toThrow("angelone instrument master returned a non-array response");

    globalThis.fetch = (async () => new Response("not-json", { headers: { "Content-Type": "application/json" } })) as unknown as typeof fetch;
    await expect(resolveAngelOneOptionContracts({ name: "NIFTY", expiry: "28AUG2026" })).rejects.toThrow();
  });

  it("does not add unavailable market fields to resolved contracts", async () => {
    globalThis.fetch = (async () => Response.json([
      { token: "123", symbol: "NIFTY28AUG2617500CE", name: "NIFTY", expiry: "28AUG2026", strike: "1750000", lotsize: "75", instrumenttype: "OPTIDX", exch_seg: "NFO", tick_size: "5.000000" },
    ])) as unknown as typeof fetch;

    const [contract] = await resolveAngelOneOptionContracts({ name: "NIFTY", expiry: "28AUG2026" });
    expect(contract).not.toHaveProperty("ltp");
    expect(contract).not.toHaveProperty("openInterest");
    expect(contract).not.toHaveProperty("delta");
    expect(contract).not.toHaveProperty("timestamp");
  });
});
