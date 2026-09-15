import { describe, it, expect } from "bun:test";
import {
  adjustCandles,
  type CorporateAction,
  type PriceAdjustmentSeries,
} from "./corporate-actions";
import type { Candle } from "@shared/types";
import { runBacktestV3 } from "../strategy/runner-v3";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

function makeCandle(
  ts: string,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100_000,
  symbol = "TCS",
): Candle {
  return { symbol, tf: "1d", ts, open, high, low, close, volume, source: "test" };
}

describe("P2 Corporate Action Historical Adjustments (Commit 3)", () => {
  it("1. RAW series preserves original candle prices and volumes without mutation", () => {
    const raw: Candle[] = [
      makeCandle("2024-01-01T09:15:00.000Z", 200, 205, 195, 200, 50_000),
      makeCandle("2024-01-02T09:15:00.000Z", 100, 105, 95, 100, 100_000),
    ];

    const actions: CorporateAction[] = [
      {
        symbol: "TCS",
        actionType: "SPLIT",
        exDate: "2024-01-02T00:00:00.000Z",
        ratioNumerator: 2,
        ratioDenominator: 1,
      },
    ];

    const adjusted = adjustCandles(raw, actions, "RAW");

    expect(adjusted[0].close).toBe(200);
    expect(adjusted[0].volume).toBe(50_000);
    // Raw inputs must remain untouched
    expect(raw[0].close).toBe(200);
  });

  it("2. 2:1 Stock Split: adjusts historical price by 0.5 and volume by 2.0 prior to ex-date", () => {
    const raw: Candle[] = [
      makeCandle("2024-01-01T09:15:00.000Z", 200, 210, 190, 200, 50_000),
      makeCandle("2024-01-02T09:15:00.000Z", 100, 105, 95, 100, 100_000), // Ex-date
    ];

    const splitAction: CorporateAction = {
      symbol: "TCS",
      actionType: "SPLIT",
      exDate: "2024-01-02T00:00:00.000Z",
      ratioNumerator: 2,
      ratioDenominator: 1,
    };

    const adjusted = adjustCandles(raw, [splitAction], "SPLIT_ADJUSTED");

    // Candle 0 (before split) was 200 -> adjusted to 100
    expect(adjusted[0].open).toBe(100);
    expect(adjusted[0].high).toBe(105);
    expect(adjusted[0].low).toBe(95);
    expect(adjusted[0].close).toBe(100);
    expect(adjusted[0].volume).toBe(100_000);

    // Candle 1 (on ex-date) remains 100
    expect(adjusted[1].close).toBe(100);
    expect(adjusted[1].volume).toBe(100_000);

    // Continuous price: price difference across split is 0, NOT a 50% crash!
    expect(adjusted[1].open - adjusted[0].close).toBe(0);
  });

  it("3. Total Return Adjustment: adjusts historical prices backward for cash dividends", () => {
    const raw: Candle[] = [
      makeCandle("2024-01-01T09:15:00.000Z", 100, 102, 98, 100, 50_000),
      makeCandle("2024-01-02T09:15:00.000Z", 95, 98, 94, 96, 50_000), // Ex-dividend date
    ];

    const divAction: CorporateAction = {
      symbol: "TCS",
      actionType: "DIVIDEND",
      exDate: "2024-01-02T00:00:00.000Z",
      amount: 5, // 5 INR dividend on 100 close -> factor = (100 - 5) / 100 = 0.95
    };

    // SPLIT_ADJUSTED should ignore dividends
    const splitAdj = adjustCandles(raw, [divAction], "SPLIT_ADJUSTED");
    expect(splitAdj[0].close).toBe(100);

    // TOTAL_RETURN_ADJUSTED applies dividend factor 0.95
    const trAdj = adjustCandles(raw, [divAction], "TOTAL_RETURN_ADJUSTED");
    expect(trAdj[0].close).toBeCloseTo(95, 2);
    expect(trAdj[1].close).toBe(96);
  });

  it("4. Backtest financial invariant: Stock split on SPLIT_ADJUSTED does not produce fake loss", () => {
    // Generate 60 daily candles:
    // Days 1..30 at price 200
    // Day 31 2:1 split occurs
    // Days 31..60 at price 100 (fundamentally unchanged)
    const rawCandles: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const d = new Date("2024-01-01T09:15:00.000Z");
      d.setDate(d.getDate() + i);
      const price = i < 30 ? 200 : 100;
      rawCandles.push(makeCandle(d.toISOString(), price, price + 2, price - 2, price));
    }

    const splitAction: CorporateAction = {
      symbol: "TCS",
      actionType: "SPLIT",
      exDate: rawCandles[30].ts,
      ratioNumerator: 2,
      ratioDenominator: 1,
    };

    const adjustedCandles = adjustCandles(rawCandles, [splitAction], "SPLIT_ADJUSTED");

    // All adjusted close prices should be 100
    for (const c of adjustedCandles) {
      expect(c.close).toBe(100);
    }

    // A simple buy & hold strategy evaluated on adjusted candles
    const def: StrategyDefinition = {
      name: "HoldAcrossSplit",
      direction: "LONG_ONLY",
      entry: {
        kind: "GROUP",
        id: "entry",
        combinator: "AND",
        children: [
          {
            kind: "CONDITION",
            id: "c1",
            left: { kind: "PRICE", field: "CLOSE", lag: 0 },
            operator: "GREATER_THAN",
            right: { kind: "CONSTANT", value: 50 },
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
        sizeValue: 100,
        maximumOpenPositions: 1,
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

    const res = runBacktestV3({
      strategyVersionId: "test-split-inv",
      definition: def,
      symbol: "TCS",
      candles: adjustedCandles,
    });

    // The single open position closed at end of period should have ~0 PnL (NOT -50% loss!)
    expect(res.trades.length).toBe(1);
    const trade = res.trades[0];
    expect(trade.entryPrice).toBe(100);
    expect(trade.exitPrice).toBe(100);
    expect(trade.netPnl).toBe(0);
    expect(res.metrics.maxDrawdown).toBe(0);
  });
});
