/**
 * runner-v3 risk gates and solvency:
 * - equity at or below zero stops trading; no return is ever scored on a non-positive base;
 * - maximumDrawdownPercent flattens and stops trading;
 * - maximumDailyLossPercent flattens and blocks entries for the rest of the IST day;
 * - settings the engine does not implement are reported, not silently ignored.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition, StrategyRiskConfig } from "../../../shared/strategy/ast";
import { computeReturns } from "../backtest/risk-metrics";
import { runBacktestV3, type V3BacktestRunResult } from "./runner-v3";

const DAY = 86_400_000;
const HOUR = 3_600_000;
/** 2024-01-01 09:15 IST. */
const SESSION_OPEN = Date.UTC(2024, 0, 1, 3, 45);

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

/** Bars whose open is the previous close, so the only gap risk is the one a test builds in. */
function candlesFromCloses(closes: number[], timestamp: (i: number) => number = (i) => SESSION_OPEN + i * DAY, tf = "1d"): Candle[] {
  return closes.map((close, i) => {
    const open = i === 0 ? close : closes[i - 1];
    return {
      symbol: "TEST", tf, ts: new Date(timestamp(i)).toISOString(),
      open, high: Math.max(open, close), low: Math.min(open, close), close, volume: 1_000_000, source: "test",
    };
  });
}

function alwaysIn(direction: "LONG_ONLY" | "SHORT_ONLY" | "LONG_SHORT", risk: Partial<StrategyRiskConfig> = {}): StrategyDefinition {
  return {
    name: "always-in",
    direction,
    entry: {
      kind: "GROUP", id: "e", combinator: "AND",
      children: [{ kind: "CONDITION", id: "e1", left: { kind: "PRICE", field: "CLOSE", lag: 0 }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 0 } }],
    },
    exit: { kind: "GROUP", id: "x", combinator: "OR", children: [] },
    risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false, ...risk },
    execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "NONE", slippageBps: 0, initialCapital: 100_000 },
  };
}

function run(definition: StrategyDefinition, candles: Candle[], timeframe = "1d"): V3BacktestRunResult {
  return runBacktestV3({ strategyVersionId: "gates", definition, symbol: "TEST", candles, timeframe });
}

/** Once the curve reaches a non-positive value it never moves again. */
function expectNoReturnOnNonPositiveBase(equity: number[]) {
  const returns = computeReturns(equity);
  for (let i = 1; i < equity.length; i++) {
    if (equity[i - 1] <= 0) {
      expect(equity[i]).toBe(equity[i - 1]);
      expect(returns[i - 1] === 0).toBe(true);
    }
  }
}

describe("runner-v3 — equity depletion halts trading", () => {
  it("a 100% short that rallies 100 -> 250 is closed at the first non-positive mark and nothing is scored after it", () => {
    // Flat at 100, rally +15 per bar to 250, then keep rising: each later bar would be a -10k move.
    const closes = [
      ...Array.from({ length: 10 }, () => 100),
      ...Array.from({ length: 10 }, (_, i) => 115 + 15 * i),
      ...Array.from({ length: 40 }, (_, i) => 260 + 10 * i),
    ];
    const result = run(alwaysIn("SHORT_ONLY"), candlesFromCloses(closes));
    const equity = result.equityCurve.map((p) => p.equity);

    expect(result.trades).toHaveLength(1);
    const [trade] = result.trades;
    expect(trade.direction).toBe("short");
    expect(trade.quantity).toBe(1_000);
    expect(trade.exitReason).toBe("equity_depleted");
    expect(trade.exitPrice).toBe(205); // first close where 100k + 1000 x (100 - close) <= 0
    expect(equity.at(-1)).toBe(-5_000);
    expectNoReturnOnNonPositiveBase(equity);
    expect(result.metrics.totalReturn).toBeLessThanOrEqual(-1);
    expect(result.warnings.some((w) => w.startsWith("TRADING_HALTED"))).toBe(true);
  });

  it("never scores a return on a non-positive equity base (property, long and short, 100% sizing)", () => {
    const random = prng(424242);
    let depleted = 0;
    for (let k = 0; k < 60; k++) {
      let price = 100;
      const closes = Array.from({ length: 80 }, () => (price = Math.max(1, price * (1 + (random() - 0.45) * 0.3))));
      const direction = k % 2 === 0 ? "SHORT_ONLY" : "LONG_ONLY";
      const result = run(alwaysIn(direction), candlesFromCloses(direction === "LONG_ONLY" ? closes.map((c) => 200 - Math.min(c, 199)) : closes));
      const equity = result.equityCurve.map((p) => p.equity);
      expectNoReturnOnNonPositiveBase(equity);
      const ruin = equity.findIndex((e) => e <= 0);
      if (ruin >= 0) {
        depleted++;
        const ruinTs = result.equityCurve[ruin].timestamp;
        expect(result.trades.every((t) => t.entryTimestamp <= ruinTs)).toBe(true);
      }
    }
    expect(depleted).toBeGreaterThan(0);
  });
});

