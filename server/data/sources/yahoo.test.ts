import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getCandles,
  getQuote,
  UpstreamDegradedError,
  UpstreamPermanentError,
  _resetCircuitForTest,
} from "./yahoo";

import { spyOn } from "bun:test";
import * as redisClient from "../../data/redis/client";
import fixtures from "./fixtures/yahoo-chart-2026-11-06.json";

type FixtureName = keyof typeof fixtures;

/**
 * Serves trimmed real Yahoo chart responses captured on 2026-11-07 (after the
 * 6 Nov 2026 session, while Yahoo still had 6 Nov's daily close empty). Each
 * request gets the fixture for its ticker and interval/range.
 */
function serveFixtures(pick: (ticker: string, params: URLSearchParams) => FixtureName): void {
  globalThis.fetch = (async (input: unknown) => {
    const url = new URL(String(input));
    const ticker = decodeURIComponent(url.pathname.split("/").at(-1) ?? "");
    return Response.json(fixtures[pick(ticker, url.searchParams)]);
  }) as unknown as typeof fetch;
}

function quoteFixture(ticker: string, params: URLSearchParams): FixtureName {
  const name = `${ticker} ${params.get("interval")} ${params.get("range")}`;
  if (!(name in fixtures)) throw new Error(`no fixture for ${name}`);
  return name as FixtureName;
}

const SESSION_6_NOV = { from: new Date("2026-10-07T00:00:00.000Z"), to: new Date("2026-11-07T06:00:00.000Z") };

const origFetch = globalThis.fetch;

beforeEach(() => {
  spyOn(redisClient, "getCachedJson").mockImplementation(async () => undefined);
  spyOn(redisClient, "setCachedJson").mockImplementation(async () => {});
  globalThis.fetch = (async (url: unknown) => {
    throw new Error(`UNMOCKED_FETCH_IN_TEST: ${String(url)}`);
  }) as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = origFetch;
  _resetCircuitForTest();
});

