import { afterEach, describe, expect, it } from "bun:test";
import type { CorporateActionsResponse } from "@shared/types";
import { _resetCircuitForTest } from "../../data/sources/yahoo";
import handler from "./corporate-actions.get";

const realFetch = globalThis.fetch;

function call(query: string): Promise<CorporateActionsResponse> {
  const event = {
    path: `/api/market/corporate-actions?${query}`,
    context: {},
    node: { req: { headers: {}, socket: {} }, res: { setHeader() {} } },
  };
  return (handler as unknown as (event: unknown) => Promise<CorporateActionsResponse>)(event);
}

afterEach(() => {
  globalThis.fetch = realFetch;
  _resetCircuitForTest();
});

describe("GET /api/market/corporate-actions", () => {
  it("rejects a missing or malformed symbol", async () => {
    await expect(call("")).rejects.toMatchObject({ statusCode: 400 });
    await expect(call("symbol=REL%20IANCE")).rejects.toMatchObject({ statusCode: 400 });
  });

  // Each test uses its own symbol: the 24h cache is module state.
  it("returns normalised Yahoo events for the symbol", async () => {
    globalThis.fetch = (async () =>
      Response.json({
        chart: {
          result: [{
            meta: { currency: "INR", gmtoffset: 19800, symbol: "EVENTSA.NS" },
            events: { dividends: { "1755143100": { amount: 24, date: 1755143100 } } },
            indicators: { quote: [] },
          }],
        },
      })) as unknown as typeof fetch;

    const body = await call("symbol=eventsa");

    expect(body).toMatchObject({ symbol: "EVENTSA", source: "yahoo", stale: false });
    expect(body.events).toEqual([
      { kind: "dividend", exDate: "2025-08-14", amount: 24, currency: "INR", splitAdjusted: false },
    ]);
  });

  it("answers 503 when Yahoo fails and nothing is cached", async () => {
    globalThis.fetch = (async () => new Response("gone", { status: 404 })) as unknown as typeof fetch;
    await expect(call("symbol=EVENTSB")).rejects.toMatchObject({ statusCode: 503 });
  });
});
