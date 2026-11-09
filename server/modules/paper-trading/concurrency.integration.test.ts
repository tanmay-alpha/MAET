import { describe, expect, it, beforeAll } from "bun:test";
import postgres from "postgres";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperOrders, paperPositions } from "../../db/schema";
import { asc, eq } from "drizzle-orm";
import type { Tick } from "@shared/types";
import { createPaperTradingService } from "./service";
import { paperTradingTickProcessor } from "./tick-processor";
import { PaperOrderConflictError } from "./errors";
import { applyMigrations } from "../../scripts/apply-migrations";

function liveTick(symbol: string, price: number, volume: number): Tick {
  return {
    exchange: "NSE",
    symbol,
    price,
    volume,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
  };
}

function uniqueSymbol(prefix: string): string {
  return `${prefix}${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function fillsForOrder(orderId: string) {
  return getDb()
    .select()
    .from(paperFills)
    .where(eq(paperFills.orderId, orderId))
    .orderBy(asc(paperFills.executionSequence));
}

describe("Paper Trading Concurrency Test Suite", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for concurrency integration tests.");
    }
    await applyMigrations();
  });

  async function createTestUser(testUserId: string) {
    const sql = getSqlClient();
    await sql`INSERT INTO auth.users (id) VALUES (${testUserId}) ON CONFLICT DO NOTHING`;
    await sql`INSERT INTO public.users (id, email) VALUES (${testUserId}, ${`test-user-${testUserId}@example.com`}) ON CONFLICT DO NOTHING`;
  }

  function mockService(prices: Record<string, number> = {}) {
    return createPaperTradingService({
      database: getDb(),
      marketPhase: () => "OPEN",
      quoteLoader: async (exchange: "NSE" | "BSE", symbol: string) => ({
        exchange,
        symbol,
        price: prices[symbol] || 2000,
        volume: 100,
        ts: new Date().toISOString(),
        source: "angelone",
        quality: "live",
      }),
      // Synthetic test symbols are not in the symbol master.
      symbolExists: async () => true,
    });
  }

  async function placeLimitBuy(symbol: string, qty: number, limitPrice = 1000) {
    const service = mockService({ [symbol]: limitPrice });
    const testUserId = crypto.randomUUID();
    await createTestUser(testUserId);
    const placed = await service.placeOrder({
      userId: testUserId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice, qty },
    });
    // Tick volume is cumulative; a non-marketable first tick sets the volume baseline.
    expect(await paperTradingTickProcessor.processTick(liveTick(symbol, limitPrice + 1, 0))).toEqual([]);
    return { service, testUserId, orderId: placed.order.id };
  }

  it("1. Fails immediately if TEST_DATABASE_URL is missing", () => {
    expect(process.env.TEST_DATABASE_URL).toBeDefined();
  });

  it("2. Multiple concurrent orders increment account version monotonically", async () => {
    const service = mockService({ RELIANCE: 2000 });
    const testUserId = crypto.randomUUID();

    await createTestUser(testUserId);

    const init = await service.getState({ userId: testUserId });
    expect(Number(init.account.version)).toBe(1);

    const res1 = await service.placeOrder({
      userId: testUserId,
      command: { symbol: "RELIANCE", exchange: "NSE", side: "BUY", type: "MARKET", qty: 5 },
    });
    expect(Number(res1.account.version)).toBe(2);

    const res2 = await service.placeOrder({
      userId: testUserId,
      command: { symbol: "RELIANCE", exchange: "NSE", side: "BUY", type: "MARKET", qty: 5 },
    });
    expect(Number(res2.account.version)).toBe(3);
  });

  it("3. Cancel racing a fill never leaves fills behind a cancellation", async () => {
    for (let round = 0; round < 8; round++) {
      const symbol = uniqueSymbol("RACE");
      const { service, testUserId, orderId } = await placeLimitBuy(symbol, 10);

      const [cancelOutcome] = await Promise.allSettled([
        service.cancelOrder({ userId: testUserId, orderId }),
        paperTradingTickProcessor.processTick(liveTick(symbol, 999, 1000)),
      ]);

      const [order] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, orderId));
      const fills = await fillsForOrder(orderId);
      const filledQty = fills.reduce((total, fill) => total + fill.quantity, 0);
      expect(order!.filledQty).toBe(filledQty);

      if (cancelOutcome.status === "fulfilled") {
        // Cancel won the account lock first: the tick must not fill afterwards.
        expect(order!.status).toBe("CANCELLED");
        expect(fills).toHaveLength(0);
      } else {
        // The fill won: the order is complete and the cancel is a clean conflict.
        expect(cancelOutcome.reason).toBeInstanceOf(PaperOrderConflictError);
        expect(order!.status).toBe("FILLED");
        expect(filledQty).toBe(10);
      }

      const positions = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, testUserId));
      expect(positions.reduce((total, position) => total + position.totalShares, 0)).toBe(filledQty);
    }
  });

  it("4. A fill waiting on the account lock re-checks status after a cancel commits", async () => {
    const symbol = uniqueSymbol("LOCK");
    const { testUserId, orderId } = await placeLimitBuy(symbol, 10);
    const blocker = postgres(process.env.TEST_DATABASE_URL!, { max: 1 });

    try {
      let tickRun: Promise<unknown> | undefined;
      await blocker.begin(async (tx) => {
        await tx`SELECT 1 FROM paper_accounts WHERE user_id = ${testUserId} FOR UPDATE`;
        await tx`UPDATE paper_orders SET status = 'CANCELLED', cancelled_at = now() WHERE id = ${orderId}`;
        // The matcher reads the still-committed PENDING candidate, then blocks on the account lock.
        tickRun = paperTradingTickProcessor.processTick(liveTick(symbol, 995, 1000));
        let blocked = false;
        for (let probe = 0; probe < 1000 && !blocked; probe++) {
          const [row] = await tx`
            SELECT count(*)::int AS waiting FROM pg_stat_activity
            WHERE pg_backend_pid() = ANY(pg_blocking_pids(pid))
          `;
          blocked = row!.waiting > 0;
        }
        expect(blocked).toBe(true);
      });

      expect(await tickRun).toEqual([]);
      expect(await fillsForOrder(orderId)).toHaveLength(0);
      const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, testUserId));
      expect(Number(account!.cashBalance)).toBe(1000000);
    } finally {
      await blocker.end();
    }
  });

  it("5. Sequential partial fills get consecutive execution sequences", async () => {
    const symbol = uniqueSymbol("SEQ");
    const { testUserId, orderId } = await placeLimitBuy(symbol, 100);

    const cumulativeVolumes = [30, 80, 100];
    for (const volume of cumulativeVolumes) {
      const receipts = await paperTradingTickProcessor.processTick(liveTick(symbol, 990, volume));
      expect(receipts).toHaveLength(1);
    }

    const fills = await fillsForOrder(orderId);
    expect(fills.map((fill) => fill.executionSequence)).toEqual([1, 2, 3]);
    expect(fills.map((fill) => fill.quantity)).toEqual([3, 5, 2]);

    const [order] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, orderId));
    expect(order!.status).toBe("PARTIALLY_FILLED");
    expect(order!.filledQty).toBe(10);

    const [position] = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, testUserId));
    expect(position!.totalShares).toBe(10);
  });

  it("6. Concurrent partial-fill ticks serialize into unique sequences without losing quantity", async () => {
    const symbol = uniqueSymbol("CPF");
    const { testUserId, orderId } = await placeLimitBuy(symbol, 100);

    const ticks = [30, 70, 120, 180].map((volume, index) => liveTick(symbol, 990 - index, volume));
    await Promise.all(ticks.map((tick) => paperTradingTickProcessor.processTick(tick)));

    const fills = await fillsForOrder(orderId);
    expect(fills.length).toBeGreaterThan(0);
    expect(fills.map((fill) => fill.executionSequence)).toEqual(fills.map((_, index) => index + 1));

    const filledQty = fills.reduce((total, fill) => total + fill.quantity, 0);
    const [order] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, orderId));
    expect(order!.filledQty).toBe(filledQty);

    const [position] = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, testUserId));
    expect(position!.totalShares).toBe(filledQty);
  });

  it("7. Different-symbol orders cannot overspend free cash/margin", async () => {
    const db = getDb();
    const service = mockService({ MRF: 150000 });
    const testUserId = crypto.randomUUID();

    await createTestUser(testUserId);

    await service.getState({ userId: testUserId });

    let threw = false;
    try {
      await service.placeOrder({
        userId: testUserId,
        command: { symbol: "MRF", exchange: "NSE", side: "BUY", type: "MARKET", qty: 100 },
      });
    } catch (e: any) {
      threw = true;
      expect(e.message).toContain("Execution fill rejected");
    }
    expect(threw).toBe(true);

    const accountRows = await db.select().from(paperAccounts).where(eq(paperAccounts.userId, testUserId));
    expect(Number(accountRows[0].cashBalance)).toBe(1000000);
  });
});
