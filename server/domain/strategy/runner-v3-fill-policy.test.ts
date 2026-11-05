import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { FillPolicy, StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "./runner-v3";

const SIGNAL_BAR = 30;

/** Flat at 100; bar 30 closes at 110 (entry signal); bar 31 opens at 109 and dips to 100. */
function makeCandles(): Candle[] {
  return Array.from({ length: 60 }, (_, i) => {
    let bar = { open: 100, high: 100.5, low: 99.5, close: 100 };
    if (i === SIGNAL_BAR) bar = { open: 100, high: 110.5, low: 99.5, close: 110 };
    if (i === SIGNAL_BAR + 1) bar = { open: 109, high: 109.5, low: 100, close: 101 };
    return {
      symbol: "TEST",
      tf: "1d",
      ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
      ...bar,
      volume: 100_000,
      source: "test",
    };
  });
}

function definition(fillPolicy: FillPolicy, stopLossPercent?: number): StrategyDefinition {
  return {
    name: "breakout",
    direction: "LONG_ONLY",
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{
        kind: "CONDITION", id: "e1",
        left: { kind: "PRICE", field: "CLOSE", lag: 0 },
        operator: "GREATER_THAN",
        right: { kind: "CONSTANT", value: 105 },
      }],
    },
    exit: { kind: "GROUP", id: "exit", combinator: "OR", children: [] },
    risk: { sizingMethod: "FIXED_QUANTITY", sizeValue: 10, stopLossPercent, maximumOpenPositions: 1, allowPyramiding: false },
    execution: { fillPolicy, intrabarPolicy: "CONSERVATIVE", feeModel: "NONE", slippageBps: 0, initialCapital: 100_000 },
  };
}

describe("runBacktestV3 — fill policy and entry-bar risk checks", () => {
  it("NEXT_BAR_OPEN checks the stop against the rest of the entry bar", () => {
    const result = runBacktestV3({
      strategyVersionId: "entry-bar-stop",
      definition: definition("NEXT_BAR_OPEN", 5),
      symbol: "TEST",
      candles: makeCandles(),
    });

    const trade = result.trades[0];
    expect(trade.entryBar).toBe(SIGNAL_BAR + 1);
    expect(trade.entryPrice).toBe(109);
    // Bar 31 trades down to 100 after the 109 open: the 5% stop (103.55) fills on that bar.
    expect(trade.exitBar).toBe(SIGNAL_BAR + 1);
    expect(trade.exitReason).toBe("stop_loss:5%");
    expect(trade.exitPrice).toBeCloseTo(103.55, 10);
  });

  it("ON_CLOSE fills on the signal bar's close", () => {
    const result = runBacktestV3({
      strategyVersionId: "on-close",
      definition: definition("ON_CLOSE"),
      symbol: "TEST",
      candles: makeCandles(),
    });

    const trade = result.trades[0];
    expect(trade.entrySignalBar).toBe(SIGNAL_BAR);
    expect(trade.entryBar).toBe(SIGNAL_BAR);
    expect(trade.entryPrice).toBe(110);
    expect(result.executionPolicy).toBe("ON_CLOSE");
  });
});
