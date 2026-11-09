import { afterEach, describe, expect, it } from "bun:test";
import { appRouter } from "../index";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

const PRICES: Record<string, number> = { "MKTQA.NS": 101.5, "MKTQB.NS": 202.25 };
const PROVIDER_TIME_SEC = 1_793_800_000;

describe("market.getQuotes", () => {
  it("quotes every requested symbol with the provider timestamp", async () => {
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      // Yahoo's v8 chart endpoint takes exactly one ticker per request.
      const ticker = decodeURIComponent(new URL(String(input)).pathname.split("/").pop() ?? "");
      const price = PRICES[ticker];
      if (price === undefined) return new Response("Not Found", { status: 404 });
      return Response.json({
        chart: {
          result: [{
            meta: { regularMarketPrice: price, regularMarketVolume: 7, symbol: ticker, chartPreviousClose: 100, regularMarketTime: PROVIDER_TIME_SEC },
            indicators: { quote: [] },
          }],
        },
      });
    }) as typeof fetch;

    const caller = appRouter.createCaller({ userId: "user-1", email: null });
    const quotes = await caller.market.getQuotes({ symbols: ["MKTQA", "MKTQB"] });

    expect(quotes.map((quote: { symbol: string; price: number }) => [quote.symbol, quote.price])).toEqual([
      ["MKTQA", 101.5],
      ["MKTQB", 202.25],
    ]);
    const expectedTime = new Date(PROVIDER_TIME_SEC * 1000).toISOString();
    expect(quotes.every((quote: { lastUpdated: string; isStale: boolean }) => quote.lastUpdated === expectedTime && !quote.isStale)).toBe(true);
  });
});

describe("market symbol validation", () => {
  const caller = appRouter.createCaller({ userId: "user-1", email: null });
  const INVALID = ["TCS.NS?a=1", "../x", "A\\..\\x", ".NS", "A".repeat(100)];

  it("rejects invalid symbols before any upstream fetch", async () => {
    let fetched = 0;
    globalThis.fetch = (async () => {
      fetched++;
      return new Response("unexpected", { status: 500 });
    }) as typeof fetch;

    for (const symbol of INVALID) {
      await expect(caller.market.getCandles({ symbol, timeframe: "1d", range: "1mo" })).rejects.toMatchObject({ code: "BAD_REQUEST" });
      await expect(caller.analysis.getTechnicalAnalysis({ symbol })).rejects.toMatchObject({ code: "BAD_REQUEST" });
    }
    expect(fetched).toBe(0);
  });

  it("keeps the symbol inside a single path segment of the candles request", async () => {
    const urls: URL[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      urls.push(new URL(String(input)));
      return Response.json({ chart: { result: [] } });
    }) as typeof fetch;

    await caller.market.getCandles({ symbol: "M&M", timeframe: "1d", range: "1mo" });

    expect(urls).toHaveLength(1);
    expect(decodeURIComponent(urls[0].pathname.split("/").pop() ?? "")).toBe("M&M.NS");
    expect([...urls[0].searchParams.keys()].sort()).toEqual(["interval", "range"]);
  });
});
