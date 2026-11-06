import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import { presetToV3Definition, type RiskConfig } from "../../domain/backtest/preset-to-v3-adapter";
import { runBacktestV3, type V3TradeRecord } from "../../domain/strategy/runner-v3";

/** The Backtest Lab path: a V2 preset translated to a V3 AST and run by runner-v3. */
describe("Backtest Lab presets on the V3 engine", () => {
  const risk: RiskConfig = { initialCapital: 100_000, feeBps: 10, slippageBps: 5, positionSizePercent: 100, maximumOpenPositions: 1 };
  const candles: Candle[] = Array.from({ length: 200 }, (_, i) => {
    const p = 3000 + 80 * Math.sin(i / 8) + i;
    return { symbol: "TCS", tf: "1d", ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), open: p, high: p + 5, low: p - 5, close: p, volume: 10_000, source: "test" };
  });
  const run = (data: Candle[]) =>
    runBacktestV3({
      strategyVersionId: "preset",
      definition: presetToV3Definition({ type: "SMA_CROSS", fastPeriod: 10, slowPeriod: 20 }, risk),
      symbol: "TCS",
      candles: data,
    });

  it("trades the SMA cross preset and marks equity on every bar", () => {
    const result = run(candles);
    expect(result.tradeCount).toBeGreaterThan(0);
    expect(result.equityCurve).toHaveLength(candles.length);
    for (const t of result.trades) expect(t.entryBar).toBeGreaterThan(t.entrySignalBar);
  });

  it("decides earlier trades without seeing later bars", () => {
    const cutoff = 150;
    const altered = candles.map((c, i) => (i >= cutoff ? { ...c, open: c.open * 0.7, high: c.high * 0.7, low: c.low * 0.7, close: c.close * 0.7 } : c));
    const closedBefore = (trades: V3TradeRecord[]) => trades.filter((t) => t.exitBar < cutoff);
    expect(closedBefore(run(altered).trades)).toEqual(closedBefore(run(candles).trades));
  });
});
