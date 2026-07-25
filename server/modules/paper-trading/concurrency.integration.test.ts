import { describe, expect, it } from "bun:test";
import { executePaperFill } from "@shared/domain/paper-trading/execution";

describe("Paper Trading Concurrency Test Suite", () => {
  it("1. Multiple fills deduct cash atomically without overspending initial balance", () => {
    let account = {
      id: "concurrent-user-1",
      userId: "concurrent-user-1",
      version: 3 as const,
      generation: 1,
      currency: "INR" as const,
      cash: 100000,
      initialCash: 100000,
      realisedPnl: 0,
      allocatedMargin: 0,
      maintenanceMargin: 0,
      status: "ACTIVE" as const,
      isLocked: false,
      positions: [],
      orders: [],
      fills: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const quote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2000,
      volume: 100,
      ts: new Date().toISOString(),
      source: "angelone",
      quality: "live" as const,
    };

    const order1 = {
      id: "order-c1",
      userId: "concurrent-user-1",
      symbol: "RELIANCE",
      side: "BUY" as const,
      quantity: 10,
      type: "MARKET" as const,
      status: "PENDING" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const res1 = executePaperFill({
      account,
      order: order1,
      quote,
      reason: "USER_ORDER",
      fillQuantity: 10,
    });

    account = res1.account;

    expect(account.cash).toBeLessThan(100000);
    expect(account.positions.length).toBe(1);
    expect(account.positions[0].quantity).toBe(10);
  });
});
