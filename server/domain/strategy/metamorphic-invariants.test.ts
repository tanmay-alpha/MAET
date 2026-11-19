/**
 * Metamorphic look-ahead checks over seeded random price paths. Everything a backtest reports up
 * to bar t (trades closed, entries made, equity marked) must be identical whether the bars after
 * t exist, are cut off, or are replaced with arbitrary data. Covers both fill policies, long and
 * short, and runner-v3's drawdown and daily-loss gates.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { FillPolicy, StrategyDefinition } from "../../../shared/strategy/ast";
import type { EquityPoint } from "../backtest/risk-metrics";
import { runBacktestV3 } from "./runner-v3";
import { runPortfolioBacktestEngine } from "./portfolio-engine";

const DAY = 86_400_000;
const START = Date.UTC(2023, 0, 2, 3, 45);

/** mulberry32: small deterministic PRNG so the property loops are reproducible. */
function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function randomBar(symbol: string, i: number, prevClose: number, random: () => number, volatility: number): Candle {
  const close = Math.max(1, prevClose * (1 + (random() - 0.5) * volatility));
  const open = Math.max(1, prevClose * (1 + (random() - 0.5) * volatility * 0.3));
  return {
    symbol, tf: "1d", ts: new Date(START + i * DAY).toISOString(),
    open, high: Math.max(open, close) * (1 + 0.02 * random()), low: Math.min(open, close) * (1 - 0.02 * random()),
    close, volume: Math.round(500_000 + 2_000_000 * random()), source: "test",
  };
}

function randomWalk(symbol: string, length: number, random: () => number): Candle[] {
  const candles: Candle[] = [];
  let close = 50 + 100 * random();
  for (let i = 0; i < length; i++) {
    const bar = randomBar(symbol, i, close, random, 0.05);
    candles.push(bar);
    close = bar.close;
  }
  return candles;
}

/** Replaces every bar after `cut` with unrelated (wilder) random data on the same timestamps. */
function mutateAfter(candles: Candle[], cut: number, random: () => number): Candle[] {
  const out = candles.slice(0, cut + 1);
  let close = candles[cut].close * (0.3 + 1.4 * random());
  for (let i = cut + 1; i < candles.length; i++) {
    const bar = { ...randomBar(candles[i].symbol, i, close, random, 0.4), ts: candles[i].ts };
    out.push(bar);
    close = bar.close;
  }
  return out;
}

function definition(direction: "LONG_ONLY" | "SHORT_ONLY", fillPolicy: FillPolicy): StrategyDefinition {
  const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
  const up = direction === "LONG_ONLY";
  return {
    name: "metamorphic",
    direction,
    entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(4), operator: up ? "CROSS_ABOVE" : "CROSS_BELOW", right: sma(12) }] },
    exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(4), operator: up ? "CROSS_BELOW" : "CROSS_ABOVE", right: sma(12) }] },
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 60, stopLossPercent: 6, takeProfitPercent: 9, trailingStopPercent: 8,
      maximumOpenPositions: 2, maximumDrawdownPercent: 35, maximumDailyLossPercent: 3, allowPyramiding: false,
    },
    execution: {
      fillPolicy, intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5,
      spreadModel: "LIQUIDITY_BASED", baseSpreadBps: 4, marketImpactModel: "SQUARE_ROOT", impactCoefficient: 15,
      maxParticipationRate: 0.05, initialCapital: 1_000_000,
    },
  };
}

interface TradeLike { entryTimestamp: number; exitTimestamp: number; entryPrice: number; quantity: number }

const pointsBy = (curve: EquityPoint[], ts: number, strictly: boolean) => curve.filter((p) => (strictly ? p.timestamp < ts : p.timestamp <= ts));

/**
 * What is known about trades by time `ts`: closed trades in full, open ones by their entry. Trades
 * are recorded in exit order, so entries are sorted to compare runs whose later exits differ.
 */
