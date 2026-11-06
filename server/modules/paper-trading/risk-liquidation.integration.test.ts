import { describe, expect, it, beforeAll } from "bun:test";
import { and, eq } from "drizzle-orm";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import {
  paperAccounts,
  paperFills,
  paperLedgerEntries,
  paperOrders,
  paperOutboxEvents,
  paperPositions,
} from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import type { Tick } from "@shared/types";
import { createPaperTradingService } from "./service";
import { PaperRiskMonitor } from "./risk-monitor";
import { listPaperInterest } from "./interest-subscriptions";
import { PaperAccountLockedError } from "./errors";

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

async function createUser(): Promise<string> {
  const userId = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`test-user-${userId}@example.com`}) ON CONFLICT DO NOTHING`;
  return userId;
}

function serviceQuoting(prices: Record<string, number>) {
  return createPaperTradingService({
    database: getDb(),
    marketPhase: () => "OPEN",
    quoteLoader: async (_exchange, symbol) => liveTick(symbol, prices[symbol] ?? 1000),
  });
}

async function accountOf(userId: string) {
  const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
  return account!;
}

async function outboxCount(userId: string): Promise<number> {
  return (await getDb().select().from(paperOutboxEvents).where(eq(paperOutboxEvents.userId, userId))).length;
}

/**
 * Settles a promise expected to reject. Bun 1.3's `expect(promise).rejects` can stall a
 * pending postgres.js transaction, so await it directly.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

/**
 * Cash 50,000; short 100 QUOTED and long 100 STUCK, both at ~1,000 (margin 40,000,
 * maintenance 32,000). QUOTED rallies to 1,400 (a 40,000 loss): the margin call buys it back,
 * leaving ~9,500 of cash against STUCK's 16,000 maintenance. STUCK has no quote, so the
 * account is left LIQUIDATION_PENDING.
 */
async function stuckMarginCall() {
  const quoted = `LIQQ${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const stuck = `LIQS${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const userId = await createUser();
  const service = serviceQuoting({ [quoted]: 1000, [stuck]: 1000 });
  await service.getState({ userId });
  await getDb().update(paperAccounts).set({ cashBalance: "50000.0000" }).where(eq(paperAccounts.userId, userId));
  await service.placeOrder({ userId, command: { symbol: quoted, exchange: "NSE", side: "SELL", type: "MARKET", qty: 100 } });
  await service.placeOrder({ userId, command: { symbol: stuck, exchange: "NSE", side: "BUY", type: "MARKET", qty: 100 } });

  const monitor = new PaperRiskMonitor();
  monitor.updateQuote(liveTick(quoted, 1400));
  await monitor.monitorRisk();

  const account = await accountOf(userId);
  expect(account.status).toBe("LIQUIDATION_PENDING");
  expect(account.isLocked).toBe(true);
  const open = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId));
  expect(open.map((position) => position.symbol)).toEqual([stuck]);
  expect(Number(account.cashBalance)).toBeLessThan(Number(account.maintenanceMargin));
  return { userId, service, monitor, stuck };
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
    expect(await listPaperInterest()).toContainEqual({ exchange: "NSE", symbol, kind: "POSITION" });

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

  it("a pending account whose position has no quote stays put quietly, refuses opening orders and accepts a reduce-only close", async () => {
    const { userId, service, monitor, stuck } = await stuckMarginCall();

    // Re-checking while still no quote: no version bump and no outbox event per cycle.
    const before = await accountOf(userId);
    const eventsBefore = await outboxCount(userId);
    await monitor.monitorRisk();
    await monitor.monitorRisk();
    expect((await accountOf(userId)).version).toBe(before.version);
    expect(await outboxCount(userId)).toBe(eventsBefore);

    // Anything that opens, adds, flips, rests or carries brackets is still refused.
    const other = `LIQO${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    for (const command of [
      { symbol: other, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 },
      { symbol: stuck, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 },
      { symbol: stuck, exchange: "NSE", side: "SELL", type: "MARKET", qty: 150 },
      { symbol: stuck, exchange: "NSE", side: "SELL", type: "LIMIT", limitPrice: 1000, qty: 100 },
      { symbol: stuck, exchange: "NSE", side: "SELL", type: "MARKET", qty: 50, takeProfitPrice: 900 },
    ] as const) {
      expect(await rejectionOf(service.placeOrder({ userId, command }))).toBeInstanceOf(PaperAccountLockedError);
    }

    // Selling half at a real quote (1,000) is accepted even though projected free margin is
    // negative: it only releases margin. Cash ~9,400 now covers the 8,000 maintenance of the
    // remaining 50, so the margin call is resolved in the same transaction.
    const closed = await service.placeOrder({
      userId,
      command: { symbol: stuck, exchange: "NSE", side: "SELL", type: "MARKET", qty: 50 },
    });
    expect(closed.order.status).toBe("FILLED");
    expect(closed.fill?.quantity).toBe(50);
    expect(Number(closed.fill?.referencePrice)).toBe(1000);
    expect(closed.account.status).toBe("ACTIVE");
    const account = await accountOf(userId);
    expect(account.status).toBe("ACTIVE");
    expect(account.isLocked).toBe(false);
    expect(Number(account.maintenanceMargin)).toBeCloseTo((50 * Number(closed.position!.averageEntryPrice) * 0.8) / 5, 2);
    expect(Number(account.cashBalance)).toBeGreaterThan(Number(account.maintenanceMargin));
  });

  it("a stuck pending account is liquidated once its position's quote arrives, at that quote", async () => {
    const { userId, monitor, stuck } = await stuckMarginCall();

    monitor.updateQuote(liveTick(stuck, 990));
    await monitor.monitorRisk();

    expect((await accountOf(userId)).status).toBe("LIQUIDATED");
    expect(await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId))).toHaveLength(0);
    const [fill] = await getDb()
      .select()
      .from(paperFills)
      .where(and(eq(paperFills.userId, userId), eq(paperFills.symbol, stuck), eq(paperFills.executionReason, "MARGIN_LIQUIDATION")));
    expect(Number(fill!.referencePrice)).toBe(990);
  });

  it("the breach test marks an unquoted position at its last stored mark, never its entry price", async () => {
    const symbol = `LIQM${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const userId = await createUser();
    // Buy 100 at 1,000, then 1 more at 700: average ~997.03 and a stored mark of 700.
    await serviceQuoting({ [symbol]: 1000 }).placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 100 },
    });
    await serviceQuoting({ [symbol]: 700 }).placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 },
    });
    const [position] = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId));
    expect(Number(position!.lastQuotePrice)).toBe(700);
    await getDb().update(paperAccounts).set({ cashBalance: "40000.0000" }).where(eq(paperAccounts.userId, userId));
    const maintenance = Number((await accountOf(userId)).maintenanceMargin);
    // At entry the equity is 40,000 (no breach); at the stored mark it is 40,000 - ~30,000.
    expect(40_000 + 101 * (700 - Number(position!.averageEntryPrice))).toBeLessThan(maintenance);
    expect(40_000).toBeGreaterThan(maintenance);

    // The monitor holds a live tick for some other instrument only.
    const monitor = new PaperRiskMonitor();
    monitor.updateQuote(liveTick(`LIQX${crypto.randomUUID().slice(0, 8).toUpperCase()}`, 100));
    await monitor.monitorRisk();

    // The margin call starts, but nothing is sold without a quote: no price is invented.
    const account = await accountOf(userId);
    expect(account.status).toBe("LIQUIDATION_PENDING");
    expect(account.lockReason).toBe("MARGIN_CALL_LIQUIDATION");
    expect(await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId))).toHaveLength(1);
    expect(await getDb().select().from(paperFills).where(eq(paperFills.userId, userId))).toHaveLength(2);
  });
});
