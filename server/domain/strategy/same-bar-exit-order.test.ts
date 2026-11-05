/**
 * Order of events within one bar under NEXT_BAR_OPEN: orders decided on bar i-1 (exit rules)
 * fill at bar i's open, before anything the rest of the bar can trigger (stops, targets); and a
 * position closed during bar i cannot be reopened at bar i's open, which has already passed.
 */
import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "./runner-v3";
import { runPortfolioBacktestEngine } from "./portfolio-engine";

/** Flat at 100; bar 55 closes at 98 (exit-rule signal); bar 56 opens at 100 and trades up to 106. */
function makeCandles(): Candle[] {
  return Array.from({ length: 60 }, (_, i) => {
    let bar = { open: 100, high: 100.5, low: 99.5, close: 100 };
    if (i === 55) bar = { open: 100, high: 100.5, low: 97.5, close: 98 };
    if (i === 56) bar = { open: 100, high: 106, low: 99.5, close: 100 };
    return { symbol: "AAA", tf: "1d", ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), ...bar, volume: 1_000_000, source: "test" };
  });
}

function definition(withExitRule: boolean): StrategyDefinition {
  return {
    name: "same-bar",
    direction: "LONG_ONLY",
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{ kind: "CONDITION", id: "e1", left: { kind: "PRICE", field: "CLOSE" }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 0 } }],
    },
    exit: {
      kind: "GROUP", id: "exit", combinator: "OR",
      children: withExitRule
        ? [{ kind: "CONDITION", id: "x1", left: { kind: "PRICE", field: "CLOSE" }, operator: "LESS_THAN", right: { kind: "CONSTANT", value: 99 } }]
        : [],
    },
    risk: { sizingMethod: "FIXED_QUANTITY", sizeValue: 10, takeProfitPercent: 5, maximumOpenPositions: 1, allowPyramiding: false },
    execution: {
      fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "NONE", slippageBps: 0,
      spreadModel: "NONE", marketImpactModel: "NONE", maxParticipationRate: 1, initialCapital: 100_000,
    },
  };
}

const bar56 = Date.UTC(2024, 0, 57);

describe("exit rule fills at the open before stops and targets", () => {
  it("runner-v3", () => {
    const result = runBacktestV3({ strategyVersionId: "x", definition: definition(true), symbol: "AAA", candles: makeCandles() });
    const exit = result.trades.find((t) => t.exitTimestamp === bar56);
    expect(exit?.exitReason).toBe("exit_rule");
    expect(exit?.exitPrice).toBe(100);
  });

  it("portfolio engine", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "x", definition: definition(true), symbolCandles: { AAA: makeCandles() }, initialCapital: 100_000,
      constraints: { maximumPositionPercent: 100 },
    });
    const exit = result.trades.find((t) => t.exitTimestamp === bar56);
    expect(exit?.exitReason).toBe("exit_rule");
    expect(exit?.exitPrice).toBe(100);
  });
});

describe("a symbol closed during a bar is not reopened on that bar", () => {
  it("portfolio engine takes profit once on bar 56 and re-enters on bar 57", () => {
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "x", definition: definition(false), symbolCandles: { AAA: makeCandles() }, initialCapital: 100_000,
      constraints: { maximumPositionPercent: 100 },
    });
    expect(result.trades.filter((t) => t.exitTimestamp === bar56)).toHaveLength(1);
    expect(result.trades.every((t) => t.entryTimestamp !== bar56)).toBe(true);
  });
});


describe("portfolio engine fill policy", () => {
  it("ON_CLOSE fills on the signal bar's close", () => {
    const base = definition(false);
    const dipBuyer: StrategyDefinition = {
      ...base,
      entry: {
        kind: "GROUP", id: "entry", combinator: "AND",
        children: [{ kind: "CONDITION", id: "e1", left: { kind: "PRICE", field: "CLOSE" }, operator: "LESS_THAN", right: { kind: "CONSTANT", value: 99 } }],
      },
      execution: { ...base.execution!, fillPolicy: "ON_CLOSE" },
    };
    const result = runPortfolioBacktestEngine({
      strategyVersionId: "x", definition: dipBuyer, symbolCandles: { AAA: makeCandles() }, initialCapital: 100_000,
      constraints: { maximumPositionPercent: 100 },
    });
    expect(result.trades[0].entryTimestamp).toBe(Date.UTC(2024, 0, 56));
    expect(result.trades[0].entryPrice).toBe(98);
  });
});