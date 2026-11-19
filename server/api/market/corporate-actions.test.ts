import { afterEach, describe, expect, it } from "bun:test";
import type { CorporateActionsResponse } from "@shared/types";
import { _resetCircuitForTest, _setFetchTimeoutForTest, getQuote, MAX_QUEUED_YAHOO_REQUESTS } from "../../data/sources/yahoo";
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

function countingFetch(respond: () => Response): { calls: number } {
  const counter = { calls: 0 };
  globalThis.fetch = (async () => {
    counter.calls++;
    return respond();
  }) as unknown as typeof fetch;
  return counter;
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

  it("rejects a well-formed symbol outside the market catalogue without calling Yahoo", async () => {
    const yahoo = countingFetch(() => new Response("Not Found", { status: 404 }));
    for (let i = 0; i < 3; i++) {
      await expect(call(`symbol=ZQ${i}`)).rejects.toMatchObject({ statusCode: 400 });
    }
    expect(yahoo.calls).toBe(0);
  });

  // Each test uses its own catalogued symbol: the 24h cache is module state.
  it("returns normalised Yahoo events for the symbol", async () => {
    countingFetch(() =>
      Response.json({
        chart: {
          result: [{
            meta: { currency: "INR", gmtoffset: 19800, symbol: "TCS.NS" },
            events: { dividends: { "1755143100": { amount: 24, date: 1755143100 } } },
            indicators: { quote: [] },
          }],
        },
      })
    );

    const body = await call("symbol=tcs");

    expect(body).toMatchObject({ symbol: "TCS", source: "yahoo", stale: false });
    expect(body.events).toEqual([
      { kind: "dividend", exDate: "2025-08-14", amount: 24, currency: "INR", adjusted: false },
    ]);
  });

  it("answers 503 when Yahoo fails and nothing is cached", async () => {
    countingFetch(() => new Response("gone", { status: 404 }));
    await expect(call("symbol=INFY")).rejects.toMatchObject({ statusCode: 503 });
  });

  it("answers 503 at once when the Yahoo request queue is full", async () => {
    _setFetchTimeoutForTest(100);
    // Requests that never answer until the timeout aborts them: 4 hold the slots, the rest fill the queue.
    globalThis.fetch = ((_url: unknown, init?: RequestInit) => {
      const { promise, reject } = Promise.withResolvers<Response>();
      init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      return promise;
    }) as unknown as typeof fetch;
    const backlog = Array.from({ length: 4 + MAX_QUEUED_YAHOO_REQUESTS }, (_, i) =>
      getQuote(`HUNG${i}.NS`).catch(() => undefined)
    );

    // A real delay bounds "at once": the guard is the platform's AbortSignal.timeout.
    const outcome = await Promise.race([
      call("symbol=SBIN").then(() => "resolved", (error: unknown) => error),
      Bun.sleep(50).then(() => "pending"),
    ]);
    expect(outcome).toMatchObject({ statusCode: 503, data: { reason: "UPSTREAM_DEGRADED" } });

    globalThis.fetch = (async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    await Promise.all(backlog);
  });
});
