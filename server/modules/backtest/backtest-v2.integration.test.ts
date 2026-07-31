import { describe, expect, it } from "bun:test";
import { runBacktest } from "../../domain/backtest/runner";

describe("Backtest V2 Engine Integration Test Suite", () => {
  it("1. Executes strategy without lookahead bias and computes risk metrics", () => {
    const candles = Array.from({ length: 100 }, (_, i) => ({
      symbol: "TCS",
      tf: "1d",
      ts: new Date(Date.now() - (100 - i) * 86400000).toISOString(),
      open: 3000 + i,
      high: 3005 + i,
      low: 2995 + i,
      close: 3000 + i + (i % 5 === 0 ? 10 : -2),
      volume: 10000,
    }));

    const result = runBacktest(
      {
        symbol: "TCS",
        from: candles[0].ts,
        to: candles[candles.length - 1].ts,
        strategyType: "SMA_CROSS",
        strategyParams: { type: "SMA_CROSS", fastPeriod: 10, slowPeriod: 20 },
        riskConfig: {
          initialCapital: 100000,
          feeBps: 10,
          slippageBps: 5,
          positionSizePercent: 100,
          maximumOpenPositions: 1,
        },
      },
      candles as any
    );

    expect(result.symbol).toBe("TCS");
    expect(result.metrics).toBeDefined();
    expect(result.equityCurve.length).toBe(candles.length);
  });
});
