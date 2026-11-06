import { afterEach, describe, expect, it } from "bun:test";
import { MAX_STREAM_SYMBOLS } from "@shared/types";
import { EventEmitter } from "node:events";
import { getSubscriptionRefCount, resetSubscriptionRefsForTesting } from "../../orchestrator";
import streamHandler, { getActiveStreamConnections, MAX_MARKET_STREAMS_PER_IP } from "./stream.get";

const realFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = realFetch;
  resetSubscriptionRefsForTesting();
});

const handler = streamHandler as unknown as (event: unknown) => Promise<unknown>;

function fakeStreamEvent(symbols: string, ip = "198.51.100.1") {
  const req = Object.assign(new EventEmitter(), {
    headers: { "x-forwarded-for": ip } as Record<string, string>,
    socket: {},
  });
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
  return { event: { path: `/api/market/stream?symbols=${symbols}`, context: {}, node: { req, res } }, req, res };
}

/** Yahoo answers only after `release()`, so handlers stay parked on the snapshot. */
function holdYahoo(): { release: () => void } {
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
  return { release: () => upstream.resolve() };
}

describe("GET /api/market/stream", () => {
  it("releases the subscription when the client disconnects while the snapshot loads", async () => {
    const yahoo = holdYahoo();
    const { event, req, res } = fakeStreamEvent("SSELEAK");
    const handled = handler(event);
    expect(getSubscriptionRefCount("SSELEAK")).toBe(1);

    req.emit("close");
    yahoo.release();
    // A disconnected client ends the handler instead of parking it forever.
    await handled;

    expect(getSubscriptionRefCount("SSELEAK")).toBe(0);
    expect(getActiveStreamConnections()).toBe(0);
    expect(res.written.some((chunk) => chunk.startsWith("event: snapshot"))).toBe(false);
  }, 2_000);

  it("lets one address hold a stream per open tab, and caps it beyond that", async () => {
    // A trader with several tabs, or several users behind one office/college NAT, share an address.
    expect(MAX_MARKET_STREAMS_PER_IP).toBeGreaterThanOrEqual(10);
    const yahoo = holdYahoo();
    const open = Array.from({ length: MAX_MARKET_STREAMS_PER_IP }, () => fakeStreamEvent("SSECAP", "203.0.113.7"));
    const handled = open.map(({ event }) => handler(event));

    await expect(handler(fakeStreamEvent("SSECAP", "203.0.113.7").event)).rejects.toMatchObject({ statusCode: 429 });
    const other = fakeStreamEvent("SSECAP", "203.0.113.8");
    const otherHandled = handler(other.event);
    expect(getActiveStreamConnections()).toBe(MAX_MARKET_STREAMS_PER_IP + 1);

    for (const { req } of [...open, other]) req.emit("close");
    yahoo.release();
    await Promise.all([...handled, otherHandled]);
    expect(getActiveStreamConnections()).toBe(0);
  }, 2_000);

  it("rejects symbols outside the market symbol pattern before opening a stream", async () => {
    await expect(handler(fakeStreamEvent("RELIANCE,%3Cscript%3E").event)).rejects.toMatchObject({ statusCode: 400 });
    expect(getActiveStreamConnections()).toBe(0);
  });

  it("accepts the union of several pages of symbols, up to the stream cap", async () => {
    // A 50-row screener page plus the header index ticker exceeds the REST cap of 50.
    const yahoo = holdYahoo();
    const symbols = Array.from({ length: MAX_STREAM_SYMBOLS }, (_, index) => `SSEU${index}`);
    const { event, req } = fakeStreamEvent(symbols.join(","), "203.0.113.20");
    const handled = handler(event);
    expect(getActiveStreamConnections()).toBe(1);
    req.emit("close");
    yahoo.release();
    await handled;
    expect(getActiveStreamConnections()).toBe(0);
  }, 5_000);

  it("rejects more symbols than the stream cap", async () => {
    const symbols = Array.from({ length: MAX_STREAM_SYMBOLS + 1 }, (_, index) => `SSEV${index}`);
    await expect(handler(fakeStreamEvent(symbols.join(",")).event)).rejects.toMatchObject({ statusCode: 400 });
  });
});
