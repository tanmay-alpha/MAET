import { afterEach, beforeEach, describe, expect, it, setSystemTime } from "bun:test";
import type { MarketQuote } from "@shared/types";
import { setAngelOneMarketSession } from "../../data/sources/angelone/client";
import quotesHandler from "./quotes.get";

const realFetch = globalThis.fetch;

type QuotesBody = {
  delayed: boolean;
  marketPhase?: string;
  quotes: MarketQuote[];
};

function fakeEvent(path: string) {
  return {
    path,
    context: {},
    node: { req: { headers: {}, socket: {} }, res: { setHeader() {} } },
  };
}

// Each test uses its own symbols: the quote cache is module state, and
// anonymous callers cannot bypass it with refresh=1.
function callQuotes(query: string): Promise<QuotesBody> {
  const handler = quotesHandler as unknown as (event: unknown) => Promise<QuotesBody>;
  return handler(fakeEvent(`/api/market/quotes?${query}`));
}

type FetchLog = { angel: number; yahoo: number };

/**
 * Angel REST answers every requested NSE token with a trade at
 * `exchFeedTime` (IST); Yahoo answers any ticker at `yahooTimeSec`.
 */
function installFetch(exchFeedTime: string, yahooTimeSec: number): FetchLog {
  const log: FetchLog = { angel: 0, yahoo: 0 };
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.includes("apiconnect.angelone.in")) {
      log.angel++;
      const body = JSON.parse(String(init?.body)) as { exchangeTokens: { NSE: string[] } };
      return Response.json({
        status: true,
        data: {
          fetched: body.exchangeTokens.NSE.map((symbolToken) => ({
            symbolToken,
            ltp: 1313.4,
            tradeVolume: 19_479_324,
            close: 1311,
            exchFeedTime,
          })),
        },
      });
    }
    if (url.includes("query1.finance.yahoo.com")) {
      log.yahoo++;
      return Response.json({
        chart: {
          result: [{
            meta: { regularMarketPrice: 100, regularMarketVolume: 10, symbol: "X.NS", chartPreviousClose: 99, regularMarketTime: yahooTimeSec },
            indicators: { quote: [] },
          }],
        },
      });
    }
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
  return log;
}

beforeEach(() => {
  setAngelOneMarketSession({
    jwt: "JWT",
    feedToken: "FEED",
    refreshToken: "REFRESH",
    clientCode: "C",
    apiKey: "K",
    obtainedAt: new Date().toISOString(),
  });
});

afterEach(() => {
  globalThis.fetch = realFetch;
  setAngelOneMarketSession(undefined);
  setSystemTime();
});

describe("GET /api/market/quotes", () => {
  it("never labels a broker quote live after the close", async () => {
    // 2026-11-05 19:49 IST (Thursday); last trade 16:08 IST.
    setSystemTime(new Date("2026-11-05T14:19:00.000Z"));
    installFetch("05-Nov-2026 16:08:10", Date.parse("2026-11-05T10:38:10Z") / 1000);

    const body = await callQuotes("symbols=RELIANCE");

    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]).toMatchObject({ symbol: "RELIANCE", source: "angelone", quality: "delayed", delayed: true });
    expect(body.delayed).toBe(true);
    expect(body.marketPhase).toBe("AFTER_HOURS");
  });

  it("flags delay per quote when broker and Yahoo quotes are mixed in session", async () => {
    // 2026-11-05 10:30 IST; broker quote is one second old, Yahoo is delayed.
    setSystemTime(new Date("2026-11-05T05:00:00.000Z"));
    installFetch("05-Nov-2026 10:29:59", Date.parse("2026-11-05T04:45:00Z") / 1000);

    const body = await callQuotes("symbols=TCS,QTESTYAHOO");
    const bySymbol = new Map(body.quotes.map((quote) => [quote.symbol, quote]));

    expect(body.marketPhase).toBe("OPEN");
    expect(bySymbol.get("TCS")).toMatchObject({ source: "angelone", quality: "live", delayed: false });
    expect(bySymbol.get("QTESTYAHOO")).toMatchObject({ source: "yahoo", delayed: true });
    expect(body.delayed).toBe(true);
  });

  it("does not call yesterday's broker quote live during today's session", async () => {
    setSystemTime(new Date("2026-11-05T05:00:00.000Z"));
    installFetch("04-Nov-2026 15:29:59", Date.parse("2026-11-05T04:45:00Z") / 1000);

    const body = await callQuotes("symbols=INFY");

    expect(body.quotes[0]).toMatchObject({ symbol: "INFY", quality: "delayed", delayed: true });
  });

  it("ignores refresh=1 from anonymous callers", async () => {
    setSystemTime(new Date("2026-11-05T05:00:00.000Z"));
    const log = installFetch("05-Nov-2026 10:29:59", Date.parse("2026-11-05T04:45:00Z") / 1000);

    await callQuotes("symbols=ITC");
    await callQuotes("symbols=ITC&refresh=1");

    expect(log.angel).toBe(1);
  });

  it("rejects symbols outside the market symbol pattern", async () => {
    await expect(callQuotes("symbols=RELIANCE,..%2F..%2Fadmin")).rejects.toMatchObject({ statusCode: 400 });
  });
});
