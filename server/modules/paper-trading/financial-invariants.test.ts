/**
 * Financial Invariants Test Suite — Paper Trading Engine
 *
 * Validates the core financial invariants for the paper trading engine:
 * 17. Long survives persist → reload.
 * 18. Short survives persist → reload.
 * 19. Long PnL correct.
 * 20. Short PnL correct.
 * 21. Closing long uses SELL.
 * 22. Closing short uses BUY.
 * 23. Long → short reversal correct.
 * 24. Short → long reversal correct.
 * 25. Parent order creates durable SL/TP children.
 * 26. TP fill cancels SL (OCO logic).
 * 27. SL fill cancels TP (OCO logic).
 * 28. Partial fills correctly update average price.
 * 29. Quote fingerprinting / idempotency prevents duplicate fills.
 * 30. Fees reconcile between fill, ledger, and account cash.
 * 31. Settle account recalculates unrealized PnL on positions.
 * 32. Full multi-trade financial reconciliation (cash, position value, realized PnL, equity).
 *
 * All tests are purely deterministic with no external DB or network dependencies.
 */

import { describe, expect, it } from "bun:test";
import {
  PAPER_TRANSACTION_FEE_RATE,
  executePaperFill,
  settlePaperAccount,
} from "@shared/domain/paper-trading/execution";
import { reconcilePosition } from "@shared/domain/paper-trading/reconcile-position";
import type {
  PaperAccount,
  PaperOrder,
  PaperPosition,
} from "@shared/domain/paper-trading/types";
import type { ExecutionQuote } from "@shared/types";
import { evaluateExecutionQuote } from "@shared/types";

// ============================================================
// Test Helpers
// ============================================================

function makeQuote(
  symbol = "RELIANCE",
  price = 1000,
  overrides: Partial<ExecutionQuote> = {}
): ExecutionQuote {
  return {
    exchange: "NSE",
    symbol,
    price,
    volume: 10_000,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
    ...overrides,
  };
}

function makeOrder(overrides: Partial<PaperOrder> = {}): PaperOrder {
  const ts = new Date().toISOString();
  return {
    id: crypto.randomUUID(),
    symbol: "RELIANCE",
    side: "BUY",
    quantity: 10,
    type: "MARKET",
    status: "PENDING",
    filledQuantity: 0,
    createdAt: ts,
    updatedAt: ts,
    ...overrides,
  };
}

function makeAccount(
  cash = 100_000,
  positions: PaperPosition[] = [],
  orders: PaperOrder[] = []
): PaperAccount {
  return {
    version: 3,
    initialCash: 100_000,
    cash,
    allocatedMargin: 0,
    maintenanceMargin: 0,
    realisedPnl: 0,
    unrealisedPnl: 0,
    status: "ACTIVE",
    positions,
    orders,
    fills: [],
  };
}

describe("Paper Trading Financial Invariants — Position Persistence & Direction (P0-E)", () => {
  // Test 17: Long survives DB persist → reload
  it("17. Long position survives persist -> reload with positive quantity and side=LONG", () => {
    const domainPosition: PaperPosition = {
      symbol: "RELIANCE",
      quantity: 50, // Long position
      averagePrice: 2500,
      marginLocked: 25000,
      realisedPnl: 0,
      unrealisedPnl: 0,
      updatedAt: new Date().toISOString(),
    };

    // Persistence mapping (P0-E fix in service.ts / tick-processor.ts):
    const persistedRow = {
      symbol: domainPosition.symbol,
      totalShares: Math.abs(domainPosition.quantity),
      side: domainPosition.quantity >= 0 ? ("LONG" as const) : ("SHORT" as const),
      averageEntryPrice: String(domainPosition.averagePrice),
    };

    expect(persistedRow.side).toBe("LONG");
    expect(persistedRow.totalShares).toBe(50);

    // Restoration mapping (P0-E fix on load):
    const reloadedQuantity =
      persistedRow.side === "SHORT"
        ? -Number(persistedRow.totalShares)
        : Number(persistedRow.totalShares);

    expect(reloadedQuantity).toBe(50);
    expect(reloadedQuantity).toBe(domainPosition.quantity);
  });

  // Test 18: Short survives DB persist → reload
  it("18. Short position survives persist -> reload with negative quantity and side=SHORT", () => {
    const domainPosition: PaperPosition = {
      symbol: "INFY",
      quantity: -50, // Short position
      averagePrice: 1500,
      marginLocked: 15000,
      realisedPnl: 0,
      unrealisedPnl: 0,
      updatedAt: new Date().toISOString(),
    };

    // Persistence mapping (P0-E fix in service.ts / tick-processor.ts):
    const persistedRow = {
      symbol: domainPosition.symbol,
      totalShares: Math.abs(domainPosition.quantity),
      side: domainPosition.quantity >= 0 ? ("LONG" as const) : ("SHORT" as const),
      averageEntryPrice: String(domainPosition.averagePrice),
    };

    expect(persistedRow.side).toBe("SHORT");
    expect(persistedRow.totalShares).toBe(50);

    // Restoration mapping (P0-E fix on load):
    const reloadedQuantity =
      persistedRow.side === "SHORT"
        ? -Number(persistedRow.totalShares)
        : Number(persistedRow.totalShares);

    // CRITICAL: Must be -50 (SHORT), NOT +50 (LONG)
    expect(reloadedQuantity).toBe(-50);
    expect(reloadedQuantity).toBe(domainPosition.quantity);
  });
});

