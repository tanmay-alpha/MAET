import { describe, it, expect } from "bun:test";
import { SimulatedOrder } from "./order-simulator";
import type { Candle } from "@shared/types";
import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";

function makeCandle(
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100_000,
  ts = "2024-01-01T09:15:00.000Z",
): Candle {
  return { symbol: "TCS", tf: "1d", ts, open, high, low, close, volume, source: "test" };
}

describe("P2 Realistic Execution Model — Partial Fills & Multi-Bar Execution (Commit 2)", () => {
  const baseConfig: StrategyExecutionConfig = {
    fillPolicy: "NEXT_BAR_OPEN",
    intrabarPolicy: "CONSERVATIVE",
    feeModel: "FIXED_BPS",
    feeBps: 10,
    slippageBps: 5,
    initialCapital: 100_000,
    spreadModel: "FIXED_BPS",
    baseSpreadBps: 10,
    marketImpactModel: "SQUARE_ROOT",
    impactCoefficient: 10,
    maxParticipationRate: 0.1, // 10%
  };

  it("1. Participation constraint: caps fill at configured maximum percentage of bar volume", () => {
    const order = new SimulatedOrder(
      "ord-1",
      "TCS",
      "BUY",
      5000,
      { ...baseConfig, maxParticipationRate: 0.1 },
      0,
      "2024-01-01T09:15:00.000Z",
      "GTC",
    );

    const bar = makeCandle(100, 102, 98, 100, 20_000); // 10% of 20,000 = 2,000 max fill
    const didFill = order.processBar(bar, 0);

    expect(didFill).toBe(true);
    expect(order.state.status).toBe("PARTIALLY_FILLED");
    expect(order.state.filledQuantity).toBe(2000);
    expect(order.state.remainingQuantity).toBe(3000);
  });

  it("2. Multi-bar accumulation: large order fills over multiple bars with exact volume & price reconciliation", () => {
    const order = new SimulatedOrder(
      "ord-2",
      "TCS",
      "BUY",
      4000,
      { ...baseConfig, maxParticipationRate: 0.1 },
      0,
      "2024-01-01T09:15:00.000Z",
      "GTC",
    );

    // Bar 1: volume 15,000 -> fills 1,500
    const b1 = makeCandle(100, 101, 99, 100, 15_000, "2024-01-01T09:15:00.000Z");
    order.processBar(b1, 0);
    expect(order.state.status).toBe("PARTIALLY_FILLED");
    expect(order.state.filledQuantity).toBe(1500);

    // Bar 2: volume 12,000 -> fills 1,200
    const b2 = makeCandle(102, 103, 101, 102, 12_000, "2024-01-01T09:20:00.000Z");
    order.processBar(b2, 1);
    expect(order.state.status).toBe("PARTIALLY_FILLED");
    expect(order.state.filledQuantity).toBe(2700);

    // Bar 3: volume 10,000 -> fills 1,000
    const b3 = makeCandle(101, 102, 100, 101, 10_000, "2024-01-01T09:25:00.000Z");
    order.processBar(b3, 2);
    expect(order.state.status).toBe("PARTIALLY_FILLED");
    expect(order.state.filledQuantity).toBe(3700);
    expect(order.state.remainingQuantity).toBe(300);

    // Bar 4: volume 8,000 -> remaining 300 < 800 -> fills 300
    const b4 = makeCandle(103, 104, 102, 103, 8_000, "2024-01-01T09:30:00.000Z");
    order.processBar(b4, 3);
    expect(order.state.status).toBe("FILLED");
    expect(order.state.filledQuantity).toBe(4000);
    expect(order.state.remainingQuantity).toBe(0);
    expect(order.state.fillCount).toBe(4);

    // EXACT RECONCILIATION 1: sum of fill quantities must exactly equal total filled quantity
    const sumFills = order.state.fills.reduce((sum, f) => sum + f.fillQuantity, 0);
    expect(sumFills).toBe(4000);

    // EXACT RECONCILIATION 2: volume-weighted average price
    const expectedVwap =
      order.state.fills.reduce((sum, f) => sum + f.fillQuantity * f.fillPrice, 0) / 4000;
    expect(order.state.averageFillPrice).toBeCloseTo(expectedVwap, 6);

    // EXACT RECONCILIATION 3: cumulative transaction costs must match sum of individual fills
    const expectedTotalCost = order.state.fills.reduce(
      (sum, f) => sum + f.costs.totalTransactionCost,
      0,
    );
    expect(order.state.cumulativeCosts.totalTransactionCost).toBeCloseTo(expectedTotalCost, 6);

    const expectedSpreadCost = order.state.fills.reduce((sum, f) => sum + f.costs.spreadCost, 0);
    expect(order.state.cumulativeCosts.spreadCost).toBeCloseTo(expectedSpreadCost, 6);

    const expectedSlippageCost = order.state.fills.reduce(
      (sum, f) => sum + f.costs.slippageCost,
      0,
    );
    expect(order.state.cumulativeCosts.slippageCost).toBeCloseTo(expectedSlippageCost, 6);

    const expectedImpactCost = order.state.fills.reduce(
      (sum, f) => sum + f.costs.marketImpactCost,
      0,
    );
    expect(order.state.cumulativeCosts.marketImpactCost).toBeCloseTo(expectedImpactCost, 6);
  });

  it("3. Time-in-force: IOC fills on initial bar and cancels remaining quantity", () => {
    const order = new SimulatedOrder(
      "ord-ioc",
      "TCS",
      "BUY",
      2000,
      { ...baseConfig, maxParticipationRate: 0.1 },
      0,
      "2024-01-01T09:15:00.000Z",
      "IOC",
    );

    const b1 = makeCandle(100, 102, 98, 100, 5_000); // fills 10% of 5000 = 500
    order.processBar(b1, 0);

    expect(order.state.filledQuantity).toBe(500);
    expect(order.state.remainingQuantity).toBe(1500);
    expect(order.state.status).toBe("CANCELLED");

    // Subsequent bars cannot fill
    const b2 = makeCandle(101, 103, 99, 101, 10_000);
    const didFillMore = order.processBar(b2, 1);
    expect(didFillMore).toBe(false);
    expect(order.state.filledQuantity).toBe(500);
  });

  it("4. Time-in-force: DAY order expires on date change if not fully filled", () => {
    const order = new SimulatedOrder(
      "ord-day",
      "TCS",
      "BUY",
      2000,
      { ...baseConfig, maxParticipationRate: 0.1 },
      0,
      "2024-01-01T09:15:00.000Z",
      "DAY",
    );

    // Same day bar fills partial
    const b1 = makeCandle(100, 101, 99, 100, 5_000, "2024-01-01T15:15:00.000Z");
    order.processBar(b1, 0);
    expect(order.state.status).toBe("PARTIALLY_FILLED");
    expect(order.state.filledQuantity).toBe(500);

    // Next day bar -> order must expire
    const b2 = makeCandle(102, 103, 101, 102, 5_000, "2024-01-02T09:15:00.000Z");
    const didFillDay2 = order.processBar(b2, 1);
    expect(didFillDay2).toBe(false);
    expect(order.state.status).toBe("EXPIRED");
    expect(order.state.filledQuantity).toBe(500);
  });

  it("5. Manual order cancellation", () => {
    const order = new SimulatedOrder(
      "ord-cancel",
      "TCS",
      "SELL",
      1000,
      baseConfig,
      0,
      "2024-01-01T09:15:00.000Z",
      "GTC",
    );

    expect(order.state.status).toBe("NEW");
    order.cancel();
    expect(order.state.status).toBe("CANCELLED");

    const bar = makeCandle(100, 101, 99, 100, 100_000);
    const didFill = order.processBar(bar, 1);
    expect(didFill).toBe(false);
    expect(order.state.filledQuantity).toBe(0);
  });
});
