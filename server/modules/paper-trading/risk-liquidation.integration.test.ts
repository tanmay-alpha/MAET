import { describe, expect, it, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import type { Tick } from "@shared/types";
import { createPaperTradingService } from "./service";
import { PaperRiskMonitor } from "./risk-monitor";

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
    const realised = Number(ledger.find((entry) => entry.entryType === "TRADE_REALIZED_PNL")!.amount);
    const fee = Number(ledger.find((entry) => entry.entryType === "EXECUTION_FEE")!.amount);
    expect(Number(account!.cashBalance)).toBeCloseTo(Number(ledger[0]!.balanceAfter), 4);
    expect(realised).toBeCloseTo(Number(liquidationFills[0]!.realizedPnl), 4);
    expect(fee).toBeCloseTo(-Number(liquidationFills[0]!.fees), 4);

    const [restingAfter] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, resting.order.id));
    expect(restingAfter!.status).toBe("CANCELLED");
  });
});
