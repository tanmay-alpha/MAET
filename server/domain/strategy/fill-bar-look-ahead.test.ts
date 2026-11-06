/**
 * An order filled at the open of bar i can only know bars 0..i-1. Sizing, stop levels, market
 * impact, participation caps and signal ranking must therefore not change when bar i's
 * high/low/close/volume (unknowable at the open) are perturbed.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "./runner-v3";
import { runPortfolioBacktestEngine, type SignalRankingMethod } from "./portfolio-engine";

function makeCandles(symbol: string, length: number, startPrice: number, volume: number, phase: number): Candle[] {
  return Array.from({ length }, (_, i) => {
    const price = startPrice * (1 + 0.002 * i + 0.01 * Math.sin(i / 3 + phase));
    const range = price * (0.01 + 0.005 * Math.cos(i / 2 + phase));
    return {
      symbol,
      tf: "1d",
      ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      open: price,
      high: price + range,
      low: price - range,
      close: price * (1 + 0.003 * Math.sin(i + phase)),
      volume: volume * (1 + 0.3 * Math.sin(i / 4 + phase)),
      source: "test",
    };
  });
}

/** Perturbs everything about bar `index` except its open (the fill price). */
function perturbFillBar(candles: Candle[], index: number, factor: number): Candle[] {
  return candles.map((c, i) =>
    i === index
      ? { ...c, high: c.high * (1 + 0.2 * factor), low: c.low * (1 - 0.2 * factor), close: c.close * (1 + 0.1 * factor), volume: c.volume * (1 + 4 * factor) }
      : c,
  );
}

// Enters once ATR(14) has warmed up; sized by ATR so sizing depends on volatility.
const definition: StrategyDefinition = {
  name: "atr-sized",
  direction: "LONG_ONLY",
  entry: {
    kind: "GROUP", id: "entry", combinator: "AND",
    children: [{
      kind: "CONDITION", id: "e1",
      left: { kind: "INDICATOR", indicator: "ATR", params: { period: 14 }, lag: 0 },
      operator: "GREATER_THAN",
      right: { kind: "CONSTANT", value: 0 },
    }],
  },
  exit: { kind: "GROUP", id: "exit", combinator: "OR", children: [] },
  risk: {
    sizingMethod: "VOLATILITY_TARGET",
    sizeValue: 1,
    stopLossPercent: 30,
    maximumOpenPositions: 1,
    allowPyramiding: false,
  },
  execution: {
    fillPolicy: "NEXT_BAR_OPEN",
    intrabarPolicy: "CONSERVATIVE",
    feeModel: "VOLUME_AWARE",
    slippageBps: 5,
    spreadModel: "LIQUIDITY_BASED",
    baseSpreadBps: 5,
    marketImpactModel: "SQUARE_ROOT",
    impactCoefficient: 20,
    maxParticipationRate: 0.002,
    initialCapital: 1_000_000,
  },
};

describe("runner-v3 — decisions at the fill bar use only prior bars", () => {
  it("sizes the entry identically when the fill bar's high/low/close/volume change", () => {
    const candles = makeCandles("AAA", 80, 500, 2_000_000, 0);
    const base = runBacktestV3({ strategyVersionId: "la", definition, symbol: "AAA", candles });
    const entry = base.trades[0];
    expect(entry).toBeDefined();

    for (const factor of [-1, 1]) {
      const perturbed = runBacktestV3({
        strategyVersionId: "la",
        definition,
        symbol: "AAA",
        candles: perturbFillBar(candles, entry.entryBar, factor),
      });
      const t = perturbed.trades[0];
      expect(t.entryBar).toBe(entry.entryBar);
      expect(t.entryPrice).toBe(entry.entryPrice);
      expect(t.quantity).toBe(entry.quantity);
      expect(t.entryFees).toBe(entry.entryFees);
    }
  });
});

describe("portfolio engine — decisions at the fill bar use only prior bars", () => {
  const symbolCandles: Record<string, Candle[]> = {
    AAA: makeCandles("AAA", 80, 500, 2_000_000, 0),
    BBB: makeCandles("BBB", 80, 300, 1_500_000, 1),
    CCC: makeCandles("CCC", 80, 800, 1_000_000, 2),
  };

  for (const rankingMethod of ["MOMENTUM", "RELATIVE_VOLUME", "SCORECARD_SCORE"] as SignalRankingMethod[]) {
    it(`ranks, sizes and fills identically under ${rankingMethod} when fill-bar data change`, () => {
      const run = (candles: Record<string, Candle[]>) =>
        runPortfolioBacktestEngine({
          strategyVersionId: "la",
          definition,
          symbolCandles: candles,
          initialCapital: 1_000_000,
          constraints: { maximumOpenPositions: 1, maximumPositionPercent: 100 },
          rankingMethod,
        });

      const base = run(symbolCandles);
      const first = base.trades[0];
      expect(first).toBeDefined();
      const fillIndex = symbolCandles.AAA.findIndex((c) => new Date(c.ts).getTime() === first.entryTimestamp);

      // Push the bar-i volume/close in opposite directions per symbol so a ranking that peeks would flip.
      const factors: Record<string, number> = { AAA: -1, BBB: 1, CCC: 0.5 };
      const perturbed = run(
        Object.fromEntries(Object.entries(symbolCandles).map(([sym, c]) => [sym, perturbFillBar(c, fillIndex, factors[sym])])),
      );
      const t = perturbed.trades[0];
      expect(t.symbol).toBe(first.symbol);
      expect(t.entryTimestamp).toBe(first.entryTimestamp);
      expect(t.quantity).toBe(first.quantity);
      expect(t.entryPrice).toBe(first.entryPrice);
    });
  }
});
