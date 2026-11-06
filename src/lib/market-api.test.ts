import { afterEach, describe, expect, mock, test } from "bun:test";
import { fetchMarketCandles } from "./market-api";

const BACKEND = "https://maet.onrender.example";
const candlesBody = JSON.stringify({ symbol: "RELIANCE", candles: [] });

describe("fetchMarketCandles", () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  function recordFetches(respond: (url: string) => Response) {
    const urls: string[] = [];
    globalThis.fetch = mock(async (url: string | URL | Request) => {
      urls.push(String(url));
      return respond(String(url));
    }) as unknown as typeof fetch;
    return urls;
  }

  test("asks the configured backend first", async () => {
    const urls = recordFetches(() => new Response(candlesBody, { status: 200 }));

    await fetchMarketCandles("RELIANCE", "1d", "1y", undefined, BACKEND);

    expect(urls).toEqual([`${BACKEND}/api/market/candles?symbol=RELIANCE&tf=1d&range=1y`]);
  });

  test("falls back to the same-origin route when the backend fails", async () => {
    const urls = recordFetches((url) =>
      url.startsWith(BACKEND) ? new Response("", { status: 503 }) : new Response(candlesBody, { status: 200 })
    );

    await fetchMarketCandles("RELIANCE", "1d", "1y", undefined, BACKEND);

    expect(urls).toEqual([
      `${BACKEND}/api/market/candles?symbol=RELIANCE&tf=1d&range=1y`,
      "/api/market/candles?symbol=RELIANCE&tf=1d&range=1y",
    ]);
  });

  test("uses the same-origin route when no backend is configured", async () => {
    const urls = recordFetches(() => new Response(candlesBody, { status: 200 }));

    await fetchMarketCandles("RELIANCE", "1d", "1y", undefined, "");

    expect(urls).toEqual(["/api/market/candles?symbol=RELIANCE&tf=1d&range=1y"]);
  });
});
