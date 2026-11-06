import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { setAngelOneMarketSession } from "../../data/sources/angelone/client";
import { loadQuote, loadQuotes, MAX_CACHED_QUOTES, setAngelBatchGapForTests } from "./quote-service";
import { quoteStore } from "./quote-store";
import { registerMarketSymbols } from "./symbol";

const realFetch = globalThis.fetch;

// 2026-11-05 (Thursday) 10:30 IST, inside the cash session.
const IN_SESSION = new Date("2026-11-05T05:00:00.000Z");

afterEach(() => {
  globalThis.fetch = realFetch;
  setAngelOneMarketSession(undefined);
  setSystemTime();
});

function activateAngelSession(): void {
  setAngelOneMarketSession({
    jwt: "JWT",
    feedToken: "FEED",
    refreshToken: "REFRESH",
    clientCode: "C",
    apiKey: "K",
    obtainedAt: IN_SESSION.toISOString(),
  });
}

function yahooChart(ticker: string, price: number): Response {
  return Response.json({
    chart: {
      result: [{
        meta: { regularMarketPrice: price, regularMarketVolume: 1, symbol: ticker, regularMarketTime: Date.parse("2026-11-05T04:45:00Z") / 1000 },
        indicators: { quote: [] },
      }],
    },
  });
}

type Calls = { angel: number; yahoo: number };

/** Angel REST answers each requested token at 10:29:59 IST unless `angelFails`. */
function installFetch(opts: { angelFails?: boolean } = {}): Calls {
  const calls: Calls = { angel: 0, yahoo: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("apiconnect.angelone.in")) {
      calls.angel++;
      if (opts.angelFails) return new Response("upstream down", { status: 502 });
      const body = JSON.parse(String(init?.body)) as { exchangeTokens: { NSE: string[] } };
      return Response.json({
        status: true,
        data: {
          fetched: body.exchangeTokens.NSE.map((symbolToken) => ({
            symbolToken,
            ltp: 500,
            tradeVolume: 1_000,
            close: 495,
            exchFeedTime: "05-Nov-2026 10:29:59",
          })),
        },
      });
    }
    calls.yahoo++;
    const ticker = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
    return yahooChart(ticker, 400);
  }) as typeof fetch;
  return calls;
}

describe("loadQuote source order", () => {
  it("uses a fresh live Angel One stream tick without calling any provider", async () => {
    setSystemTime(IN_SESSION);
    const calls = installFetch();
    quoteStore.set({
      exchange: "NSE",
      symbol: "HDFCBANK",
      price: 1_710,
      volume: 9_000,
      ts: new Date(IN_SESSION.getTime() - 2_000).toISOString(),
      source: "angelone",
      quality: "live",
    });

    const tick = await loadQuote("HDFCBANK");

    expect(tick).toMatchObject({ source: "angelone", quality: "live", price: 1_710 });
    expect(calls).toEqual({ angel: 0, yahoo: 0 });
  });

  it("prefers Angel One REST over Yahoo for a catalogued symbol", async () => {
    setSystemTime(IN_SESSION);
    activateAngelSession();
    const calls = installFetch();

    const tick = await loadQuote("SBIN");

    expect(tick).toMatchObject({ symbol: "SBIN", source: "angelone", quality: "live", price: 500 });
    expect(calls).toEqual({ angel: 1, yahoo: 0 });
  });

  it("falls back to Yahoo, labelled delayed, when Angel One REST fails", async () => {
    setSystemTime(IN_SESSION);
    activateAngelSession();
    const calls = installFetch({ angelFails: true });

    const tick = await loadQuote("ICICIBANK");

    expect(tick).toMatchObject({ symbol: "ICICIBANK", source: "yahoo", quality: "delayed", price: 400 });
    expect(calls).toEqual({ angel: 1, yahoo: 1 });
  });

  it("does not let a forced load fall back to the cache when Angel One fails", async () => {
    setSystemTime(IN_SESSION);
    activateAngelSession();
    installFetch();
    expect(await loadQuote("AXISBANK")).toMatchObject({ source: "angelone" });

    const calls = installFetch({ angelFails: true });
    const forced = await loadQuote("AXISBANK", true);

    expect(forced).toMatchObject({ source: "yahoo", price: 400 });
    expect(calls).toEqual({ angel: 1, yahoo: 1 });
  });
});

