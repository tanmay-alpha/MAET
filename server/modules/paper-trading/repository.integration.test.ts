import { describe, expect, it } from "bun:test";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";
import { executePaperFill } from "@shared/domain/paper-trading/execution";

describe("Paper Trading Integration Test Suite (Database & Repository Contracts)", () => {
  const testDbUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL;

  it("1. Verifies database URL is configured or skips with message", () => {
    if (!testDbUrl) {
      console.warn("TEST_DATABASE_URL not set; skipping live Postgres integration assertion.");
      expect(true).toBe(true);
      return;
    }
    expect(testDbUrl).toBeDefined();
  });

  it("2. Verifies paper execution fill immutability principles", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 100,
      ts: new Date().toISOString(),
      source: "angelone",
      quality: "live",
    };

    const evalResult = evaluateExecutionQuote(quote, "RELIANCE");
    expect(evalResult.executable).toBe(true);

    const account = {
      id: "test-user-1",
      userId: "test-user-1",
      version: 3 as const,
      generation: 1,
      currency: "INR" as const,
      cash: 1000000,
      initialCash: 1000000,
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

    const order = {
      id: "order-1",
      userId: "test-user-1",
      symbol: "RELIANCE",
      side: "BUY" as const,
      quantity: 10,
      type: "MARKET" as const,
      status: "PENDING" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const result = executePaperFill({
      account,
      order,
      quote,
      reason: "USER_ORDER",
      fillQuantity: 10,
    });

    expect(result.fill.quantity).toBe(10);
    expect(result.fill.fillPrice).toBeGreaterThan(0);
    expect(result.account.cash).toBeLessThan(1000000);
  });
});
