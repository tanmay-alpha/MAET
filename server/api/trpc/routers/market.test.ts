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