describe("quote cache", () => {
  it("evicts the least recently refreshed symbol once capacity is exceeded", async () => {
    const fetchedTickers: string[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const ticker = decodeURIComponent(new URL(String(input)).pathname.split("/").pop() ?? "");
      fetchedTickers.push(ticker);
      return yahooChart(ticker, 10);
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

describe("loadQuotes Angel One batching", () => {
  afterEach(() => setAngelBatchGapForTests(undefined));

  it("splits a stream-sized symbol set into Angel One requests of at most 50 tokens", async () => {
    setSystemTime(IN_SESSION);
    setAngelBatchGapForTests(0);
    activateAngelSession();
    const symbols = Array.from({ length: 120 }, (_, index) => `QBATCH${index}`);
    registerMarketSymbols(symbols.map((symbol, index) => ({
      exchange: "NSE" as const, symbol, name: symbol, token: String(900_000 + index), yahooTicker: `${symbol}.NS`, isActive: true,
    })));
    const batchSizes: number[] = [];
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (!String(input).includes("apiconnect.angelone.in")) throw new Error("unexpected Yahoo fallback");
      const body: { exchangeTokens: { NSE: string[] } } = JSON.parse(String(init?.body));
      const tokens = body.exchangeTokens.NSE;
      batchSizes.push(tokens.length);
      // SmartAPI's quote endpoint rejects more than 50 tokens per request.
      if (tokens.length > 50) return Response.json({ status: false, message: "Too many tokens", errorcode: "AB4005" });
      return Response.json({
        status: true,
        data: { fetched: tokens.map((symbolToken) => ({ symbolToken, ltp: 10, tradeVolume: 1, close: 9, exchFeedTime: "05-Nov-2026 10:29:59" })) },
      });
    }) as typeof fetch;

    const result = await loadQuotes(symbols);

    expect(batchSizes).toEqual([50, 50, 20]);
    expect(result.quotes).toHaveLength(120);
    expect(result.quotes.every((quote) => quote.source === "angelone")).toBe(true);
  });

  it("sends batches one at a time and falls back to Yahoo only for a failed batch", async () => {
    setSystemTime(IN_SESSION);
    activateAngelSession();
    setAngelBatchGapForTests(0);
    const symbols = Array.from({ length: 120 }, (_, index) => `QPART${index}`);
    registerMarketSymbols(symbols.map((symbol, index) => ({
      exchange: "NSE" as const, symbol, name: symbol, token: String(800_000 + index), yahooTicker: `${symbol}.NS`, isActive: true,
    })));
    let angelRequests = 0;
    let inFlight = 0;
    let maxInFlight = 0;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (!url.includes("apiconnect.angelone.in")) {
        const ticker = decodeURIComponent(new URL(url).pathname.split("/").pop() ?? "");
        return yahooChart(ticker, 7);
      }
      angelRequests++;
      inFlight++;
      maxInFlight = Math.max(maxInFlight, inFlight);
      await Promise.resolve();
      inFlight--;
      if (angelRequests === 2) return new Response("rate limited", { status: 502 });
      const body: { exchangeTokens: { NSE: string[] } } = JSON.parse(String(init?.body));
      return Response.json({
        status: true,
        data: { fetched: body.exchangeTokens.NSE.map((symbolToken) => ({ symbolToken, ltp: 10, tradeVolume: 1, close: 9, exchFeedTime: "05-Nov-2026 10:29:59" })) },
      });
    }) as typeof fetch;

    const result = await loadQuotes(symbols);
    const bySource = (source: string) => result.quotes.filter((quote) => quote.source === source).length;

    expect(maxInFlight).toBe(1);
    expect(bySource("angelone")).toBe(70);
    expect(bySource("yahoo")).toBe(50);
  });
});
