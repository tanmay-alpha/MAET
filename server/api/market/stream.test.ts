import { afterEach, describe, expect, it } from "bun:test";
import { EventEmitter } from "node:events";
import { getSubscriptionRefCount, resetSubscriptionRefsForTesting } from "../../orchestrator";
import streamHandler, { getActiveStreamConnections } from "./stream.get";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSubscriptionRefsForTesting();
});

function fakeStreamEvent(symbols: string) {
  const req = new EventEmitter();
  const res = Object.assign(new EventEmitter(), {
    destroyed: false,
    written: [] as string[],
    setHeader() {},
    flushHeaders() {},
    write(chunk: string) {
      this.written.push(chunk);
      return true;
    },
  });
  return { event: { path: `/api/market/stream?symbols=${symbols}`, node: { req, res } }, req, res };
}

describe("GET /api/market/stream", () => {
  it("releases the subscription when the client disconnects while the snapshot loads", async () => {
    const upstream = Promise.withResolvers<void>();
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      await upstream.promise;
      return Response.json({
        chart: {
          result: [{
            meta: { regularMarketPrice: 10, regularMarketVolume: 1, symbol: String(input), regularMarketTime: 1_793_000_000 },
            indicators: { quote: [] },
          }],
        },
      });
    }) as typeof fetch;

    const { event, req, res } = fakeStreamEvent("SSELEAK");
    const handler = streamHandler as unknown as (event: unknown) => Promise<unknown>;
    const handled = handler(event);
    expect(getSubscriptionRefCount("SSELEAK")).toBe(1);

    req.emit("close");
    upstream.resolve();
    // A disconnected client ends the handler instead of parking it forever.
    await handled;

    expect(getSubscriptionRefCount("SSELEAK")).toBe(0);
    expect(getActiveStreamConnections()).toBe(0);
    expect(res.written.some((chunk) => chunk.startsWith("event: snapshot"))).toBe(false);
  }, 2_000);
});
