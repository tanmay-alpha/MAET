/**
 * Execution Model & Gap Handling Test Suite — Backtest Engine V3
 *
 * Tests the 5 core execution invariants:
 * 1. Normal intrabar stop hit fills at stopLevel (plus slippage), NOT candle low.
 * 2. Gap through stop fills at bar open (gap price).
 * 3. Take-profit target hit fills at target level (or open if gapped).
 * 4. Both stop and target touched in the same candle: CONSERVATIVE policy prioritizes stop.
 * 5. Complete LONG and SHORT execution symmetry.
 */

import { describe, it, expect } from "bun:test";
import { runBacktestV3 } from "./runner-v3";
import type { StrategyDefinition } from "@shared/strategy/ast";
import type { Candle } from "@shared/types";

function makeCandle(ts: string, open: number, high: number, low: number, close: number, volume = 100_000): Candle {
  return { symbol: "TEST", tf: "1d", ts, open, high, low, close, volume, source: "test" };
}

function buildBaseSeries(length = 50, price = 100): Candle[] {
  return Array.from({ length }, (_, i) => {
    const d = new Date("2024-01-01T09:15:00.000Z");
    d.setDate(d.getDate() + i);
    return makeCandle(d.toISOString(), price, price + 1, price - 1, price);
  });
}

function makeLongStopDef(stopLossPercent: number, takeProfitPercent?: number): StrategyDefinition {
  return {
    name: "LongStopTest",
    direction: "LONG_ONLY",
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{
        kind: "CONDITION", id: "e1",
        left: { kind: "PRICE", field: "CLOSE", lag: 0 },
        operator: "GREATER_THAN_OR_EQUAL",
        right: { kind: "CONSTANT", value: 100 },
      }],
    },
    exit: {
      kind: "GROUP", id: "exit", combinator: "OR", children: [], // No AST exit rule; relies purely on bracket/intrabar
    },
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: 100,
      maximumOpenPositions: 1,
      stopLossPercent,
      takeProfitPercent,
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

