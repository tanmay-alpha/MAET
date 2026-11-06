/**
 * Strongest look-ahead check: a backtest that never saw bars after time T must agree with the
 * full-history backtest on every trade closed, and every equity point marked, before T.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { FillPolicy, StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "./runner-v3";
import { runPortfolioBacktestEngine } from "./portfolio-engine";

function makeCandles(symbol: string, phase: number): Candle[] {
  return Array.from({ length: 220 }, (_, i) => {
    const p = 100 * (1 + 0.08 * Math.sin(i / 7 + phase) + 0.03 * Math.sin(i / 2.3 + phase));
    const range = p * (0.01 + 0.006 * Math.abs(Math.cos(i / 3 + phase)));
    return {
      symbol, tf: "1d", ts: new Date(Date.UTC(2023, 0, 1 + i)).toISOString(),
      open: p * (1 + 0.004 * Math.sin(i + phase)), high: p + range, low: p - range, close: p,
      volume: 800_000 * (1 + 0.4 * Math.sin(i / 5 + phase)), source: "test",
    };
  });
}

function definition(direction: "LONG_ONLY" | "SHORT_ONLY", fillPolicy: FillPolicy): StrategyDefinition {
  const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
  const up = direction === "LONG_ONLY";
  return {
    name: "cross",
    direction,
    entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: up ? "CROSS_ABOVE" : "CROSS_BELOW", right: sma(15) }] },
    exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(5), operator: up ? "CROSS_BELOW" : "CROSS_ABOVE", right: sma(15) }] },
    risk: { sizingMethod: "VOLATILITY_TARGET", sizeValue: 2, stopLossPercent: 4, takeProfitPercent: 6, maximumOpenPositions: 2, allowPyramiding: false },
    execution: {
      fillPolicy, intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5,
      spreadModel: "LIQUIDITY_BASED", baseSpreadBps: 4, marketImpactModel: "SQUARE_ROOT", impactCoefficient: 15,
      maxParticipationRate: 0.05, initialCapital: 1_000_000,
    },
  };
}

const CUTS = [120, 160, 200];
const cases = (["LONG_ONLY", "SHORT_ONLY"] as const).flatMap((direction) =>
  (["NEXT_BAR_OPEN", "ON_CLOSE"] as const).map((fillPolicy) => ({ direction, fillPolicy })),
);

describe("truncated history reproduces the full run before the cut", () => {
  for (const { direction, fillPolicy } of cases) {
    it(`runner-v3 ${direction} ${fillPolicy}`, () => {
      const candles = makeCandles("AAA", 0);
      const run = (data: Candle[]) => runBacktestV3({ strategyVersionId: "t", definition: definition(direction, fillPolicy), symbol: "AAA", candles: data });
      const full = run(candles);
      expect(full.tradeCount).toBeGreaterThan(3);
      for (const cut of CUTS) {
        const lastTs = new Date(candles[cut - 1].ts).getTime();
        const part = run(candles.slice(0, cut));
        const before = <T extends { exitTimestamp: number }>(ts: T[]) => ts.filter((t) => t.exitTimestamp < lastTs);
        expect(before(part.trades)).toEqual(before(full.trades));
        const points = (p: { timestamp: number }[]) => p.filter((x) => x.timestamp < lastTs);
        expect(points(part.equityCurve)).toEqual(points(full.equityCurve));
      }
    });

    it(`portfolio engine ${direction} ${fillPolicy}`, () => {
      const symbolCandles = { AAA: makeCandles("AAA", 0), BBB: makeCandles("BBB", 1.3), CCC: makeCandles("CCC", 2.1) };
      const run = (data: Record<string, Candle[]>) =>
        runPortfolioBacktestEngine({
          strategyVersionId: "t", definition: definition(direction, fillPolicy), symbolCandles: data, initialCapital: 1_000_000,
          constraints: { maximumOpenPositions: 2, maximumPositionPercent: 50, maximumSectorExposurePercent: 100 }, rankingMethod: "MOMENTUM",
        });
      const full = run(symbolCandles);
      expect(full.tradeCount).toBeGreaterThan(3);
      for (const cut of CUTS) {
        const lastTs = new Date(symbolCandles.AAA[cut - 1].ts).getTime();
        const part = run(Object.fromEntries(Object.entries(symbolCandles).map(([s, c]) => [s, c.slice(0, cut)])));
        const before = <T extends { exitTimestamp: number }>(ts: T[]) => ts.filter((t) => t.exitTimestamp < lastTs);
        expect(before(part.trades)).toEqual(before(full.trades));
        const points = (p: { timestamp: number }[]) => p.filter((x) => x.timestamp < lastTs);
        expect(points(part.equityCurve)).toEqual(points(full.equityCurve));
      }
    });
  }
});
