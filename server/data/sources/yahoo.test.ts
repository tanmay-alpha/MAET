import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
  getCandles,
  getQuote,
  UpstreamDegradedError,
  UpstreamPermanentError,
  _resetCircuitForTest,
} from "./yahoo";

const origFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = origFetch;
  _resetCircuitForTest();
});

describe("yahoo source", () => {
  it("getQuote parses a 200 response into a Tick", async () => {
    globalThis.fetch = (async () =>
      new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 100, regularMarketVolume: 5, symbol: "RELIANCE.NS" } }] } }), {
        status: 200,
      })) as unknown as typeof fetch;
    const t = await getQuote("RELIANCE.NS");
    expect(t.price).toBe(100);
    expect(t.symbol).toBe("RELIANCE");
    expect(t.exchange).toBe("NSE");
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
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 50, regularMarketVolume: 1, symbol: "X.NS" } }] } }), { status: 200 });
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
      return new Response(JSON.stringify({ chart: { result: [{ meta: { regularMarketPrice: 75, regularMarketVolume: 1, symbol: "X.NS" } }] } }), { status: 200 });
    }) as unknown as typeof fetch;

    await expect(getQuote("X")).resolves.toMatchObject({ price: 75 });
    expect(n).toBe(10);
  });
});
