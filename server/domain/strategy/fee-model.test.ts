import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition, StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { computeIndianEquityCharges } from "../../../shared/domain/costs/indian-equity-charges";
import { computeLegCharges } from "./fee-model";
import { runBacktestV3 } from "./runner-v3";

const VOLUME_AWARE: StrategyExecutionConfig = {
  fillPolicy: "NEXT_BAR_OPEN",
  intrabarPolicy: "CONSERVATIVE",
  feeModel: "VOLUME_AWARE",
  slippageBps: 0,
  initialCapital: 100_000,
};

describe("computeLegCharges — VOLUME_AWARE", () => {
  it("charges a ₹1,00,000 NSE delivery round trip per the statutory schedule", () => {
    // STT 0.1% both legs, NSE txn 0.00297%, SEBI ₹10/crore, stamp 0.015% buy only, GST 18% on txn+SEBI.
    expect(computeLegCharges(VOLUME_AWARE, "BUY", 100_000)).toEqual({
      brokerage: 0,
      taxesAndCharges: 118.62,
      total: 118.62,
    });
    expect(computeLegCharges(VOLUME_AWARE, "SELL", 100_000)).toEqual({
      brokerage: 0,
      taxesAndCharges: 103.62,
      total: 103.62,
    });
  });

  it("treats brokerage as INR per order and applies GST to it", () => {
    const leg = computeLegCharges({ ...VOLUME_AWARE, brokerage: 20 }, "BUY", 100_000);
    expect(leg.brokerage).toBe(20);
    // GST rises by 18% of ₹20 = ₹3.60 on top of the zero-brokerage leg.
    expect(leg.total).toBeCloseTo(118.62 + 20 + 3.6, 2);
  });

  it("uses the configured product and exchange", () => {
    const intradaySell = computeLegCharges({ ...VOLUME_AWARE, product: "INTRADAY" }, "SELL", 100_000);
    expect(intradaySell.total).toBe(
      computeIndianEquityCharges({ exchange: "NSE", product: "INTRADAY", side: "SELL", turnoverInr: 100_000 }).total,
    );
    const bseBuy = computeLegCharges({ ...VOLUME_AWARE, exchange: "BSE" }, "BUY", 100_000);
    expect(bseBuy.total).toBe(
      computeIndianEquityCharges({ exchange: "BSE", product: "DELIVERY", side: "BUY", turnoverInr: 100_000 }).total,
    );
  });

  it("charges FIXED_BPS on notional and NONE nothing", () => {
    expect(computeLegCharges({ ...VOLUME_AWARE, feeModel: "FIXED_BPS", feeBps: 10 }, "SELL", 50_000).total).toBe(50);
    expect(computeLegCharges({ ...VOLUME_AWARE, feeModel: "NONE" }, "BUY", 50_000).total).toBe(0);
  });
});

function makeCandles(prices: number[]): Candle[] {
  const padded = [...prices];
  while (padded.length < 60) padded.push(padded[padded.length - 1]);
  return padded.map((p, i) => ({
    symbol: "TEST",
    tf: "1d",
    ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(),
    open: p,
    high: p * 1.005,
    low: p * 0.995,
    close: p,
    volume: 100_000,
    source: "test",
  }));
}

function crossDefinition(direction: "LONG_ONLY" | "SHORT_ONLY"): StrategyDefinition {
  const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
  return {
    name: "fee-trade",
    direction,
    entry: {
      kind: "GROUP", id: "entry", combinator: "AND",
      children: [{ kind: "CONDITION", id: "e1", left: sma(2), operator: direction === "LONG_ONLY" ? "CROSS_ABOVE" : "CROSS_BELOW", right: sma(3) }],
    },
    exit: {
      kind: "GROUP", id: "exit", combinator: "AND",
      children: [{ kind: "CONDITION", id: "x1", left: sma(2), operator: direction === "LONG_ONLY" ? "CROSS_BELOW" : "CROSS_ABOVE", right: sma(3) }],
    },
    risk: { sizingMethod: "FIXED_QUANTITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
    execution: VOLUME_AWARE,
  };
}

describe("runBacktestV3 — per-leg statutory charges", () => {
  const charge = (side: "BUY" | "SELL", turnoverInr: number) =>
    computeIndianEquityCharges({ exchange: "NSE", product: "DELIVERY", side, turnoverInr }).total;

  it("charges a long trade BUY on entry and SELL on exit", () => {
    const result = runBacktestV3({
      strategyVersionId: "fee-long",
      definition: crossDefinition("LONG_ONLY"),
      symbol: "TEST",
      candles: makeCandles([100, 100, 100, 110, 115, 120, 80, 80, 80, 80]),
    });
    const trade = result.trades[0];
    expect(trade).toBeDefined();
    expect(trade.entryFees).toBeCloseTo(charge("BUY", trade.quantity * trade.entryPrice), 6);
    expect(trade.exitFees).toBeCloseTo(charge("SELL", trade.quantity * trade.exitPrice), 6);
    expect(trade.netPnl).toBeCloseTo(trade.grossPnl - trade.entryFees - trade.exitFees, 6);
  });

  it("charges a short trade SELL on entry and BUY on exit", () => {
    const result = runBacktestV3({
      strategyVersionId: "fee-short",
      definition: crossDefinition("SHORT_ONLY"),
      symbol: "TEST",
      candles: makeCandles([120, 120, 120, 110, 105, 100, 130, 130, 130, 130]),
    });
    const trade = result.trades[0];
    expect(trade).toBeDefined();
    expect(trade.direction).toBe("short");
    expect(trade.entryFees).toBeCloseTo(charge("SELL", trade.quantity * trade.entryPrice), 6);
    expect(trade.exitFees).toBeCloseTo(charge("BUY", trade.quantity * trade.exitPrice), 6);
  });
});
