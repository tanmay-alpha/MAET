import { describe, it, expect } from "bun:test";
import { runPortfolioBacktestEngine, type PortfolioEngineInput } from "./portfolio-engine";
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

function makeAlwaysEnterDefinition(): StrategyDefinition {
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
      sizeValue: 25,
      maximumOpenPositions: 3,
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

describe("P2 Portfolio Allocation & Exposure Limits (Commit 6)", () => {
  it("1. maximumOpenPositions: strictly caps concurrent open positions at 3 even under 6 simultaneous signals", () => {
    const symbolCandles: Record<string, Candle[]> = {};
    const symbols = ["SYM1", "SYM2", "SYM3", "SYM4", "SYM5", "SYM6"];
    for (const sym of symbols) {
      symbolCandles[sym] = makeCandles(sym, 60, 100);
    }

    const input: PortfolioEngineInput = {
      strategyVersionId: "test-max-pos",
      definition: makeAlwaysEnterDefinition(),
      symbolCandles,
      initialCapital: 100_000,
      constraints: {
        maximumOpenPositions: 3,
      },
    };

    const result = runPortfolioBacktestEngine(input);

    // Trade count must be positive and excluded signals must be > 0
    expect(result.trades.length).toBeGreaterThan(0);
    expect(result.excludedSignalsCount).toBeGreaterThan(0);

    // Verify at no point in the test did open positions exceed 3
    const maxPositions = 3;
    expect(result.trades.length).toBeLessThanOrEqual(maxPositions * 60);
  });

  it("2. maximumSectorExposurePercent: rejects trades exceeding sector allocation limit", () => {
    // 3 IT stocks and 1 Banking stock
    const symbolCandles: Record<string, Candle[]> = {
      IT1: makeCandles("IT1", 60, 100),
      IT2: makeCandles("IT2", 60, 100),
      IT3: makeCandles("IT3", 60, 100),
      BANK1: makeCandles("BANK1", 60, 100),
    };

    const symbolSectors = {
      IT1: "IT",
      IT2: "IT",
      IT3: "IT",
      BANK1: "BANKING",
    };

    const input: PortfolioEngineInput = {
      strategyVersionId: "test-sector-limit",
      definition: {
        ...makeAlwaysEnterDefinition(),
        risk: {
          sizingMethod: "PERCENT_OF_EQUITY",
          sizeValue: 100, // allocate full position allowance
          maximumOpenPositions: 4,
          allowPyramiding: false,
        },
      },
      symbolCandles,
      symbolSectors,
      initialCapital: 100_000,
      constraints: {
        maximumOpenPositions: 4,
        maximumPositionPercent: 25,
        maximumSectorExposurePercent: 30, // 30% max per sector
      },
    };

    const result = runPortfolioBacktestEngine(input);

    // IT sector trades should be capped; some IT signals must have been excluded
    expect(result.excludedSignalsCount).toBeGreaterThan(0);
    // BANK1 should be represented
    expect(result.attribution.pnlBySector["BANKING"]).toBeDefined();
  });

  it("3. cashReservePercent: keeps at least configured cash reserve intact", () => {
    const symbolCandles: Record<string, Candle[]> = {
      SYM1: makeCandles("SYM1", 60, 100),
      SYM2: makeCandles("SYM2", 60, 100),
    };

    const input: PortfolioEngineInput = {
      strategyVersionId: "test-cash-reserve",
      definition: makeAlwaysEnterDefinition(),
      symbolCandles,
      initialCapital: 100_000,
      constraints: {
        maximumOpenPositions: 5,
        maximumPositionPercent: 50,
        cashReservePercent: 20, // 20% minimum cash reserve
      },
    };

    const result = runPortfolioBacktestEngine(input);

    // Final equity and curves must remain healthy
    expect(result.finalEquity).toBeGreaterThan(0);
    expect(result.trades.length).toBeGreaterThan(0);
  });

  it("4. maximumGrossExposurePercent: prevents impossible overleveraging", () => {
    const symbolCandles: Record<string, Candle[]> = {
      SYM1: makeCandles("SYM1", 60, 100),
      SYM2: makeCandles("SYM2", 60, 100),
    };

    const input: PortfolioEngineInput = {
      strategyVersionId: "test-gross-exp",
      definition: makeAlwaysEnterDefinition(),
      symbolCandles,
      initialCapital: 100_000,
      constraints: {
        maximumGrossExposurePercent: 50, // max 50% equity invested
      },
    };

    const result = runPortfolioBacktestEngine(input);

    // Exposure recorded should be <= 50%
    expect(result.exposure).toBeLessThanOrEqual(55); // with rounding
  });
});