function makeShortStopDef(stopLossPercent: number, takeProfitPercent?: number): StrategyDefinition {
  return {
    name: "ShortStopTest",
    direction: "SHORT_ONLY",
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{
        kind: "CONDITION", id: "e1",
        left: { kind: "PRICE", field: "CLOSE", lag: 0 },
        operator: "LESS_THAN_OR_EQUAL",
        right: { kind: "CONSTANT", value: 100 },
      }],
    },
    exit: {
      kind: "GROUP", id: "exit", combinator: "OR", children: [],
    },
    risk: {
      sizingMethod: "PERCENT_OF_EQUITY",
      sizeValue: 100,
      maximumOpenPositions: 1,
      stopLossPercent,
      takeProfitPercent,
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

describe("Execution Model — Gap & Stop Behavior", () => {
  it("1. Normal intrabar stop hit: fills at stop level (NOT candle low)", () => {
    // 50 base bars @ 100, entries fill on next open @ 100
    const candles = buildBaseSeries(60, 100);

    // Bar 2: entry fills @ 100.
    // Bar 3: open=100, high=102, low=92, close=94. Stop is 5% -> stopLevel = 95.
    // The bar opened at 100 (above stop), dipped to 92.
    // CRITICAL: Fill price MUST be 95 (stopLevel), NOT 92 (candle low)!
    candles[2] = makeCandle(candles[2].ts, 100, 102, 92, 94);

    const def = makeLongStopDef(5); // 5% stop -> 95
    const result = runBacktestV3({
      strategyVersionId: "test-intrabar-stop",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(95); // Fills at stop level (95), NOT 92!
    expect(trade.exitReason).toBe("stop_loss:5%");
  });

  it("2. Gap through stop: bar opens below stop level -> fills at open", () => {
    const candles = buildBaseSeries(60, 100);

    // Bar 2: entry fills @ 100. Stop is 5% -> stopLevel = 95.
    // Bar 3: gapped down! open=90, high=91, low=88, close=89.
    // Market opened at 90, which is below stopLevel 95.
    // Fill price MUST be 90 (bar open), NOT 95 (unachievable gap price) and NOT 88 (low).
    candles[2] = makeCandle(candles[2].ts, 90, 91, 88, 89);

    const def = makeLongStopDef(5);
    const result = runBacktestV3({
      strategyVersionId: "test-gap-stop",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(90); // Fills at open (90) due to gap
    expect(trade.exitReason).toBe("stop_loss:5%");
  });

  it("3. Target hit: fills at target level (or open if gapped)", () => {
    const candles = buildBaseSeries(60, 100);

    // Entry @ 100. Take profit is 10% -> targetLevel = 110.
    // Bar 3: open=102, high=112, low=101, close=111.
    // Opens below target (102), trades through target (high=112).
    // Fill price MUST be 110 (target level), NOT 112 (high).
    candles[2] = makeCandle(candles[2].ts, 102, 112, 101, 111);

    const def = makeLongStopDef(5, 10);
    const result = runBacktestV3({
      strategyVersionId: "test-target-hit",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBeCloseTo(110, 4); // Exactly at target level
    expect(trade.exitReason).toBe("take_profit:10%");
  });

  it("3b. Target gap: opens above target level -> fills at open", () => {
    const candles = buildBaseSeries(60, 100);

    // Entry @ 100. Target is 10% -> 110.
    // Bar 3: gapped up! open=115, high=118, low=114, close=116.
    // Fill price MUST be 115 (open).
    candles[2] = makeCandle(candles[2].ts, 115, 118, 114, 116);

    const def = makeLongStopDef(5, 10);
    const result = runBacktestV3({
      strategyVersionId: "test-target-gap",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.exitPrice).toBe(115);
    expect(trade.exitReason).toBe("take_profit:10%");
  });

  it("4. Both stop and target hit in same candle: CONSERVATIVE policy triggers stop", () => {
    const candles = buildBaseSeries(60, 100);

    // Entry @ 100. Stop = 5% (95), Target = 10% (110).
    // Bar 3: wild bar! open=100, high=115 (target hit!), low=90 (stop hit!), close=105.
    // CONSERVATIVE policy: STOP is evaluated first!
    // Since open was 100, stop level 95 was breached intrabar -> exit at 95.
    candles[2] = makeCandle(candles[2].ts, 100, 115, 90, 105);

    const def = makeLongStopDef(5, 10);
    const result = runBacktestV3({
      strategyVersionId: "test-both-hit",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.exitReason).toBe("stop_loss:5%");
    expect(trade.exitPrice).toBe(95);
  });

  it("5. Long and Short symmetry: normal intrabar short stop hit", () => {
    const candles = buildBaseSeries(60, 100);

    // Short Entry @ 100. Stop is 5% -> stopLevel = 105.
    // Bar 3: open=100, high=108, low=98, close=106.
    // Short stop is at 105. Price went up to 108.
    // Fill price MUST be 105 (stop level), NOT 108 (high)!
    candles[2] = makeCandle(candles[2].ts, 100, 108, 98, 106);

    const def = makeShortStopDef(5);
    const result = runBacktestV3({
      strategyVersionId: "test-short-stop",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.direction).toBe("short");
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(105); // Short stop at 105, NOT 108!
    expect(trade.exitReason).toBe("stop_loss:5%");
  });

  it("5b. Long and Short symmetry: gap through short stop", () => {
    const candles = buildBaseSeries(60, 100);

    // Short Entry @ 100. Stop is 5% -> stopLevel = 105.
    // Bar 3: gapped UP! open=110, high=112, low=109, close=111.
    // Market opened at 110 (above 105).
    // Fill price MUST be 110 (open).
    candles[2] = makeCandle(candles[2].ts, 110, 112, 109, 111);

    const def = makeShortStopDef(5);
    const result = runBacktestV3({
      strategyVersionId: "test-short-gap-stop",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.direction).toBe("short");
    expect(trade.exitPrice).toBe(110);
    expect(trade.exitReason).toBe("stop_loss:5%");
  });

  it("5c. Long and Short symmetry: short take-profit hit", () => {
    const candles = buildBaseSeries(60, 100);

    // Short Entry @ 100. Target is 10% -> 90.
    // Bar 3: open=98, high=99, low=85, close=88.
    // Price traded down through 90 intrabar.
    // Fill price MUST be 90 (target level), NOT 85 (low).
    candles[2] = makeCandle(candles[2].ts, 98, 99, 85, 88);

    const def = makeShortStopDef(5, 10);
    const result = runBacktestV3({
      strategyVersionId: "test-short-target",
      definition: def,
      symbol: "TEST",
      candles,
    });

    expect(result.trades.length).toBeGreaterThan(0);
    const trade = result.trades[0];
    expect(trade.direction).toBe("short");
    expect(trade.exitPrice).toBe(90);
    expect(trade.exitReason).toBe("take_profit:10%");
  });
});
