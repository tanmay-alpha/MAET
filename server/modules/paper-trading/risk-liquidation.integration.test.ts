import { describe, expect, it, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import type { Tick } from "@shared/types";
import { createPaperTradingService } from "./service";
import { PaperRiskMonitor } from "./risk-monitor";
import { listPaperInterest } from "./interest-subscriptions";

function liveTick(symbol: string, price: number): Tick {
  return {
    exchange: "NSE",
    symbol,
    price,
    volume: 1000,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
  };
}

describe("Paper trading margin-call liquidation", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for liquidation integration tests.");
    }
    await applyMigrations();
  });

  it("A3/A4: a breached short is bought back with a fill and ledger entries, then the account is LIQUIDATED", async () => {
    const symbol = `LIQ${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const userId = crypto.randomUUID();
    const sql = getSqlClient();
    await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`test-user-${userId}@example.com`}) ON CONFLICT DO NOTHING`;

    const service = createPaperTradingService({
      database: getDb(),
      marketPhase: () => "OPEN",
      quoteLoader: async () => liveTick(symbol, 1000),
      // Synthetic test symbols are not in the symbol master.
      symbolExists: async () => true,
    });
    await service.getState({ userId });
    await getDb().update(paperAccounts).set({ cashBalance: "30000.0000" }).where(eq(paperAccounts.userId, userId));

    await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 100 } });
    const resting = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "SELL", type: "LIMIT", limitPrice: 1500, qty: 5 },
    });

    // Price rallies 20%: the short's loss pushes equity below maintenance margin.
    const monitor = new PaperRiskMonitor();
    monitor.updateQuote(liveTick(symbol, 1200));
    await monitor.monitorRisk();

    const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    expect(account!.status).toBe("LIQUIDATED");
    expect(account!.isLocked).toBe(true);
    expect(Number(account!.allocatedMargin)).toBe(0);
    expect(Number(account!.maintenanceMargin)).toBe(0);

    expect(await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId))).toHaveLength(0);

    const liquidationFills = await getDb()
      .select()
      .from(paperFills)
      .where(and(eq(paperFills.userId, userId), eq(paperFills.executionReason, "MARGIN_LIQUIDATION")));
    expect(liquidationFills).toHaveLength(1);
    expect(liquidationFills[0]!.side).toBe("BUY");
    expect(liquidationFills[0]!.quantity).toBe(100);
    expect(Number(liquidationFills[0]!.realizedPnl)).toBeLessThan(0);

    const ledger = await getDb()
      .select()
      .from(paperLedgerEntries)
      .where(and(eq(paperLedgerEntries.userId, userId), eq(paperLedgerEntries.fillId, liquidationFills[0]!.id)));
    expect(ledger.map((entry) => entry.entryType).sort()).toEqual(["EXECUTION_FEE", "TRADE_REALIZED_PNL"]);
    const pnlRow = ledger.find((entry) => entry.entryType === "TRADE_REALIZED_PNL")!;
    const feeRow = ledger.find((entry) => entry.entryType === "EXECUTION_FEE")!;
    const realised = Number(pnlRow.amount);
    const fee = Number(feeRow.amount);
    // Running balances: P&L row first, the fee row leaves the account's cash.
    expect(Number(account!.cashBalance)).toBeCloseTo(Number(feeRow.balanceAfter), 4);
    expect(Number(pnlRow.balanceAfter) + fee).toBeCloseTo(Number(feeRow.balanceAfter), 4);
    expect(realised).toBeCloseTo(Number(liquidationFills[0]!.realizedPnl), 4);
    expect(fee).toBeCloseTo(-Number(liquidationFills[0]!.fees), 4);

    const [restingAfter] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, resting.order.id));
    expect(restingAfter!.status).toBe("CANCELLED");
  });

  it("re-evaluates a LIQUIDATION_PENDING account once ticks for its positions arrive after a restart", async () => {
    const symbol = `LIQP${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const userId = crypto.randomUUID();
    const sql = getSqlClient();
    await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`test-user-${userId}@example.com`}) ON CONFLICT DO NOTHING`;

    const service = createPaperTradingService({
      database: getDb(),
      marketPhase: () => "OPEN",
      quoteLoader: async () => liveTick(symbol, 1000),
      symbolExists: async () => true,
    });
    await service.getState({ userId });
    await getDb().update(paperAccounts).set({ cashBalance: "30000.0000" }).where(eq(paperAccounts.userId, userId));
    await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 100 } });
    // A margin call started before the restart but had no quote to close the short with.
    await getDb()
      .update(paperAccounts)
      .set({ status: "LIQUIDATION_PENDING", isLocked: true, lockReason: "MARGIN_CALL_LIQUIDATION", lockedAt: new Date() })
      .where(eq(paperAccounts.userId, userId));

    // The open position is part of the paper interest set, so the live feed subscribes it.
    expect(await listPaperInterest()).toContainEqual({ userId, exchange: "NSE", symbol, kind: "POSITION" });

    // A fresh monitor (restart, outside market hours) has no ticks and does nothing yet.
    const monitor = new PaperRiskMonitor();
    await monitor.monitorRisk();
    const [stillPending] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    expect(stillPending!.status).toBe("LIQUIDATION_PENDING");

    // The position's first live tick of the session lets the pending liquidation finish.
    monitor.updateQuote(liveTick(symbol, 1200));
    await monitor.monitorRisk();

    const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    expect(account!.status).toBe("LIQUIDATED");
    expect(await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId))).toHaveLength(0);
  });
});