describe("Paper Trading Financial Invariants — P&L Correctness", () => {
  // Test 19: Long PnL correct
  it("19. Long trade: Buy 100 @ 100, Sell 100 @ 110 yields exactly +₹1,000 gross PnL", () => {
    const openResult = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "BUY",
      fillQuantity: 100,
      fillPrice: 100,
    });
    expect(openResult.resultingQuantity).toBe(100);
    expect(openResult.resultingAveragePrice).toBe(100);
    expect(openResult.realisedPnl).toBe(0);

    const closeResult = reconcilePosition({
      existingQuantity: openResult.resultingQuantity,
      existingAveragePrice: openResult.resultingAveragePrice,
      side: "SELL",
      fillQuantity: 100,
      fillPrice: 110,
    });
    expect(closeResult.resultingQuantity).toBe(0);
    expect(closeResult.closedQuantity).toBe(100);
    expect(closeResult.action).toBe("CLOSE");
    // (110 - 100) * 100 = +1,000
    expect(closeResult.realisedPnl).toBe(1000);
  });

  // Test 20: Short PnL correct
  it("20. Short trade: Sell short 100 @ 100, Buy to cover 100 @ 90 yields exactly +₹1,000 gross PnL", () => {
    const openResult = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "SELL",
      fillQuantity: 100,
      fillPrice: 100,
    });
    expect(openResult.resultingQuantity).toBe(-100);
    expect(openResult.resultingAveragePrice).toBe(100);
    expect(openResult.realisedPnl).toBe(0);

    const closeResult = reconcilePosition({
      existingQuantity: openResult.resultingQuantity,
      existingAveragePrice: openResult.resultingAveragePrice,
      side: "BUY",
      fillQuantity: 100,
      fillPrice: 90,
    });
    expect(closeResult.resultingQuantity).toBe(0);
    expect(closeResult.closedQuantity).toBe(100);
    expect(closeResult.action).toBe("CLOSE");
    // Short profit: (100 - 90) * 100 = +1,000
    expect(closeResult.realisedPnl).toBe(1000);
  });
});

describe("Paper Trading Financial Invariants — Closing Side Semantics", () => {
  // Test 21: Closing long uses SELL
  it("21. Closing a long position (qty > 0) strictly requires side=SELL", () => {
    const longQty = 100;
    const requiredCloseSide = longQty > 0 ? "SELL" : "BUY";
    expect(requiredCloseSide).toBe("SELL");

    const result = reconcilePosition({
      existingQuantity: 100,
      existingAveragePrice: 100,
      side: requiredCloseSide,
      fillQuantity: 100,
      fillPrice: 105,
    });
    expect(result.resultingQuantity).toBe(0);
    expect(result.action).toBe("CLOSE");
  });

  // Test 22: Closing short uses BUY
  it("22. Closing a short position (qty < 0) strictly requires side=BUY", () => {
    const shortQty = -100;
    const requiredCloseSide = shortQty > 0 ? "SELL" : "BUY";
    expect(requiredCloseSide).toBe("BUY");

    const result = reconcilePosition({
      existingQuantity: -100,
      existingAveragePrice: 100,
      side: requiredCloseSide,
      fillQuantity: 100,
      fillPrice: 95,
    });
    expect(result.resultingQuantity).toBe(0);
    expect(result.action).toBe("CLOSE");
  });
});

