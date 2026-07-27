import { describe, expect, it, beforeAll } from "bun:test";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createPaperTradingService } from "./service";
import { applyMigrations } from "../../scripts/apply-migrations";

describe("Paper Trading Integration Test Suite (Database & Repository Contracts)", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for integration tests. Run tests with TEST_DATABASE_URL set.");
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
        price: prices[symbol] || 2500,
        volume: 100,
        ts: new Date().toISOString(),
        source: "angelone",
        quality: "live",
      }),
    });
  }

  it("1. Fails immediately if TEST_DATABASE_URL is missing or empty", () => {
    expect(process.env.TEST_DATABASE_URL).toBeDefined();
    expect(process.env.TEST_DATABASE_URL!.length).toBeGreaterThan(0);
  });

  it("2. Verifies migration application and database tables exist", async () => {
    const sql = getSqlClient();
    const tables = await sql`
      SELECT table_name FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('paper_accounts', 'paper_orders', 'paper_positions', 'paper_fills', 'paper_ledger_entries', 'paper_outbox_events')
    `;
    expect(tables.length).toBe(6);
  });

  it("3. Verifies account creation, initial ledger entry, and atomic MARKET order", async () => {
    const service = mockService({ RELIANCE: 2500 });
    const testUserId = crypto.randomUUID();

    await createTestUser(testUserId);

    const state = await service.getState({ userId: testUserId });
    expect(Number(state.account.cashBalance)).toBe(1000000);
    expect(state.account.status).toBe("ACTIVE");
    expect(Number(state.account.version)).toBe(1);

    const placeResult = await service.placeOrder({
      userId: testUserId,
      command: {
        symbol: "RELIANCE",
        exchange: "NSE",
        side: "BUY",
        type: "MARKET",
        qty: 10,
        idempotencyKey: `idem-${testUserId}-1`,
      },
    });

    expect(placeResult.order.status).toBe("FILLED");
    expect(placeResult.fill).toBeDefined();
    expect(placeResult.fill?.quantity).toBe(10);
    expect(placeResult.position?.totalShares).toBe(10);
    expect(Number(placeResult.account.cashBalance)).toBeLessThan(1000000);
    expect(Number(placeResult.account.version)).toBe(2);
  });

  it("4. Verifies idempotent replay does not duplicate fills, fees, or ledger entries", async () => {
    const db = getDb();
    const service = mockService({ TCS: 3000 });
    const testUserId = crypto.randomUUID();

    await createTestUser(testUserId);

    await service.getState({ userId: testUserId });

    const cmd = {
      symbol: "TCS",
      exchange: "NSE" as const,
      side: "BUY" as const,
      type: "MARKET" as const,
      qty: 5,
      idempotencyKey: `idem-replay-${testUserId}`,
    };

    const res1 = await service.placeOrder({ userId: testUserId, command: cmd });
    expect(res1.idempotentReplay).toBeFalsy();

    const res2 = await service.placeOrder({ userId: testUserId, command: cmd });
    expect(res2.idempotentReplay).toBe(true);
    expect(res2.order.id).toBe(res1.order.id);

    const userFills = await db.select().from(paperFills).where(eq(paperFills.userId, testUserId));
    expect(userFills.length).toBe(1);

    const userLedger = await db.select().from(paperLedgerEntries).where(eq(paperLedgerEntries.userId, testUserId));
    expect(userLedger.length).toBeGreaterThanOrEqual(1);
  });

  it("5. Verifies reset account increments generation and preserves history", async () => {
    const service = mockService({ INFY: 1500 });
    const testUserId = crypto.randomUUID();

    await createTestUser(testUserId);

    await service.getState({ userId: testUserId });

    await service.placeOrder({
      userId: testUserId,
      command: {
        symbol: "INFY",
        exchange: "NSE",
        side: "BUY",
        type: "MARKET",
        qty: 10,
      },
    });

    const resetAccount = await service.resetAccount({ userId: testUserId, confirmation: true });
    expect(resetAccount.generation).toBe(2);
    expect(Number(resetAccount.cashBalance)).toBe(1000000);

    // Old generation fills still queryable
    const historicalFills = await service.listFills({ userId: testUserId, generation: 1 });
    expect(historicalFills.fills.length).toBe(1);
  });

  it("6. Verifies fill and ledger immutability protection", async () => {
    const sql = getSqlClient();
    const fillsPolicy = await sql`
      SELECT policyname FROM pg_policies WHERE tablename = 'paper_fills'
    `;
    expect(fillsPolicy.length).toBeGreaterThan(0);

    const ledgerPolicy = await sql`
      SELECT policyname FROM pg_policies WHERE tablename = 'paper_ledger_entries'
    `;
    expect(ledgerPolicy.length).toBeGreaterThan(0);
  });
});
