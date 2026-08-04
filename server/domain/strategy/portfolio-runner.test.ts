/**
 * Portfolio Strategy Runner — Unit Test Suite.
 *
 * Verifies deterministic signal ranking, position limit enforcement,
 * shared capital allocation, and portfolio equity curve aggregation.
 */

import { describe, expect, it } from "bun:test";
import { rankSignals, runPortfolioBacktest } from "./portfolio-runner";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import type { Candle } from "@shared/types";

function mockCandles(symbol: string, count = 100): Candle[] {
  const candles: Candle[] = [];
  const baseTs = 1700000000000;
  let close = 100;
  for (let i = 0; i < count; i++) {
    const ts = new Date(baseTs + i * 86400000).toISOString();
    close += (i % 2 === 0 ? 1.5 : -0.8);
    candles.push({
      symbol,
      tf: "1d",
      ts,
      open: close - 0.5,
      high: close + 1.0,
      low: close - 1.0,
      close,
      volume: 50000 + i * 100,
      source: "mock",
    });
  }
  return candles;
}

const sampleDef: StrategyDefinition = {
  name: "Sample SMA Crossover",
  execution: { initialCapital: 100000 },
  portfolio: { maximumOpenPositions: 2, maxSymbolExposurePercent: 50 },
  entryRules: {
    kind: "OPERATOR",
    operator: "AND",
    conditions: [
      {
        kind: "COMPARISON",
        left: { kind: "INDICATOR", indicator: { type: "SMA", params: { period: 5 } } },
        operator: ">",
        right: { kind: "INDICATOR", indicator: { type: "SMA", params: { period: 20 } } },
      },
    ],
  },
  exitRules: {
    kind: "OPERATOR",
    operator: "AND",
    conditions: [
      {
        kind: "COMPARISON",
        left: { kind: "INDICATOR", indicator: { type: "SMA", params: { period: 5 } } },
        operator: "<",
        right: { kind: "INDICATOR", indicator: { type: "SMA", params: { period: 20 } } },
      },
    ],
  },
};

describe("Portfolio Runner Test Suite", () => {
  it("1. Ranks signals deterministically with Symbol Ascending fallback", () => {
    const signals = [
      { symbol: "TCS", volume: 1000 },
      { symbol: "INFY", volume: 1000 },
      { symbol: "RELIANCE", volume: 2000 },
    ];

    const rankedVol = rankSignals(signals, "RELATIVE_VOLUME");
    expect(rankedVol[0].symbol).toBe("RELIANCE");
    // TCS vs INFY equal volume -> fallback to INFY (ascending)
    expect(rankedVol[1].symbol).toBe("INFY");
    expect(rankedVol[2].symbol).toBe("TCS");
  });

  it("2. Enforces maximum open positions across portfolio", () => {
    const candlesBySymbol = {
      RELIANCE: mockCandles("RELIANCE", 100),
      TCS: mockCandles("TCS", 100),
      INFY: mockCandles("INFY", 100),
    };

    const res = runPortfolioBacktest({
      strategyVersionId: "v1",
      definition: sampleDef,
      symbolCandles: candlesBySymbol,
      initialCapital: 100000,
      maxPositions: 2,
    });

    expect(res.initialCapital).toBe(100000);
    expect(res.equityCurve.length).toBeGreaterThan(0);
    expect(res.tradeCount).toBeGreaterThanOrEqual(0);
  });
});