describe("yahoo source", () => {
  it("getQuote parses a 200 response into a Tick", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketVolume: 5, regularMarketTime: 1_700_000_000, symbol: "RELIANCE.NS" } }] } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const t = await getQuote("RELIANCE.NS");
    expect(t.price).toBe(100);
    expect(t.symbol).toBe("RELIANCE");
    expect(t.exchange).toBe("NSE");
  });

  it("rejects a quote without Yahoo's provider timestamp", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketVolume: 5, symbol: "RELIANCE.NS" } }] } }), {
        status: 200,
      })) as unknown as typeof fetch;

    await expect(getQuote("RELIANCE.NS")).rejects.toBeInstanceOf(UpstreamPermanentError);
  });

  // NSE allIndices at 06-Nov-2026 15:30: NIFTY 50 last 25030.35, previousClose
  // 24536.6, variation 493.75 (2.01%); NIFTY BANK 59086 / 57773.65 / 1312.35
  // (2.27%). Yahoo's chartPreviousClose for the indices was 4 Nov's close.
  it.each([
    ["^NSEI", 25030.35, 24536.6, 493.75, 2.01],
    ["^NSEBANK", 59086, 57773.65, 1312.35, 2.27],
    ["^BSESN", 81028.02, 79310.01, 1718.01, 2.17],
    ["RELIANCE.NS", 1320, 1313.4, 6.6, 0.5],
  ])("takes %s's previous close from the last complete daily bar before the quote's session", async (ticker, price, previousClose, change, publishedPct) => {
    serveFixtures(quoteFixture);

    const tick = await getQuote(ticker);

    expect(tick.price).toBe(price);
    expect(tick.previousClose).toBe(previousClose);
    expect(tick.change).toBe(change);
    expect(tick.changePct).toBeCloseTo((change / previousClose) * 100, 10);
    expect(Math.round(tick.changePct! * 100) / 100).toBe(publishedPct);
    expect(tick.currency).toBe("INR");
    expect(tick.ts).toBe(new Date(fixtures[`${ticker} 1d 1mo` as FixtureName].chart.result[0].meta.regularMarketTime * 1000).toISOString());
  });

  it("ends the daily chart on the quote's session while Yahoo's close for it is still empty", async () => {
    serveFixtures(() => "RELIANCE.NS 1d");

    const candles = await getCandles("RELIANCE", SESSION_6_NOV.from, SESSION_6_NOV.to, "1d");

    expect(candles.map((c) => c.ts)).toEqual([
      "2026-11-03T03:45:00.000Z",
      "2026-11-04T03:45:00.000Z",
      "2026-11-05T03:45:00.000Z",
      "2026-11-06T03:45:00.000Z",
    ]);
    // NSE bhavcopy for 06-Nov-2026: open 1295, high 1320, low 1295, close 1320.
    expect(candles.at(-1)).toMatchObject({ open: 1295, high: 1320, low: 1295, close: 1320, volume: 22766798 });
  });

  it("merges Yahoo's partial current-week bar into that week's Monday bar", async () => {
    serveFixtures(() => "RELIANCE.NS 1wk");

    const candles = await getCandles("RELIANCE", SESSION_6_NOV.from, SESSION_6_NOV.to, "1wk");

    expect(candles.map((c) => c.ts)).toEqual(["2026-10-25T18:30:00.000Z", "2026-11-01T18:30:00.000Z"]);
    // Week of 2 Nov: Monday's open, the week's range, Friday's close and
    // Mon-Thu volume (169372037, the sum of those daily bars) plus Friday's.
    expect(candles[1]).toMatchObject({
      open: 1228.0999755859375,
      high: 1325,
      low: 1214.199951171875,
      close: 1320,
      volume: 169372037 + 22766798,
    });
  });

  it("drops Yahoo's flat zero-volume bar on an NSE holiday", async () => {
    serveFixtures(() => "RELIANCE.NS 1d 2026-01");

    const candles = await getCandles(
      "RELIANCE",
      new Date("2026-01-10T00:00:00.000Z"),
      new Date("2026-01-21T00:00:00.000Z"),
      "1d",
      [new Date("2026-01-15")]
    );

    expect(candles.map((c) => c.ts.slice(0, 10))).toEqual(["2026-01-14", "2026-01-16", "2026-01-19", "2026-01-20"]);
  });

  it("keeps a flat zero-volume bar on a day that is not an NSE holiday", async () => {
    serveFixtures(() => "RELIANCE.NS 1d 2026-01");

    const candles = await getCandles(
      "RELIANCE",
      new Date("2026-01-10T00:00:00.000Z"),
      new Date("2026-01-21T00:00:00.000Z"),
      "1d",
      []
    );

    expect(candles.map((c) => c.ts.slice(0, 10))).toContain("2026-01-15");
  });

  it("drops null and zero-value Yahoo candle placeholders", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        chart: {
          result: [{
            meta: { regularMarketPrice: 105, regularMarketVolume: 10, symbol: "RELIANCE.NS" },
            timestamp: [1_700_000_000, 1_700_000_300, 1_700_000_600],
            indicators: {
              quote: [{
                open: [100, 0, null],
                high: [106, 0, null],
                low: [99, 0, null],
                close: [105, 0, null],
                volume: [1234, 0, null],
              }],
            },
          }],
        },
      }))) as unknown as typeof fetch;

    const candles = await getCandles(
      "RELIANCE",
      new Date("2023-11-14T00:00:00.000Z"),
      new Date("2023-11-15T00:00:00.000Z"),
      "5m"
    );
    expect(candles).toHaveLength(1);
    expect(candles[0].close).toBe(105);
    expect(candles[0].volume).toBe(1234);
  });

  it("retries on 429 and succeeds on second try", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      if (n === 1) return new Response("", { status: 429, headers: { "Retry-After": "0" } });
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 50, regularMarketVolume: 1, regularMarketTime: 1_700_000_000, symbol: "X.NS" } }] } }), { status: 200 });
    }) as unknown as typeof fetch;
    const t = await getQuote("X");
    expect(t.price).toBe(50);
    expect(n).toBe(2);
  });

  it("does not retry permanent upstream errors", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(getQuote("MISSING")).rejects.toBeInstanceOf(UpstreamPermanentError);
    expect(n).toBe(1);
  });

  it("does not let repeated transient failures poison later requests", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    expect(n).toBe(9); // each failed request exhausts its own retry budget

    globalThis.fetch = (async () => {
      n++;
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 75, regularMarketVolume: 1, regularMarketTime: 1_700_000_000, symbol: "X.NS" } }] } }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(getQuote("X")).resolves.toMatchObject({ price: 75 });
    expect(n).toBe(10);
  });

  it("reuses one candle cache entry for repeated requests within the cache window", async () => {
    const keys: string[] = [];
    spyOn(redisClient, "getCachedJson").mockImplementation(async (key: string) => {
      keys.push(key);
      return undefined;
    });
    globalThis.fetch = (async () => Response.json({ chart: { result: [{ meta: { regularMarketPrice: 1, regularMarketVolume: 1, symbol: "RELIANCE.NS" }, timestamp: [], indicators: { quote: [{ open: [], high: [], low: [], close: [], volume: [] }] } }] } })) as unknown as typeof fetch;

    const to = new Date("2026-11-05T05:00:10.000Z");
    const tenSecondsLater = new Date(to.getTime() + 10_000);
    await getCandles("RELIANCE", new Date(to.getTime() - 30 * 86_400_000), to, "1d");
    await getCandles("RELIANCE", new Date(tenSecondsLater.getTime() - 30 * 86_400_000), tenSecondsLater, "1d");

    expect(keys).toHaveLength(2);
    expect(keys[1]).toBe(keys[0]);
  });

  it("requests candles with the same browser User-Agent as quotes and names the failing status", async () => {
    const agents: string[] = [];
    globalThis.fetch = (async (_url: unknown, init?: RequestInit) => {
      agents.push(new Headers(init?.headers).get("User-Agent") ?? "");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(getCandles("ZZZZFAKE", new Date("2026-10-01"), new Date("2026-11-01"), "1d")).rejects.toThrow("404");
    await expect(getQuote("ZZZZFAKE")).rejects.toBeInstanceOf(UpstreamPermanentError);
    expect(agents[0]).toBe(agents[1]);
    expect(agents[0]).toContain("Mozilla/5.0");
  });
});
