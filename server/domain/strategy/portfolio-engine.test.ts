import { describe, it, expect } from "bun:test";
import {
  runPortfolioBacktestEngine,
  rankCandidates,
  type PortfolioEngineInput,
} from "./portfolio-engine";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

function makeCandles(symbol: string, length = 60, startPrice = 100, trend = 0.5): Candle[] {
  return Array.from({ length }, (_, i) => {
    const d = new Date("2024-01-01T09:15:00.000Z");
    d.setDate(d.getDate() + i);
    const price = startPrice + i * trend;
    return {
      symbol,
      tf: "1d",
      ts: d.toISOString(),
      open: price,
      high: price + 2,
      low: price - 2,
      close: price,
      volume: 100_000,
      source: "test",
    };
  });
}

function makeAlwaysEnterStrategy(): StrategyDefinition {
  return {
    name: "AlwaysEnterTest",
    direction: "LONG_ONLY",
    entry: {
      kind: "GROUP",
      id: "entry",
      combinator: "AND",
      children: [
        {
          kind: "CONDITION",
          id: "e1",
          left: { kind: "PRICE", field: "CLOSE", lag: 0 },
          operator: "GREATER_THAN",
          right: { kind: "CONSTANT", value: 10 },
        },
      ],
    },
    exit: {
      kind: "GROUP",
      id: "exit",
      combinator: "OR",
      children: [],
    },
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: 50, // 50% of available equity per trade
      maximumOpenPositions: 2,
      allowPyramiding: false,
    },
    execution: {
      fillPolicy: "NEXT_BAR_OPEN",
      intrabarPolicy: "CONSERVATIVE",
      feeModel: "NONE",
      feeBps: 0,
      slippageBps: 0,
      initialCapital: 100_000,
    },
  };
}

describe("P2 Shared Capital Portfolio Engine (Commit 5)", () => {
  it("1. Deterministic ranking: sorts candidates by MOMENTUM, RELATIVE_VOLUME, or SYMBOL", () => {
    const candidates = [
      { symbol: "TCS", momentum: 0.05, volume: 10_000 },
      { symbol: "INFY", momentum: 0.12, volume: 50_000 },
      { symbol: "RELIANCE", momentum: 0.08, volume: 30_000 },
    ];

    // By momentum descending
    const byMomentum = rankCandidates(candidates, "MOMENTUM");
    expect(byMomentum[0].symbol).toBe("INFY");
    expect(byMomentum[1].symbol).toBe("RELIANCE");
    expect(byMomentum[2].symbol).toBe("TCS");

    // By symbol ascending (deterministic tie-breaker)
    const bySymbol = rankCandidates(candidates, "SYMBOL_ASCENDING");
    expect(bySymbol[0].symbol).toBe("INFY");
    expect(bySymbol[1].symbol).toBe("RELIANCE");
    expect(bySymbol[2].symbol).toBe("TCS");
  });

  it("2. Shared capital: symbols compete for cash; capital is not double spent", () => {
    const tcsCandles = makeCandles("TCS", 60, 100, 1);
    const infyCandles = makeCandles("INFY", 60, 200, 1);

    const input: PortfolioEngineInput = {
      strategyVersionId: "test-shared-cap",
      definition: makeAlwaysEnterStrategy(),
      symbolCandles: {
        TCS: tcsCandles,
        INFY: infyCandles,
      },
      initialCapital: 100_000,
      constraints: {
        maximumOpenPositions: 2,
        maximumPositionPercent: 50,
      },
      symbolSectors: {
        TCS: "IT",
        INFY: "IT",
      },
    };

    const result = runPortfolioBacktestEngine(input);

    expect(result.trades.length).toBeGreaterThanOrEqual(1);
    expect(result.initialCapital).toBe(100_000);

    // Continuous equity must never be negative
    for (const pt of result.equityCurve) {
      expect(pt.equity).toBeGreaterThan(0);
    }

    // Capital reconciliation: finalEquity - initialCapital == sum(netPnl)
    const sumPnl = result.trades.reduce((s, t) => s + t.netPnl, 0);
    expect(result.finalEquity - result.initialCapital).toBeCloseTo(sumPnl, 2);
  });

  it("3. Portfolio performance attribution: tracks PnL by symbol, sector, and month", () => {
    const tcsCandles = makeCandles("TCS", 60, 100, 1); // profitable
    const infyCandles = makeCandles("INFY", 60, 200, -1); // losing

    const input: PortfolioEngineInput = {
      strategyVersionId: "test-attrib",
      definition: makeAlwaysEnterStrategy(),
      symbolCandles: {
        TCS: tcsCandles,
        INFY: infyCandles,
      },
      initialCapital: 100_000,
      symbolSectors: {
        TCS: "TECH",
        INFY: "TECH",
      },
    };

    const result = runPortfolioBacktestEngine(input);

    expect(result.attribution.pnlBySymbol["TCS"]).toBeDefined();
    expect(result.attribution.pnlBySymbol["INFY"]).toBeDefined();
    expect(result.attribution.pnlBySector["TECH"]).toBeDefined();

    // Total net PnL matches sum of symbol attributions
    const sumAttribNetPnl =
      result.attribution.pnlBySymbol["TCS"].netPnl + result.attribution.pnlBySymbol["INFY"].netPnl;
    expect(result.netPnl).toBeCloseTo(sumAttribNetPnl, 2);
  });
});
