/**
 * Look-ahead bias detector tests.
 * Verifies that the detector catches future data dependency.
 */

import { describe, expect, it } from "bun:test";
import { testLookAhead } from "./look-ahead-detector";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "./runner-v3";

// ============================================================
// Helpers
// ============================================================

function makePriceCandles(n: number, startPrice = 1000): Candle[] {
  return Array.from({ length: n }, (_, i) => ({
    symbol: "TEST",
    tf: "1d" as const,
    ts: new Date(Date.UTC(2022, 0, i + 1)).toISOString(),
    open: startPrice + i,
    high: startPrice + i + 5,
    low: startPrice + i - 5,
    close: startPrice + i,
    volume: 100_000,
    source: "test",
  }));
}

const DEFINITION: StrategyDefinition = {
  name: "LA Test",
  direction: "LONG_ONLY",
  universe: { type: "SINGLE_SYMBOL", symbolOrId: "TEST" },
  timeframe: "1d",
  entry: {
    kind: "GROUP", id: "entry", combinator: "AND",
    children: [{
      kind: "CONDITION", id: "c1",
      left: { kind: "INDICATOR", indicator: "SMA", params: { period: 5 } },
      operator: "GREATER_THAN",
      right: { kind: "INDICATOR", indicator: "SMA", params: { period: 10 } },
    }],
  },
  exit: {
    kind: "GROUP", id: "exit", combinator: "AND",
    children: [{
      kind: "CONDITION", id: "c2",
      left: { kind: "INDICATOR", indicator: "SMA", params: { period: 5 } },
      operator: "LESS_THAN",
      right: { kind: "INDICATOR", indicator: "SMA", params: { period: 10 } },
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

// ============================================================
// Tests
// ============================================================

describe("Look-Ahead Bias Detector", () => {
  it("1. V3 engine passes look-ahead test on trending data", () => {
    const candles = makePriceCandles(200);

    const runFn = (c: Candle[], def: StrategyDefinition) => {
      const result = runBacktestV3({ strategyVersionId: "test", definition: def, symbol: "TEST", candles: c });
      return result.trades.map((t) => t.entrySignalTimestamp);
    };

    const laResult = testLookAhead(candles, DEFINITION, runFn);
    expect(laResult.passed).toBe(true);
  });

  it("2. V3 engine passes look-ahead test on noisy data", () => {
    const candles = Array.from({ length: 200 }, (_, i) => ({
      symbol: "TEST",
      tf: "1d" as const,
      ts: new Date(Date.UTC(2022, 0, i + 1)).toISOString(),
      open: 1000 + Math.sin(i) * 50,
      high: 1010 + Math.sin(i) * 55,
      low: 990 + Math.sin(i) * 45,
      close: 1000 + Math.cos(i * 1.3) * 60,
      volume: 100_000,
      source: "test",
    }));

    const runFn = (c: Candle[], def: StrategyDefinition) => {
      const result = runBacktestV3({ strategyVersionId: "test", definition: def, symbol: "TEST", candles: c });
      return result.trades.map((t) => t.entrySignalTimestamp);
    };

    const laResult = testLookAhead(candles, DEFINITION, runFn);
    expect(laResult.passed).toBe(true);
  });

  it("3. Signal timestamps are strictly at or before bar pivot", () => {
    const candles = makePriceCandles(200);
    const result = runBacktestV3({ strategyVersionId: "test", definition: DEFINITION, symbol: "TEST", candles });

    for (const trade of result.trades) {
      // entrySignalTimestamp must be at or before entryTimestamp
      expect(trade.entrySignalTimestamp).toBeLessThanOrEqual(trade.entryTimestamp);
    }
  });

  it("4. Entry signal bar < fill bar (no same-bar fill)", () => {
    const candles = makePriceCandles(200);
    const result = runBacktestV3({ strategyVersionId: "test", definition: DEFINITION, symbol: "TEST", candles });

    for (const trade of result.trades) {
      // NEXT_BAR_OPEN: signal on bar N, fill on bar N+1
      expect(trade.entrySignalBar).toBeLessThan(trade.entryBar);
    }
  });

  it("5. Indicator cache does not expose future close at barIndex", () => {
    const candles = makePriceCandles(50);
    const { IndicatorStateCache } = require("./indicator-state");
    const cache = new IndicatorStateCache(candles);

    for (let i = 0; i < 40; i++) {
      // Resolve with lag=-1 should return null (negative lag rejected)
      const futureVal = cache.resolvePrice("CLOSE", i, -1);
      expect(futureVal).toBeNull();
    }
  });
});
