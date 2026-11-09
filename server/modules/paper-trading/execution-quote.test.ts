import { describe, expect, it } from "bun:test";
import type { Tick } from "@shared/types";
import { createExecutionQuoteLoader, createLiveMarkSource } from "./execution-quote";

function tick(overrides: Partial<Tick> = {}): Tick {
  return {
    exchange: "NSE",
    symbol: "RELIANCE",
    price: 2500,
    volume: 1000,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
    ...overrides,
  };
}

function loaderWith(streamed: Tick | undefined) {
  const fallbackCalls: string[] = [];
  const fallbackQuote = tick({ price: 2400, source: "yahoo", quality: "delayed" });
  const load = createExecutionQuoteLoader({
    latestTick: () => streamed,
    fallback: async (symbol) => {
      fallbackCalls.push(symbol);
      return fallbackQuote;
    },
  });
  return { load, fallbackCalls, fallbackQuote };
}

describe("execution quote loader", () => {
  it("uses a fresh streamed tick on the order's exchange without calling the fallback", async () => {
    const streamed = tick();
    const { load, fallbackCalls } = loaderWith(streamed);
    expect(await load("NSE", "RELIANCE")).toBe(streamed);
    expect(fallbackCalls).toEqual([]);
  });

  it("falls back when the streamed tick is stale", async () => {
    const { load, fallbackCalls, fallbackQuote } = loaderWith(tick({ ts: new Date(Date.now() - 60_000).toISOString() }));
    expect(await load("NSE", "RELIANCE")).toBe(fallbackQuote);
    expect(fallbackCalls).toEqual(["RELIANCE"]);
  });

  it("falls back when the streamed tick is for another exchange", async () => {
    const { load, fallbackCalls, fallbackQuote } = loaderWith(tick({ exchange: "NSE" }));
    expect(await load("BSE", "RELIANCE")).toBe(fallbackQuote);
    expect(fallbackCalls).toEqual(["RELIANCE"]);
  });

  it("falls back when no tick has been streamed", async () => {
    const { load, fallbackCalls, fallbackQuote } = loaderWith(undefined);
    expect(await load("NSE", "RELIANCE")).toBe(fallbackQuote);
    expect(fallbackCalls).toEqual(["RELIANCE"]);
  });

  it("falls back when the streamed tick is delayed", async () => {
    const { load, fallbackCalls } = loaderWith(tick({ source: "yahoo", quality: "delayed" }));
    await load("NSE", "RELIANCE");
    expect(fallbackCalls).toEqual(["RELIANCE"]);
  });
});

describe("live mark source for the margin check", () => {
  it("marks at a fresh live tick on the position's exchange", () => {
    expect(createLiveMarkSource(() => tick({ price: 800 }))("NSE", "RELIANCE")).toBe(800);
  });

  it("has no mark for a missing, stale, delayed or other-exchange tick", () => {
    const stale = tick({ ts: new Date(Date.now() - 60_000).toISOString() });
    const delayed = tick({ source: "yahoo", quality: "delayed" });
    for (const latest of [undefined, stale, delayed]) {
      expect(createLiveMarkSource(() => latest)("NSE", "RELIANCE")).toBeUndefined();
    }
    expect(createLiveMarkSource(() => tick())("BSE", "RELIANCE")).toBeUndefined();
  });
});
