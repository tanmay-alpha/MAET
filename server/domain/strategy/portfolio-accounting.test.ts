/**
 * Cash, cost and short-side invariants for the shared-capital portfolio engine.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition, StrategyExecutionConfig, StrategyRiskConfig } from "../../../shared/strategy/ast";
import { runPortfolioBacktestEngine, type PortfolioTradeRecord } from "./portfolio-engine";

function makeCandles(symbol: string, length: number, startPrice: number, growthPerBar: number): Candle[] {
  return Array.from({ length }, (_, i) => {
    const price = startPrice * (1 + growthPerBar) ** i;
    return {
      symbol,
      tf: "1d",
      ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      open: price,
      high: price * 1.004,
      low: price * 0.996,
      close: price,
      volume: 1_000_000,
      source: "test",
    };
  });
}

const ZERO_COST: StrategyExecutionConfig = {
  fillPolicy: "NEXT_BAR_OPEN",
  intrabarPolicy: "CONSERVATIVE",
  feeModel: "NONE",
  slippageBps: 0,
  spreadModel: "NONE",
  marketImpactModel: "NONE",
  maxParticipationRate: 1,
  initialCapital: 100_000,
};

function alwaysEnter(
  direction: "LONG_ONLY" | "SHORT_ONLY",
  risk: Partial<StrategyRiskConfig>,
  execution: StrategyExecutionConfig = ZERO_COST,
): StrategyDefinition {
  return {
    name: "always-enter",
    direction,
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{
        kind: "CONDITION", id: "e1",
        left: { kind: "PRICE", field: "CLOSE", lag: 0 },
        operator: "GREATER_THAN",
        right: { kind: "CONSTANT", value: 0 },
      }],
    },
    exit: { kind: "GROUP", id: "exit", combinator: "OR", children: [] },
    risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 5, allowPyramiding: false, ...risk },
    execution,
  };
}

const sign = (t: PortfolioTradeRecord) => (t.direction === "long" ? 1 : -1);

function openNotionalAt(trades: PortfolioTradeRecord[], ts: number): number {
  return trades
    .filter((t) => t.entryTimestamp <= ts && t.exitTimestamp > ts)
    .reduce((s, t) => s + t.quantity * t.entryPrice, 0);
}

describe("portfolio engine — transaction cost accounting", () => {
  const costly: StrategyExecutionConfig = {
    ...ZERO_COST,
    feeModel: "FIXED_BPS",
    feeBps: 10,
    slippageBps: 5,
    spreadModel: "FIXED_BPS",
    baseSpreadBps: 10,
    marketImpactModel: "SQUARE_ROOT",
    impactCoefficient: 10,
  };

  it("charges spread, slippage and impact once: they are already in the fill prices", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "costs",
      definition: alwaysEnter("LONG_ONLY", { takeProfitPercent: 2 }, costly),
      symbolCandles: { AAA: makeCandles("AAA", 60, 100, 0.005) },
      initialCapital: 100_000,
      constraints: { maximumPositionPercent: 100 },
    });

    expect(result.trades.length).toBeGreaterThan(1);
    for (const t of result.trades) {
      const realised = sign(t) * t.quantity * (t.exitPrice - t.entryPrice) - t.fees;
      expect(t.netPnl).toBeCloseTo(realised, 6);
      expect(t.netPnl).toBeCloseTo(t.grossPnl - t.totalCosts, 6);
    }
    const sumNet = result.trades.reduce((s, t) => s + t.netPnl, 0);
    expect(result.finalEquity - result.initialCapital).toBeCloseTo(sumNet, 4);
  });
});

describe("portfolio engine — cash funds every position", () => {
  const symbolCandles = {
    AAA: makeCandles("AAA", 40, 100, 0.001),
    BBB: makeCandles("BBB", 40, 100, 0.001),
    CCC: makeCandles("CCC", 40, 100, 0.001),
  };
  const firstEntryTs = Date.UTC(2024, 0, 2);

  it("never opens more notional than the capital it has (no implicit leverage)", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "no-leverage",
      definition: alwaysEnter("LONG_ONLY", {}),
      symbolCandles,
      initialCapital: 100_000,
      constraints: { maximumOpenPositions: 5, maximumPositionPercent: 50, maximumSectorExposurePercent: 100, maximumGrossExposurePercent: 300 },
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(openNotionalAt(result.trades, firstEntryTs)).toBeLessThanOrEqual(100_000 + 1e-6);
  });

  it("keeps the configured cash reserve uninvested", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "cash-reserve",
      definition: alwaysEnter("LONG_ONLY", {}),
      symbolCandles,
      initialCapital: 100_000,
      constraints: { maximumOpenPositions: 5, maximumPositionPercent: 50, maximumSectorExposurePercent: 100, cashReservePercent: 20 },
    });

    expect(result.trades.length).toBeGreaterThan(0);
    expect(openNotionalAt(result.trades, firstEntryTs)).toBeLessThanOrEqual(80_000 + 1e-6);
  });
});

describe("portfolio engine — short stop and target levels", () => {
  it("stops a short out above the entry price, at a loss", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "short-stop",
      definition: alwaysEnter("SHORT_ONLY", { stopLossPercent: 5 }),
      symbolCandles: { AAA: makeCandles("AAA", 60, 100, 0.01) },
      initialCapital: 100_000,
      constraints: { maximumPositionPercent: 100 },
    });

    const stops = result.trades.filter((t) => t.exitReason === "stop_loss");
    expect(stops.length).toBeGreaterThan(0);
    for (const t of stops) {
      expect(t.direction).toBe("short");
      expect(t.netPnl).toBeLessThan(0);
      expect(t.exitPrice).toBeGreaterThanOrEqual(t.entryPrice * 1.05 - 1e-9);
    }
  });

  it("takes profit on a short below the entry price", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "short-target",
      definition: alwaysEnter("SHORT_ONLY", { takeProfitPercent: 5 }),
      symbolCandles: { AAA: makeCandles("AAA", 60, 100, -0.01) },
      initialCapital: 100_000,
      constraints: { maximumPositionPercent: 100 },
    });

    const targets = result.trades.filter((t) => t.exitReason === "take_profit");
    expect(targets.length).toBeGreaterThan(0);
    for (const t of targets) {
      expect(t.netPnl).toBeGreaterThan(0);
      expect(t.exitPrice).toBeLessThanOrEqual(t.entryPrice * 0.95 + 1e-9);
    }
  });
});