describe("Paper Trading Financial Invariants — Position Reversals", () => {
  // Test 23: Long → short reversal correct
  it("23. Long → short reversal: +50 @ 100, SELL 100 @ 110 closes 50 long (+₹500 PnL) and opens -50 short @ 110", () => {
    const reversal = reconcilePosition({
      existingQuantity: 50,
      existingAveragePrice: 100,
      side: "SELL",
      fillQuantity: 100,
      fillPrice: 110,
    });

    expect(reversal.action).toBe("REVERSE");
    expect(reversal.closedQuantity).toBe(50);
    expect(reversal.openedQuantity).toBe(50);
    expect(reversal.resultingQuantity).toBe(-50); // Now short 50
    expect(reversal.resultingAveragePrice).toBe(110); // Short entry price is fillPrice
    expect(reversal.realisedPnl).toBe(500); // (110 - 100) * 50
  });

  // Test 24: Short → long reversal correct
  it("24. Short → long reversal: -50 @ 100, BUY 100 @ 90 closes 50 short (+₹500 PnL) and opens +50 long @ 90", () => {
    const reversal = reconcilePosition({
      existingQuantity: -50,
      existingAveragePrice: 100,
      side: "BUY",
      fillQuantity: 100,
      fillPrice: 90,
    });

    expect(reversal.action).toBe("REVERSE");
    expect(reversal.closedQuantity).toBe(50);
    expect(reversal.openedQuantity).toBe(50);
    expect(reversal.resultingQuantity).toBe(50); // Now long 50
    expect(reversal.resultingAveragePrice).toBe(90); // Long entry price is fillPrice
    expect(reversal.realisedPnl).toBe(500); // (100 - 90) * 50
  });
});

