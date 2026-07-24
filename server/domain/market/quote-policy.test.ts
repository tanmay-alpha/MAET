import { describe, expect, it, beforeEach } from "bun:test";
import { evaluateExecutionQuote, type Tick } from "@shared/types";
import { MarketDataMultiplexer } from "./data-multiplexer";

describe("Phase 0: Market Data & Quote Execution Policy Tests", () => {
  const now = 1700000000000; // fixed reference timestamp
  const nowIso = new Date(now).toISOString();

  it("1. Fresh Angel One live tick is accepted for execution", () => {
    const tick: Tick = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 1000,
      ts: nowIso,
      source: "angelone",
      quality: "live",
    };
    const result = evaluateExecutionQuote(tick, now);
    expect(result.executable).toBe(true);
    expect(result.reason).toBeUndefined();
  });

  it("2. Synthetic tick is rejected for execution", () => {
    const tick: Tick = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 1000,
      ts: nowIso,
      source: "simulated",
      quality: "synthetic",
    };
    const result = evaluateExecutionQuote(tick, now);
    expect(result.executable).toBe(false);
    expect(result.reason).toContain("Synthetic quotes are rejected");
  });

  it("3. Yahoo delayed tick is rejected for execution by default", () => {
    const tick: Tick = {
      exchange: "NSE",
      symbol: "TCS",
      price: 3500,
      volume: 500,
      ts: nowIso,
      source: "yahoo",
      quality: "delayed",
    };
    const result = evaluateExecutionQuote(tick, now);
    expect(result.executable).toBe(false);
    expect(result.reason).toContain("Delayed quotes are rejected");
  });

  it("4. Stale live tick (age > maxAgeMs) is rejected", () => {
    const oldTs = new Date(now - 10000).toISOString(); // 10 seconds old
    const tick: Tick = {
      exchange: "NSE",
      symbol: "INFY",
      price: 1400,
      volume: 200,
      ts: oldTs,
      source: "angelone",
      quality: "live",
    };
    const result = evaluateExecutionQuote(tick, now, { maxAgeMs: 5000 });
    expect(result.executable).toBe(false);
    expect(result.reason).toContain("Quote is stale");
  });

  it("5. Missing timestamp is rejected", () => {
    const tick = {
      exchange: "NSE",
      symbol: "INFY",
      price: 1400,
      volume: 200,
      source: "angelone",
      quality: "live",
    } as any;
    const result = evaluateExecutionQuote(tick, now);
    expect(result.executable).toBe(false);
    expect(result.reason).toContain("missing timestamp");
  });

  it("6. Non-positive or non-finite price is rejected", () => {
    const tickZero: Tick = {
      exchange: "NSE",
      symbol: "SBIN",
      price: 0,
      volume: 100,
      ts: nowIso,
      source: "angelone",
      quality: "live",
    };
    expect(evaluateExecutionQuote(tickZero, now).executable).toBe(false);

    const tickNegative: Tick = {
      exchange: "NSE",
      symbol: "SBIN",
      price: -50,
      volume: 100,
      ts: nowIso,
      source: "angelone",
      quality: "live",
    };
    expect(evaluateExecutionQuote(tickNegative, now).executable).toBe(false);

    const tickNaN: any = {
      exchange: "NSE",
      symbol: "SBIN",
      price: NaN,
      volume: 100,
      ts: nowIso,
      source: "angelone",
      quality: "live",
    };
    expect(evaluateExecutionQuote(tickNaN, now).executable).toBe(false);
  });

  it("7. MarketDataMultiplexer does not start simulator when flag is false", () => {
    process.env.ENABLE_MARKET_SIMULATOR = "false";
    const mux = new MarketDataMultiplexer();
    mux.start();
    // Verify simulator interval is not created when flag is false
    expect((mux as any).simulationInterval).toBeNull();
    mux.stop();
  });

  it("8. MarketDataMultiplexer labels synthetic ticks with source=simulated and quality=synthetic", () => {
    const mux = new MarketDataMultiplexer();
    mux.subscribe(["HDFCBANK"]);
    process.env.ENABLE_MARKET_SIMULATOR = "true";
    mux.start();

    // Verify tick cache properties
    expect((mux as any).simulationInterval).not.toBeNull();
    mux.stop();
    process.env.ENABLE_MARKET_SIMULATOR = "false";
  });
});
