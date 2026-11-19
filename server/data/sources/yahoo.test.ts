import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getCandles,
  getCorporateActions,
  getQuote,
  UpstreamDegradedError,
  UpstreamPermanentError,
  MAX_QUEUED_YAHOO_REQUESTS,
  YahooOverloadedError,
  YahooTimeoutError,
  _resetCircuitForTest,
  _setFetchTimeoutForTest,
} from "./yahoo";

import { spyOn } from "bun:test";
import * as redisClient from "../../data/redis/client";

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

  it("uses Yahoo's market timestamp and previous close metadata", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({
        chart: {
          result: [{
            meta: {
              regularMarketPrice: 105,
              regularMarketVolume: 10,
              regularMarketTime: 1_700_000_000,
              chartPreviousClose: 100,
              currency: "INR",
              symbol: "RELIANCE.NS",
            },
          }],
        },
      }))) as unknown as typeof fetch;

    const tick = await getQuote("RELIANCE");
    expect(tick.ts).toBe(new Date(1_700_000_000 * 1000).toISOString());
    expect(tick.previousClose).toBe(100);
    expect(tick.change).toBe(5);
    expect(tick.changePct).toBe(5);
    expect(tick.currency).toBe("INR");
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
    // A different ticker: the first 404 is remembered, so ZZZZFAKE would not reach fetch again.
    await expect(getQuote("ZZZZFAKE2")).rejects.toBeInstanceOf(UpstreamPermanentError);
    expect(agents[0]).toBe(agents[1]);
    expect(agents[0]).toContain("Mozilla/5.0");
  });
});

/** A Yahoo call that never answers; it only settles when its abort signal fires. */
function hangingFetch(calls: { count: number }): typeof fetch {
  return ((_url: unknown, init?: RequestInit) => {
    calls.count++;
    const { promise, reject } = Promise.withResolvers<Response>();
    init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
    return promise;
  }) as unknown as typeof fetch;
}

/**
 * Settles with the outcome of `promise`, or "pending" if it still runs after `ms`. A real
 * delay is deliberate: the guard under test is the platform's `AbortSignal.timeout`, which
 * fake timers do not drive.
 */
function within(promise: Promise<unknown>, ms: number): Promise<unknown> {
  return Promise.race([promise.then(() => "resolved", (error: unknown) => error), Bun.sleep(ms).then(() => "pending")]);
}

describe("yahoo abuse guards", () => {
  it("remembers a ticker Yahoo reports as unknown for ten minutes across quote, candle and event calls", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;
    const now = spyOn(Date, "now");
    const start = 1_800_000_000_000;
    now.mockImplementation(() => start);
    try {
      for (let i = 0; i < 5; i++) {
        await expect(getCorporateActions("ZQ123")).rejects.toBeInstanceOf(UpstreamPermanentError);
      }
      await expect(getCandles("ZQ123", new Date("2026-10-01"), new Date("2026-11-01"), "1d")).rejects.toBeInstanceOf(UpstreamPermanentError);
      await expect(getQuote("ZQ123")).rejects.toBeInstanceOf(UpstreamPermanentError);
      expect(calls).toBe(1);

      now.mockImplementation(() => start + 10 * 60_000 + 1);
      await expect(getCorporateActions("ZQ123")).rejects.toBeInstanceOf(UpstreamPermanentError);
      expect(calls).toBe(2);
    } finally {
      now.mockRestore();
    }
  });

  it("aborts a hung fetch at the request timeout and does not retry it", async () => {
    _setFetchTimeoutForTest(50);
    const calls = { count: 0 };
    globalThis.fetch = hangingFetch(calls);

    const outcome = await within(getQuote("RELIANCE.NS"), 2_000);

    expect(outcome).toBeInstanceOf(YahooTimeoutError);
    expect(outcome).toBeInstanceOf(UpstreamDegradedError);
    expect(calls.count).toBe(1);
  });

  it("rejects at once when the slot wait queue is full", async () => {
    _setFetchTimeoutForTest(100);
    const calls = { count: 0 };
    globalThis.fetch = hangingFetch(calls);
    // 4 requests take the slots, MAX_QUEUED_YAHOO_REQUESTS more queue behind them.
    const backlog = Array.from({ length: 4 + MAX_QUEUED_YAHOO_REQUESTS }, (_, i) =>
      getQuote(`HUNG${i}.NS`).catch((error: unknown) => error)
    );
    await Bun.sleep(0);
    expect(calls.count).toBe(4);

    const outcome = await within(getQuote("RELIANCE.NS"), 50);
    expect(outcome).toBeInstanceOf(YahooOverloadedError);
    expect(outcome).toBeInstanceOf(UpstreamDegradedError);
    expect(calls.count).toBe(4);

    // Drain: the held slots time out, then the queue sees fast 404s.
    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const settled = await Promise.all(backlog);
    expect(settled.slice(0, 4).every((error) => error instanceof YahooTimeoutError)).toBe(true);
    expect(settled.slice(4).every((error) => error instanceof UpstreamPermanentError)).toBe(true);
  });
});