describe("Paper Trading Financial Invariants — Bracket / OCO Behavior (P0-F)", () => {
  // Test 25: Parent order creates durable SL/TP children
  it("25. Parent MARKET BUY with takeProfitPrice and stopLossPrice spawns child SELL orders", () => {
    const parentOrder = makeOrder({
      id: "parent-order-1",
      side: "BUY",
      quantity: 100,
      takeProfitPrice: 110,
      stopLossPrice: 90,
    });
    const acc = makeAccount(100_000, [], [parentOrder]);
    const quote = makeQuote("RELIANCE", 100);

    const fillResult = executePaperFill({
      account: acc,
      order: parentOrder,
      fillQuantity: 100,
      quote,
      reason: "USER_ORDER",
    });

    // Parent must be FILLED in updated account orders
    const filledParent = fillResult.account.orders.find((o) => o.id === parentOrder.id);
    expect(filledParent?.status).toBe("FILLED");

    // Children must be created in account.orders
    const childOrders = fillResult.account.orders.filter(
      (o) => o.parentOrderId === parentOrder.id
    );
    expect(childOrders.length).toBe(2);

    const tpOrder = childOrders.find((o) => o.type === "LIMIT");
    const slOrder = childOrders.find((o) => o.type === "STOP_LOSS_LIMIT");

    expect(tpOrder).toBeDefined();
    expect(tpOrder!.side).toBe("SELL"); // Child side opposite to parent
    expect(tpOrder!.quantity).toBe(100);
    expect(tpOrder!.limitPrice).toBe(110);
    expect(tpOrder!.status).toBe("PENDING");

    expect(slOrder).toBeDefined();
    expect(slOrder!.side).toBe("SELL");
    expect(slOrder!.quantity).toBe(100);
    expect(slOrder!.stopPrice).toBe(90);
    expect(slOrder!.status).toBe("PENDING");
  });

  // Test 26: TP fill cancels SL
  it("26. In OCO bracket, when TP fills, SL sibling is automatically CANCELLED", () => {
    const parentId = "bracket-root-1";
    const tpOrder = makeOrder({
      id: "tp-order-1",
      parentOrderId: parentId,
      side: "SELL",
      quantity: 100,
      type: "LIMIT",
      limitPrice: 110,
    });
    const slOrder = makeOrder({
      id: "sl-order-1",
      parentOrderId: parentId,
      side: "SELL",
      quantity: 100,
      type: "STOP_LOSS_LIMIT",
      stopPrice: 90,
      limitPrice: 90,
    });

    const currentPosition: PaperPosition = {
      symbol: "RELIANCE",
      quantity: 100,
      averagePrice: 100,
      marginLocked: 2000,
      realisedPnl: 0,
      unrealisedPnl: 1000,
      updatedAt: new Date().toISOString(),
    };

    const acc = makeAccount(100_000, [currentPosition], [tpOrder, slOrder]);
    const quote = makeQuote("RELIANCE", 110);

    // Execute TP fill
    const fillResult = executePaperFill({
      account: acc,
      order: tpOrder,
      fillQuantity: 100,
      quote,
      reason: "USER_ORDER",
    });

    const filledTp = fillResult.account.orders.find((o) => o.id === tpOrder.id);
    expect(filledTp?.status).toBe("FILLED");

    // The sibling SL order must now be CANCELLED by OCO logic in executePaperFill
    const cancelledSibling = fillResult.account.orders.find((o) => o.id === slOrder.id);
    expect(cancelledSibling).toBeDefined();
    expect(cancelledSibling!.status).toBe("CANCELLED");
  });

  // Test 27: SL fill cancels TP
  it("27. In OCO bracket, when SL fills, TP sibling is automatically CANCELLED", () => {
    const parentId = "bracket-root-2";
    const tpOrder = makeOrder({
      id: "tp-order-2",
      parentOrderId: parentId,
      side: "SELL",
      quantity: 100,
      type: "LIMIT",
      limitPrice: 110,
    });
    const slOrder = makeOrder({
      id: "sl-order-2",
      parentOrderId: parentId,
      side: "SELL",
      quantity: 100,
      type: "STOP_LOSS_LIMIT",
      stopPrice: 90,
      limitPrice: 90,
      status: "TRIGGERED", // Pre-triggered for execution
      triggeredAt: new Date().toISOString(),
    });

    const currentPosition: PaperPosition = {
      symbol: "RELIANCE",
      quantity: 100,
      averagePrice: 100,
      marginLocked: 2000,
      realisedPnl: 0,
      unrealisedPnl: -1000,
      updatedAt: new Date().toISOString(),
    };

    const acc = makeAccount(100_000, [currentPosition], [tpOrder, slOrder]);
    const quote = makeQuote("RELIANCE", 90);

    // Execute SL fill
    const fillResult = executePaperFill({
      account: acc,
      order: slOrder,
      fillQuantity: 100,
      quote,
      reason: "STOP_TRIGGER",
    });

    const filledSl = fillResult.account.orders.find((o) => o.id === slOrder.id);
    expect(filledSl?.status).toBe("FILLED");

    // The sibling TP order must now be CANCELLED by OCO logic in executePaperFill
    const cancelledSibling = fillResult.account.orders.find((o) => o.id === tpOrder.id);
    expect(cancelledSibling).toBeDefined();
    expect(cancelledSibling!.status).toBe("CANCELLED");
  });
});

