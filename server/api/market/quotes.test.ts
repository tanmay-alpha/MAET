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
  const headers = new Map<string, string>();
  return {
    path,
    node: { req: { headers: {} }, res: { setHeader: (k: string, v: string) => headers.set(k, v) } },
  };
}

function callQuotes(symbols: string): Promise<QuotesBody> {
  const handler = quotesHandler as unknown as (event: unknown) => Promise<QuotesBody>;
  return handler(fakeEvent(`/api/market/quotes?symbols=${symbols}&refresh=1`));
}

/** Angel REST quote for RELIANCE (token 2885) traded at `exchFeedTime` (IST). */
function angelQuoteResponse(exchFeedTime: string): Response {
  return Response.json({
    status: true,
    data: {
      fetched: [{ symbolToken: "2885", ltp: 1313.4, tradeVolume: 19_479_324, close: 1311, exchFeedTime }],
    },
  });
}

function yahooChartResponse(regularMarketTimeSec: number): Response {
  return Response.json({
    chart: {
      result: [{
        meta: {
          regularMarketPrice: 100,
          regularMarketVolume: 10,
          symbol: "QTESTYAHOO.NS",
          chartPreviousClose: 99,
          regularMarketTime: regularMarketTimeSec,
        },
        indicators: { quote: [] },
      }],
    },
  });
}

function installFetch(exchFeedTime: string, yahooTimeSec: number): void {
  globalThis.fetch = (async (input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("apiconnect.angelone.in")) return angelQuoteResponse(exchFeedTime);
    if (url.includes("query1.finance.yahoo.com")) return yahooChartResponse(yahooTimeSec);
    throw new Error(`unexpected fetch ${url}`);
  }) as typeof fetch;
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

    const body = await callQuotes("RELIANCE");

    expect(body.quotes).toHaveLength(1);
    expect(body.quotes[0]).toMatchObject({ symbol: "RELIANCE", source: "angelone", quality: "delayed", delayed: true });
    expect(body.delayed).toBe(true);
    expect(body.marketPhase).toBe("AFTER_HOURS");
  });

  it("flags delay per quote when broker and Yahoo quotes are mixed in session", async () => {
    // 2026-11-05 10:30 IST; broker quote is one second old, Yahoo is delayed.
    setSystemTime(new Date("2026-11-05T05:00:00.000Z"));
    installFetch("05-Nov-2026 10:29:59", Date.parse("2026-11-05T04:45:00Z") / 1000);

    const body = await callQuotes("RELIANCE,QTESTYAHOO");
    const bySymbol = new Map(body.quotes.map((quote) => [quote.symbol, quote]));

    expect(body.marketPhase).toBe("OPEN");
    expect(bySymbol.get("RELIANCE")).toMatchObject({ quality: "live", delayed: false });
    expect(bySymbol.get("QTESTYAHOO")).toMatchObject({ source: "yahoo", delayed: true });
    expect(body.delayed).toBe(true);
  });

  it("does not call yesterday's broker quote live during today's session", async () => {
    setSystemTime(new Date("2026-11-05T05:00:00.000Z"));
    installFetch("04-Nov-2026 15:29:59", Date.parse("2026-11-05T04:45:00Z") / 1000);

    const body = await callQuotes("RELIANCE");

    expect(body.quotes[0]).toMatchObject({ quality: "delayed", delayed: true });
  });
});
