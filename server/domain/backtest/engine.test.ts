import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import { runBacktest } from "./engine";
import type { Strategy } from "./strategies";

const candles: Candle[] = [100, 110, 120, 115].map((close, index) => ({
  symbol: "TEST",
  tf: "1d",
  ts: new Date(Date.UTC(2026, 0, index + 1)).toISOString(),
  open: close,
  high: close,
  low: close,
  close,
  volume: 100,
}));

describe("backtest engine", () => {
  it("executes a deterministic long trade and calculates real metrics", () => {
    const strategy: Strategy = {
      name: "sma_cross",
      params: {},
      signals: () => [
        { ts: candles[0].ts, side: "BUY", price: 100 },
        { ts: candles[2].ts, side: "SELL", price: 120 },
      ],
    };
    const result = runBacktest(candles, strategy, { initialCapital: 1_000, feeBps: 0 });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].pnl).toBe(200);
    expect(result.finalEquity).toBe(1_200);
    expect(result.totalReturnPct).toBe(20);
    expect(result.winRatePct).toBe(100);
  });

  it("force-closes an open position on the last candle", () => {
    const strategy: Strategy = {
      name: "rsi",
      params: {},
      signals: () => [{ ts: candles[1].ts, side: "BUY", price: 110 }],
    };
    const result = runBacktest(candles, strategy, { initialCapital: 1_000, feeBps: 0 });
    expect(result.trades).toHaveLength(1);
    expect(result.trades[0].exitTs).toBe(candles[3].ts);
  });
});