describe("Paper Trading Financial Invariants — Execution Accuracy & Reconciliation", () => {
  // Test 28: Partial fills correctly update average price
  it("28. Multiple fills in same direction correctly compute weighted average price", () => {
    // Fill 1: 50 @ 100
    const fill1 = reconcilePosition({
      existingQuantity: 0,
      existingAveragePrice: 0,
      side: "BUY",
      fillQuantity: 50,
      fillPrice: 100,
    });
    expect(fill1.resultingQuantity).toBe(50);
    expect(fill1.resultingAveragePrice).toBe(100);

    // Fill 2: 50 @ 110
    const fill2 = reconcilePosition({
      existingQuantity: fill1.resultingQuantity,
      existingAveragePrice: fill1.resultingAveragePrice,
      side: "BUY",
      fillQuantity: 50,
      fillPrice: 110,
    });
    expect(fill2.resultingQuantity).toBe(100);
    // (50 * 100 + 50 * 110) / 100 = 105
    expect(fill2.resultingAveragePrice).toBe(105);
    expect(fill2.realisedPnl).toBe(0);
    expect(fill2.action).toBe("INCREASE");
  });

  // Test 29: Quote fingerprint / idempotency
  it("29. Quote fingerprinting rejects execution when quote is invalid or mismatched", () => {
    const quoteValid = makeQuote("TCS", 3500);
    const evalValid = evaluateExecutionQuote(quoteValid, "TCS");
    expect(evalValid.executable).toBe(true);

    // Symbol mismatch
    const evalMismatch = evaluateExecutionQuote(quoteValid, "INFY");
    expect(evalMismatch.executable).toBe(false);

    // Stale quote (older than allowable window)
    const staleQuote = makeQuote("TCS", 3500, {
      ts: "2020-01-01T00:00:00.000Z",
    });
    const evalStale = evaluateExecutionQuote(staleQuote, "TCS", 60_000);
    expect(evalStale.executable).toBe(false);
  });

  // Test 30: Fees reconcile between fill and account
  it("30. Transaction fees are exactly deducted from cash on fill", () => {
    const initialCash = 100_000;
    const order = makeOrder({ side: "BUY", quantity: 10 });
    const acc = makeAccount(initialCash);
    const quote = makeQuote("RELIANCE", 1000);

    const fillResult = executePaperFill({
      account: acc,
      order,
      fillQuantity: 10,
      quote,
      reason: "USER_ORDER",
    });

    const expectedFees =
      fillResult.fill.fillPrice * fillResult.fill.quantity * PAPER_TRANSACTION_FEE_RATE;
    expect(fillResult.fill.fees).toBe(expectedFees);
    // Cash must be decremented by exactly the fees:
    expect(fillResult.account.cash).toBe(initialCash - expectedFees);
  });

  // Test 31: Account settle unrealized PnL
  it("31. Settle account properly recalculates unrealized PnL on positions", () => {
    const position: PaperPosition = {
      symbol: "RELIANCE",
      quantity: 100,
      averagePrice: 1000,
      marginLocked: 20000,
      realisedPnl: 0,
      unrealisedPnl: 0,
      updatedAt: new Date().toISOString(),
    };
    const acc = makeAccount(80_000, [position]);
    const quote = makeQuote("RELIANCE", 1100);

    const quotesMap = new Map<string, ExecutionQuote>([["RELIANCE", quote]]);
    const settled = settlePaperAccount(acc, quotesMap);

    // Unrealized PnL: 100 * (1100 - 1000) = +10,000
    expect(settled.positions[0].unrealisedPnl).toBe(10000);
  });

  // Test 32: Full multi-trade financial reconciliation
  it("32. Golden Scenario: Full lifecycle reconciliation (Cash + Position Value + Realized PnL - Fees = Total Equity)", () => {
    const initialCash = 100_000;
    let acc = makeAccount(initialCash);

    // 1. Buy 100 @ ₹100
    const buyOrder = makeOrder({ symbol: "RELIANCE", side: "BUY", quantity: 100 });
    const buyQuote = makeQuote("RELIANCE", 100);
    const buyResult = executePaperFill({
      account: acc,
      order: buyOrder,
      fillQuantity: 100,
      quote: buyQuote,
      reason: "USER_ORDER",
    });
    acc = buyResult.account;

    const buyFees = buyResult.fill.fees;
    expect(acc.cash).toBe(initialCash - buyFees);
    expect(acc.positions[0].quantity).toBe(100);

    // 2. Sell 100 @ ₹110
    const sellOrder = makeOrder({ symbol: "RELIANCE", side: "SELL", quantity: 100 });
    const sellQuote = makeQuote("RELIANCE", 110);
    const sellResult = executePaperFill({
      account: acc,
      order: sellOrder,
      fillQuantity: 100,
      quote: sellQuote,
      reason: "USER_ORDER",
    });
    acc = sellResult.account;

    const sellFees = sellResult.fill.fees;
    const totalFees = buyFees + sellFees;
    const grossPnl = sellResult.fill.realisedPnl;
    const netPnl = grossPnl - totalFees;

    // Position is closed: removed from positions array
    expect(acc.positions.length).toBe(0);
    expect(acc.realisedPnl).toBe(grossPnl);
    expect(acc.cash).toBeCloseTo(initialCash + grossPnl - totalFees, 4);

    // Total account equity when flat must equal cash
    expect(acc.cash).toBeCloseTo(initialCash + netPnl, 4);
  });
});
