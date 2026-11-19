import { afterEach, describe, expect, it } from "bun:test";
import handler from "./candles.get";

const realFetch = globalThis.fetch;

function call(query: string): Promise<unknown> {
  const event = {
    path: `/api/market/candles?${query}`,
    context: {},
    node: { req: { headers: {}, socket: {} }, res: { setHeader() {} } },
  };
  return (handler as unknown as (event: unknown) => Promise<unknown>)(event);
}

afterEach(() => {
  globalThis.fetch = realFetch;
});

describe("GET /api/market/candles", () => {
  it("rejects a well-formed symbol outside the market catalogue without calling Yahoo", async () => {
    let calls = 0;
    globalThis.fetch = (async () => {
      calls++;
      return new Response("Not Found", { status: 404 });
    }) as unknown as typeof fetch;

    await expect(call("symbol=ZQ123&tf=1d&range=1mo")).rejects.toMatchObject({ statusCode: 400, statusMessage: "Unknown symbol" });
    expect(calls).toBe(0);
  });

  it("accepts catalogued symbols and indices past the symbol check", async () => {
    // An unsupported timeframe fails after the symbol check, before any I/O.
    await expect(call("symbol=RELIANCE&tf=2m")).rejects.toMatchObject({ statusCode: 400, statusMessage: "Unsupported timeframe" });
    await expect(call("symbol=NIFTY50&tf=2m")).rejects.toMatchObject({ statusCode: 400, statusMessage: "Unsupported timeframe" });
  });
});
