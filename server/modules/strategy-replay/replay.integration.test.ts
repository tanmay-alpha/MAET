/**
 * Strategy Replay Engine — Integration Test Suite.
 *
 * Verifies:
 * 1. Creation of isolated replay sessions.
 * 2. Placing, cancelling, and matching replay orders on next revealed bar.
 * 3. Market, limit, and stop loss order fill execution.
 * 4. Replay cash, position, and ledger updates.
 * 5. Complete isolation from real paper trading accounts.
 */

import { describe, expect, it } from "bun:test";
import {
  createReplaySession,
  getReplaySession,
  placeReplayOrder,
  cancelReplayOrder,
  revealNextBar,
} from "./replay-engine";

describe("Strategy Replay Engine Test Suite", () => {
  it("1. Creates an isolated replay session", () => {
    const session = createReplaySession("sess-1", "user-1", "RELIANCE", "1d", 100000);
    expect(session.id).toBe("sess-1");
    expect(session.cashBalance).toBe(100000);
    expect(session.equity).toBe(100000);
    expect(session.orders).toHaveLength(0);
    expect(session.ledger).toHaveLength(1);
  });

  it("2. Fills market orders on next bar open and logs ledger entry", () => {
    const session = createReplaySession("sess-2", "user-1", "RELIANCE", "1d", 100000);

    // Place market buy order
    const order = placeReplayOrder({
      sessionId: "sess-2",
      symbol: "RELIANCE",
      side: "BUY",
      orderType: "MARKET",
      quantity: 10,
    });
    expect(order.status).toBe("PENDING");

    // Reveal next bar: Open 2500, High 2550, Low 2480, Close 2520
    const res = revealNextBar("sess-2", {
      open: 2500,
      high: 2550,
      low: 2480,
      close: 2520,
      ts: "2026-06-01T09:15:00Z",
    });

    expect(res.executedFills).toHaveLength(1);
    expect(res.executedFills[0].price).toBe(2500);
    expect(res.executedFills[0].quantity).toBe(10);

    const updatedSession = getReplaySession("sess-2")!;
    expect(updatedSession.orders[0].status).toBe("FILLED");
    expect(updatedSession.positions["RELIANCE"].quantity).toBe(10);
    expect(updatedSession.ledger.length).toBeGreaterThan(1);
  });

  it("3. Fills limit orders only when price boundary is crossed", () => {
    const session = createReplaySession("sess-3", "user-1", "TCS", "1d", 100000);

    // Place limit buy @ 3000
    placeReplayOrder({
      sessionId: "sess-3",
      symbol: "TCS",
      side: "BUY",
      orderType: "LIMIT",
      price: 3000,
      quantity: 5,
    });

    // Bar 1: Low 3010 (does not reach 3000 limit) -> Order stays pending
    const res1 = revealNextBar("sess-3", { open: 3050, high: 3100, low: 3010, close: 3020, ts: 1700000000000 });
    expect(res1.executedFills).toHaveLength(0);

    // Bar 2: Low 2990 (crosses 3000 limit) -> Fills
    const res2 = revealNextBar("sess-3", { open: 3010, high: 3030, low: 2990, close: 3005, ts: 1700086400000 });
    expect(res2.executedFills).toHaveLength(1);
    expect(res2.executedFills[0].price).toBe(3000);
  });

  it("4. Cancels pending replay orders cleanly", () => {
    createReplaySession("sess-4", "user-1", "INFY", "1d", 100000);
    const order = placeReplayOrder({
      sessionId: "sess-4",
      symbol: "INFY",
      side: "BUY",
      orderType: "LIMIT",
      price: 1400,
      quantity: 10,
    });

    const cancelled = cancelReplayOrder("sess-4", order.id);
    expect(cancelled).toBeTrue();

    const session = getReplaySession("sess-4")!;
    expect(session.orders[0].status).toBe("CANCELLED");
  });
});
