import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { getCandles, getQuote, UpstreamDegradedError, _resetCircuitForTest } from "./yahoo";

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

  it("opens circuit after 3 consecutive fails and throws UpstreamDegradedError", async () => {
    let n = 0;
    globalThis.fetch = (async () => {
      n++;
      return new Response("", { status: 503 });
    }) as unknown as typeof fetch;
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    const before = n;
    await expect(getQuote("X")).rejects.toBeInstanceOf(UpstreamDegradedError);
    expect(n).toBe(before); // circuit open: no fetch issued
  });
});