function knownBy<T extends TradeLike>(trades: T[], ts: number, closedStrictlyBefore: boolean) {
  const closed = trades.filter((t) => (closedStrictlyBefore ? t.exitTimestamp < ts : t.exitTimestamp <= ts));
  const entries = trades
    .filter((t) => t.entryTimestamp <= ts)
    .map((t) => ({ at: t.entryTimestamp, price: t.entryPrice, quantity: t.quantity }))
    .sort((a, b) => a.at - b.at || a.price - b.price || a.quantity - b.quantity);
  return { closed, entries };
}

const cases = (["LONG_ONLY", "SHORT_ONLY"] as const).flatMap((direction) =>
  (["NEXT_BAR_OPEN", "ON_CLOSE"] as const).map((fillPolicy) => ({ direction, fillPolicy })),
);

describe("runner-v3 — results up to bar t ignore everything after t", () => {
  for (const { direction, fillPolicy } of cases) {
    it(`${direction} ${fillPolicy}: future bars mutated or truncated`, () => {
      const random = prng(direction === "LONG_ONLY" ? 11 : 23);
      const def = definition(direction, fillPolicy);
      const runOn = (candles: Candle[]) => runBacktestV3({ strategyVersionId: "m", definition: def, symbol: "AAA", candles });
      let tradesSeen = 0;
      for (let k = 0; k < 12; k++) {
        const candles = randomWalk("AAA", 160, random);
        const full = runOn(candles);
        tradesSeen += full.tradeCount;
        const cut = 60 + Math.floor(random() * 95);
        const cutTs = new Date(candles[cut].ts).getTime();

        // Mutated future: bar `cut` itself is unchanged, so everything through it must match.
        const mutated = runOn(mutateAfter(candles, cut, random));
        expect(knownBy(mutated.trades, cutTs, false)).toEqual(knownBy(full.trades, cutTs, false));
        expect(pointsBy(mutated.equityCurve, cutTs, false)).toEqual(pointsBy(full.equityCurve, cutTs, false));

        // Truncated history: the last bar force-closes, so compare strictly before it.
        const truncated = runOn(candles.slice(0, cut + 1));
        expect(knownBy(truncated.trades, cutTs, true)).toEqual(knownBy(full.trades, cutTs, true));
        expect(pointsBy(truncated.equityCurve, cutTs, true)).toEqual(pointsBy(full.equityCurve, cutTs, true));
      }
      expect(tradesSeen).toBeGreaterThan(12);
    });
  }
});

describe("portfolio engine — results up to bar t ignore everything after t", () => {
  for (const { direction, fillPolicy } of cases) {
    it(`${direction} ${fillPolicy}: future bars mutated`, () => {
      const random = prng(direction === "LONG_ONLY" ? 101 : 202);
      const def = definition(direction, fillPolicy);
      const runOn = (symbolCandles: Record<string, Candle[]>) =>
        runPortfolioBacktestEngine({
          strategyVersionId: "m", definition: def, symbolCandles, initialCapital: 1_000_000, rankingMethod: "MOMENTUM",
          constraints: { maximumOpenPositions: 2, maximumPositionPercent: 45, maximumSectorExposurePercent: 60 },
          symbolSectors: { AAA: "IT", BBB: "IT", CCC: "BANK" },
        });
      let tradesSeen = 0;
      for (let k = 0; k < 8; k++) {
        const symbolCandles = { AAA: randomWalk("AAA", 140, random), BBB: randomWalk("BBB", 140, random), CCC: randomWalk("CCC", 140, random) };
        const full = runOn(symbolCandles);
        tradesSeen += full.tradeCount;
        const cut = 40 + Math.floor(random() * 90);
        const cutTs = new Date(symbolCandles.AAA[cut].ts).getTime();
        const mutated = runOn(Object.fromEntries(Object.entries(symbolCandles).map(([s, c]) => [s, mutateAfter(c, cut, random)])));
        expect(knownBy(mutated.trades, cutTs, false)).toEqual(knownBy(full.trades, cutTs, false));
        expect(pointsBy(mutated.equityCurve, cutTs, false)).toEqual(pointsBy(full.equityCurve, cutTs, false));
        expect(mutated.reproducibilityHash).not.toBe(full.reproducibilityHash);
      }
      expect(tradesSeen).toBeGreaterThan(8);
    });
  }
});