describe("runner-v3 — maximumDrawdownPercent", () => {
  // Long from bar 1 at 100; falls 2% a bar from bar 10, then recovers strongly.
  const closes = [
    ...Array.from({ length: 10 }, () => 100),
    ...Array.from({ length: 10 }, (_, i) => 100 * 0.98 ** (i + 1)),
    ...Array.from({ length: 40 }, (_, i) => 82 + 2 * i),
  ];
  const candles = candlesFromCloses(closes);

  it("closes at the first close at or beyond the limit and never trades again", () => {
    const result = run(alwaysIn("LONG_ONLY", { maximumDrawdownPercent: 10 }), candles);
    expect(result.trades).toHaveLength(1);
    const [trade] = result.trades;
    expect(trade.exitReason).toBe("max_drawdown");
    // 0.98^5 = 0.9039 (9.6% down), 0.98^6 = 0.8858 (11.4% down): the sixth falling bar.
    expect(trade.exitBar).toBe(15);
    const exitIdx = result.equityCurve.findIndex((p) => p.timestamp === trade.exitTimestamp);
    const after = result.equityCurve.slice(exitIdx).map((p) => p.equity);
    expect(new Set(after).size).toBe(1);
    expect(result.warnings.some((w) => w.includes("maximumDrawdownPercent"))).toBe(true);
  });

  it("does nothing when the drawdown stays inside the limit", () => {
    const limited = run(alwaysIn("LONG_ONLY", { maximumDrawdownPercent: 30 }), candles);
    const free = run(alwaysIn("LONG_ONLY"), candles);
    expect(limited.trades).toEqual(free.trades);
    expect(limited.equityCurve).toEqual(free.equityCurve);
  });
});

describe("runner-v3 — maximumDailyLossPercent", () => {
  it("daily bars: flattens on the losing day and re-enters the next day", () => {
    const closes = [...Array.from({ length: 20 }, () => 100), 92, ...Array.from({ length: 39 }, () => 92)];
    const result = run(alwaysIn("LONG_ONLY", { maximumDailyLossPercent: 5 }), candlesFromCloses(closes));
    expect(result.trades.length).toBeGreaterThanOrEqual(2);
    const [first, second] = result.trades;
    expect(first.exitReason).toBe("daily_loss_limit");
    expect(first.exitBar).toBe(20);
    expect(second.entryBar).toBe(21);
    expect(result.warnings.some((w) => w.startsWith("DAILY_LOSS_LIMIT"))).toBe(true);

    const looser = run(alwaysIn("LONG_ONLY", { maximumDailyLossPercent: 10 }), candlesFromCloses(closes));
    expect(looser.trades).toHaveLength(1);
    expect(looser.trades[0].exitReason).toBe("end_of_period");
  });

  it("hourly bars: blocks entries for the rest of the IST day, then resumes at the next session", () => {
    const BARS_PER_DAY = 6;
    const timestamp = (i: number) => SESSION_OPEN + Math.floor(i / BARS_PER_DAY) * DAY + (i % BARS_PER_DAY) * HOUR;
    const lossBar = 5 * BARS_PER_DAY + 2; // third bar of day 6
    const closes = Array.from({ length: 12 * BARS_PER_DAY }, (_, i) => (i < lossBar ? 100 : 93));
    const result = run(alwaysIn("LONG_ONLY", { maximumDailyLossPercent: 5 }), candlesFromCloses(closes, timestamp, "1h"), "1h");

    const [first, second] = result.trades;
    expect(first.exitReason).toBe("daily_loss_limit");
    expect(first.exitBar).toBe(lossBar);
    // The entry rule is true on every bar, yet nothing enters until the next day's first bar.
    expect(second.entryBar).toBe(6 * BARS_PER_DAY);
  });
});

describe("runner-v3 — unsupported settings are reported", () => {
  const closes = Array.from({ length: 60 }, (_, i) => 100 + i);

  it("LONG_SHORT trades long only and says so", () => {
    const result = run(alwaysIn("LONG_SHORT"), candlesFromCloses(closes));
    expect(result.trades.every((t) => t.direction === "long")).toBe(true);
    expect(result.warnings.some((w) => w.includes("direction") && w.includes("LONG_SHORT"))).toBe(true);
  });

  it("pyramiding and ATR stops on a stored definition produce warnings", () => {
    const result = run(alwaysIn("LONG_ONLY", { allowPyramiding: true, maximumPyramids: 3, atrStopMultiplier: 2 }), candlesFromCloses(closes));
    for (const path of ["risk.allowPyramiding", "risk.maximumPyramids", "risk.atrStopMultiplier"]) {
      expect(result.warnings.some((w) => w.includes(path))).toBe(true);
    }
  });

  it("a supported definition has no such warnings", () => {
    const result = run(alwaysIn("LONG_ONLY", { maximumDrawdownPercent: 50, maximumDailyLossPercent: 20 }), candlesFromCloses(closes));
    expect(result.warnings.filter((w) => w.startsWith("UNSUPPORTED_SETTING_IGNORED"))).toEqual([]);
  });
});
