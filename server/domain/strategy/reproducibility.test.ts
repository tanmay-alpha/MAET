/**
 * Reproducibility tests — same strategy + same candles = identical hash.
 *
 * These tests verify that the deterministic run guarantee holds:
 * 1. Identical inputs → identical runId hash
 * 2. Shuffled candles → same results (runner sorts internally)
 * 3. Modified candles → different dataHash
 */

import { describe, expect, it } from "bun:test";
import { runBacktestV3 } from "./runner-v3";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import type { Candle } from "@shared/types";

// ============================================================
// Test data
// ============================================================

function makeTrendingCandles(n: number): Candle[] {
  const candles: Candle[] = [];
  let price = 1000;
  for (let i = 0; i < n; i++) {
    price = price * (1 + (Math.sin(i * 0.3) * 0.02));
    candles.push({
      symbol: "TEST",
      tf: "1d",
      ts: new Date(Date.UTC(2022, 0, i + 1)).toISOString(),
      open: price - 5,
      high: price + 10,
      low: price - 15,
      close: price,
      volume: 100_000 + i * 1000,
      source: "test",
    });
  }
  return candles;
}

const SMA_CROSS_DEFINITION: StrategyDefinition = {
  name: "Test SMA Cross",
  direction: "LONG_ONLY",
  universe: { type: "SINGLE_SYMBOL", symbolOrId: "TEST" },
  timeframe: "1d",
  entry: {
    kind: "GROUP", id: "entry", combinator: "AND",
    children: [{
      kind: "CONDITION", id: "c1",
      left: { kind: "INDICATOR", indicator: "SMA", params: { period: 10 } },
      operator: "CROSS_ABOVE",
      right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 } },
    }],
  },
  exit: {
    kind: "GROUP", id: "exit", combinator: "AND",
    children: [{
      kind: "CONDITION", id: "c2",
      left: { kind: "INDICATOR", indicator: "SMA", params: { period: 10 } },
      operator: "CROSS_BELOW",
      right: { kind: "INDICATOR", indicator: "SMA", params: { period: 20 } },
    }],
  },
  risk: {
    sizingMethod: "FIXED_CAPITAL",
    sizeValue: 100_000,
    maximumOpenPositions: 1,
    allowPyramiding: false,
  },
  execution: {
    fillPolicy: "NEXT_BAR_OPEN",
    intrabarPolicy: "CONSERVATIVE",
    feeModel: "NONE",
    initialCapital: 1_000_000,
  },
};

const STRATEGY_VERSION_ID = "00000000-0000-0000-0000-000000000001";

// ============================================================
// Reproducibility tests
// ============================================================

describe("Backtest Engine V3 — Reproducibility", () => {
  it("1. Same candles × same definition → identical dataHash", () => {
    const candles = makeTrendingCandles(100);

    const r1 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });
    const r2 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });

    expect(r1.dataHash).toBe(r2.dataHash);
  });

  it("2. Same candles → same trade count", () => {
    const candles = makeTrendingCandles(100);

    const r1 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });
    const r2 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });

    expect(r1.tradeCount).toBe(r2.tradeCount);
  });

  it("3. Same candles → same equity curve endpoint", () => {
    const candles = makeTrendingCandles(100);

    const r1 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });
    const r2 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });

    const lastEquity1 = r1.equityCurve[r1.equityCurve.length - 1]?.equity ?? 0;
    const lastEquity2 = r2.equityCurve[r2.equityCurve.length - 1]?.equity ?? 0;
    expect(lastEquity1).toBeCloseTo(lastEquity2, 4);
  });

  it("4. Shuffled input candles → same result (runner sorts internally)", () => {
    const candles = makeTrendingCandles(100);
    const shuffled = [...candles].sort(() => Math.random() - 0.5);

    const r1 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });
    const r2 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles: shuffled });

    expect(r1.tradeCount).toBe(r2.tradeCount);
    expect(r1.dataHash).toBe(r2.dataHash);
  });

  it("5. Modified candle → different dataHash", () => {
    const candles = makeTrendingCandles(100);
    const modified = candles.map((c, i) =>
      i === 50 ? { ...c, close: c.close * 1.5 } : c,
    );

    const r1 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });
    const r2 = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles: modified });

    expect(r1.dataHash).not.toBe(r2.dataHash);
  });

  it("6. Engine version is stamped on result", () => {
    const candles = makeTrendingCandles(60);
    const result = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });
    expect(result.engineVersion).toMatch(/^\d+\.\d+\.\d+$/);
    expect(result.indicatorVersion).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it("7. Insufficient history throws InsufficientHistoryV3Error", () => {
    const candles = makeTrendingCandles(10);
    expect(() => runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles }))
      .toThrow("Insufficient history");
  });

  it("8. NEXT_BAR_OPEN: signal bar index < fill bar index for all trades", () => {
    const candles = makeTrendingCandles(200);
    const result = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });

    for (const trade of result.trades) {
      expect(trade.entrySignalBar).toBeLessThan(trade.entryBar);
    }
  });

  it("9. No trades generate NaN equity values", () => {
    const candles = makeTrendingCandles(100);
    const result = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: SMA_CROSS_DEFINITION, symbol: "TEST", candles });

    for (const point of result.equityCurve) {
      expect(isFinite(point.equity)).toBe(true);
      expect(isNaN(point.equity)).toBe(false);
    }
  });

  it("10. Net PnL = Gross PnL - Fees - Slippage for all trades", () => {
    const candles = makeTrendingCandles(200);
    const defWithFees: StrategyDefinition = {
      ...SMA_CROSS_DEFINITION,
      execution: { ...SMA_CROSS_DEFINITION.execution, feeModel: "FIXED_BPS", feeBps: 10, slippageBps: 5 },
    };
    const result = runBacktestV3({ strategyVersionId: STRATEGY_VERSION_ID, definition: defWithFees, symbol: "TEST", candles });

    for (const trade of result.trades) {
      expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.fees - trade.slippage, 2);
    }
  });
});
