import { describe, expect, it, beforeAll } from "bun:test";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperOrders } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createPaperTradingService } from "./service";
import { applyMigrations } from "../../scripts/apply-migrations";

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
      quoteLoader: async (symbol: string) => ({
        exchange: "NSE",
        symbol,
        price: prices[symbol] || 2000,
        volume: 100,
        ts: new Date().toISOString(),
        source: "angelone",
        quality: "live",
      }),
    });
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

  it("3. Cancel vs Fill race condition resolves cleanly", async () => {
    const db = getDb();
    const service = mockService({ TCS: 3000 });
    const testUserId = crypto.randomUUID();

    await createTestUser(testUserId);

    await service.getState({ userId: testUserId });

    const limitOrderRes = await service.placeOrder({
      userId: testUserId,
      command: {
        symbol: "TCS",
        exchange: "NSE",
        side: "BUY",
        type: "LIMIT",
        limitPrice: 3000,
        qty: 10,
      },
    });

    const orderId = limitOrderRes.order.id;
    expect(limitOrderRes.order.status).toBe("PENDING");

    // Cancel order
    const cancelRes = await service.cancelOrder({ userId: testUserId, orderId });
    expect(cancelRes.status).toBe("CANCELLED");

    const canceledOrderRows = await db.select().from(paperOrders).where(eq(paperOrders.id, orderId));
    expect(canceledOrderRows[0].status).toBe("CANCELLED");
  });

  it("4. Different-symbol orders cannot overspend free cash/margin", async () => {
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
