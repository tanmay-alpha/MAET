import { afterEach, describe, expect, it, setSystemTime } from "bun:test";
import { setAngelOneMarketSession } from "../../data/sources/angelone/client";
import { loadQuote, MAX_CACHED_QUOTES } from "./quote-service";
import { quoteStore } from "./quote-store";

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
