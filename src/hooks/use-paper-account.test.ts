import { describe, expect, it } from "bun:test";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";
import { executePaperFill } from "@shared/domain/paper-trading/execution";

describe("Phase 1: Backend Paper Trading Hook & Execution Boundary Tests", () => {
  it("1. Rejects MARKET order evaluation when quote is missing or invalid", () => {
    const invalidQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      ts: new Date().toISOString(),
    };

    const res = evaluateExecutionQuote(invalidQuote as any, "RELIANCE");
    expect(res.executable).toBe(false);
  });

  it("2. Authoritative executePaperFill calculates slippage and fees", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "RELIANCE",
      price: 2500,
      volume: 1000,
      ts: new Date().toISOString(),
      source: "angelone",
      quality: "live",
    };

    const account = {
      id: "user-1",
      userId: "user-1",
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
      id: "ord-1",
      userId: "user-1",
      symbol: "RELIANCE",
      side: "BUY" as const,
      quantity: 10,
      type: "MARKET" as const,
      status: "PENDING" as const,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const fillRes = executePaperFill({
      account,
      order,
      quote,
      reason: "USER_ORDER",
      fillQuantity: 10,
    });

    expect(fillRes.fill.fillPrice).toBeGreaterThan(0);
    expect(fillRes.account.cash).toBeLessThan(1000000);
  });
});
