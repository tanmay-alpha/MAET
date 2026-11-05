import { afterEach, describe, expect, it } from "bun:test";
import { loadQuote, MAX_CACHED_QUOTES } from "./quote-service";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("quote cache", () => {
  it("evicts the least recently refreshed symbol once capacity is exceeded", async () => {
    const fetchedTickers: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const ticker = decodeURIComponent(new URL(String(input)).pathname.split("/").pop() ?? "");
      fetchedTickers.push(ticker);
      return Response.json({
        chart: {
          result: [{
            meta: { regularMarketPrice: 10, regularMarketVolume: 1, symbol: ticker, regularMarketTime: 1_793_000_000 },
            indicators: { quote: [] },
          }],
        },
      });
    }) as typeof fetch;

    const symbols = Array.from({ length: MAX_CACHED_QUOTES + 1 }, (_, index) => `QCACHE${index}`);
    for (const symbol of symbols) await loadQuote(symbol);
    expect(fetchedTickers).toHaveLength(MAX_CACHED_QUOTES + 1);

    // Most recent symbol is still cached; the first one was evicted.
    await loadQuote(symbols.at(-1)!);
    expect(fetchedTickers).toHaveLength(MAX_CACHED_QUOTES + 1);
    await loadQuote(symbols[0]);
    expect(fetchedTickers.at(-1)).toBe("QCACHE0.NS");
    expect(fetchedTickers).toHaveLength(MAX_CACHED_QUOTES + 2);
  });
});
