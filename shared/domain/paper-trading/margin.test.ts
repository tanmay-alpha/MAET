import { describe, expect, it } from "bun:test";
import type { ExecutionQuote } from "../../types/market";
import { reconcilePosition } from "./reconcile-position";
import { calculateProjectedMarginAfterFill } from "./margin";
import type {
  PaperAccount,
  PaperPosition,
} from "./types";

const now = "2026-07-25T00:00:00.000Z";

function quote(price: number): ExecutionQuote {
  return {
    exchange: "NSE",
    symbol: "RELIANCE",
    price,
    volume: 10_000,
    ts: now,
    source: "angelone",
    quality: "live",
  };
}

function position(
  quantity: number,
  averagePrice: number,
  unrealisedPnl = 0
): PaperPosition {
  return {
    symbol: "RELIANCE",
    quantity,
    averagePrice,
    marginLocked:
      (Math.abs(quantity) * averagePrice) / 5,
    realisedPnl: 0,
    unrealisedPnl,
    updatedAt: now,
  };
}

function account(
  cash: number,
  positions: PaperPosition[]
): PaperAccount {
  const allocatedMargin = positions.reduce(
    (total, current) =>
      total +
      (Math.abs(current.quantity) *
        current.averagePrice) /
        5,
    0
  );
  return {
    version: 3,
    initialCash: cash,
    cash,
    allocatedMargin,
    maintenanceMargin: allocatedMargin * 0.8,
    realisedPnl: 0,
    status: "ACTIVE",
    positions,
    orders: [],
    fills: [],
  };
}

describe("projected post-trade margin", () => {
  it("releases old margin during a valid reversal", () => {
    const current = position(100, 1000);
    const reconciliation = reconcilePosition({
      existingQuantity: 100,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 110,
      fillPrice: 1000,
    });
    const projectedPositions = [position(-10, 1000)];
    const result = calculateProjectedMarginAfterFill({
      account: account(20_000, [current]),
      symbol: "RELIANCE",
      quote: quote(1000),
      reconciliation,
      fillPrice: 1000,
      fees: 0,
      projectedPositions,
    });

    expect(result.allocatedMarginBefore).toBe(20_000);
    expect(result.allocatedMarginAfter).toBe(2_000);
    expect(result.freeMarginAfter).toBe(18_000);
    expect(result.sufficient).toBe(true);
  });

  it("rejects an oversized reversal by projected free margin", () => {
    const current = position(100, 1000);
    const reconciliation = reconcilePosition({
      existingQuantity: 100,
      existingAveragePrice: 1000,
      side: "SELL",
      fillQuantity: 250,
      fillPrice: 1000,
    });
    const result = calculateProjectedMarginAfterFill({
      account: account(20_000, [current]),
      symbol: "RELIANCE",
      quote: quote(1000),
      reconciliation,
      fillPrice: 1000,
      fees: 0,
      projectedPositions: [position(-150, 1000)],
    });

    expect(result.allocatedMarginAfter).toBe(30_000);
    expect(result.freeMarginAfter).toBe(-10_000);
    expect(result.sufficient).toBe(false);
  });

  it("includes the current-symbol unrealised loss in equity before", () => {
    const current = position(100, 1000, 999_999);
    const reconciliation = reconcilePosition({
      existingQuantity: 100,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 1,
      fillPrice: 500,
    });
    const result = calculateProjectedMarginAfterFill({
      account: account(100_000, [current]),
      symbol: "RELIANCE",
      quote: quote(500),
      reconciliation,
      fillPrice: 500,
      fees: 0,
      projectedPositions: [
        position(
          reconciliation.resultingQuantity,
          reconciliation.resultingAveragePrice
        ),
      ],
    });

    expect(result.equityBefore).toBe(50_000);
  });

  it("includes the current-symbol unrealised profit in equity before", () => {
    const current = position(100, 1000, -999_999);
    const reconciliation = reconcilePosition({
      existingQuantity: 100,
      existingAveragePrice: 1000,
      side: "BUY",
      fillQuantity: 1,
      fillPrice: 1500,
    });
    const result = calculateProjectedMarginAfterFill({
      account: account(100_000, [current]),
      symbol: "RELIANCE",
      quote: quote(1500),
      reconciliation,
      fillPrice: 1500,
      fees: 0,
      projectedPositions: [
        position(
          reconciliation.resultingQuantity,
          reconciliation.resultingAveragePrice
        ),
      ],
    });

    expect(result.equityBefore).toBe(150_000);
  });

  it("deducts fees and execution slippage from projected equity", () => {
    const reconciliation = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "BUY",
      fillQuantity: 10,
      fillPrice: 1001,
    });
    const result = calculateProjectedMarginAfterFill({
      account: account(100_000, []),
      symbol: "RELIANCE",
      quote: quote(1000),
      reconciliation,
      fillPrice: 1001,
      fees: 2,
      projectedPositions: [position(10, 1001)],
    });

    expect(result.equityAfter).toBe(99_988);
    expect(result.allocatedMarginAfter).toBe(2002);
    expect(result.freeMarginAfter).toBe(97_986);
  });
});
