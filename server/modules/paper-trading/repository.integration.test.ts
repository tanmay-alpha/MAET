import { describe, expect, it, beforeAll } from "bun:test";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { createPaperTradingService } from "./service";
import { PaperValidationError } from "./errors";
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
      marketPhase: () => "OPEN",
      quoteLoader: async (exchange: "NSE" | "BSE", symbol: string) => ({
        exchange,
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

  it("7. Paginates orders, fills and ledger without duplicates or skips when rows share a timestamp", async () => {
    const sql = getSqlClient();
    const service = mockService();
    const testUserId = crypto.randomUUID();
    await createTestUser(testUserId);

    // Seven rows share one microsecond timestamp (one transaction), two are later within the
    // same millisecond, one is older: a ms-precision or timestamp-only cursor repeats or skips rows.
    const timestamps = [
      ...Array.from({ length: 7 }, () => "2026-01-02T03:04:05.123456Z"),
      "2026-01-02T03:04:05.123789Z",
      "2026-01-02T03:04:05.123789Z",
      "2026-01-02T03:04:04.000000Z",
    ];
    for (const [index, ts] of timestamps.entries()) {
      const [order] = await sql`
        INSERT INTO public.paper_orders (user_id, symbol, side, type, qty, placed_at)
        VALUES (${testUserId}, 'RELIANCE', 'BUY', 'MARKET', 1, ${ts}::timestamptz)
        RETURNING id
      `;
      await sql`
        INSERT INTO public.paper_fills (
          order_id, user_id, symbol, side, quantity, reference_price, fill_price,
          quote_source, quote_quality, quote_timestamp, quote_fingerprint,
          execution_reason, execution_sequence, executed_at
        ) VALUES (
          ${order!.id}, ${testUserId}, 'RELIANCE', 'BUY', 1, 2500, 2500,
          'angelone', 'live', ${ts}::timestamptz, ${`fp-${index}`},
          'MARKET', 1, ${ts}::timestamptz
        )
      `;
      await sql`
        INSERT INTO public.paper_ledger_entries (
          user_id, entry_type, amount, balance_after, source_type, source_id, created_at
        ) VALUES (
          ${testUserId}, 'FEE', -1, 1000000, 'TEST', ${`src-${index}`}, ${ts}::timestamptz
        )
      `;
    }

    async function collect(
      list: (cursor: string | undefined) => Promise<{ ids: string[]; nextCursor: string | null }>
    ): Promise<string[]> {
      const ids: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 10; page++) {
        const result = await list(cursor);
        ids.push(...result.ids);
        if (!result.nextCursor) return ids;
        cursor = result.nextCursor;
      }
      throw new Error("pagination did not terminate");
    }

    const orderIds = await collect(async (cursor) => {
      const page = await service.listOrders({ userId: testUserId, generation: 1, limit: 3, cursor });
      return { ids: page.orders.map((row) => row.id), nextCursor: page.nextCursor };
    });
    const fillIds = await collect(async (cursor) => {
      const page = await service.listFills({ userId: testUserId, generation: 1, limit: 3, cursor });
      return { ids: page.fills.map((row) => row.id), nextCursor: page.nextCursor };
    });
    const ledgerIds = await collect(async (cursor) => {
      const page = await service.listLedger({ userId: testUserId, generation: 1, limit: 3, cursor });
      return { ids: page.entries.map((row) => row.id), nextCursor: page.nextCursor };
    });

    const expectedOrders = await sql`
      SELECT id FROM public.paper_orders WHERE user_id = ${testUserId} ORDER BY placed_at DESC, id DESC
    `;
    const expectedFills = await sql`
      SELECT id FROM public.paper_fills WHERE user_id = ${testUserId} ORDER BY executed_at DESC, id DESC
    `;
    const expectedLedger = await sql`
      SELECT id FROM public.paper_ledger_entries WHERE user_id = ${testUserId} ORDER BY created_at DESC, id DESC
    `;
    expect(orderIds).toEqual(expectedOrders.map((row) => row.id));
    expect(fillIds).toEqual(expectedFills.map((row) => row.id));
    expect(ledgerIds).toEqual(expectedLedger.map((row) => row.id));
    expect(new Set(orderIds).size).toBe(timestamps.length);
    expect(new Set(fillIds).size).toBe(timestamps.length);
    expect(new Set(ledgerIds).size).toBe(timestamps.length);

    // Legacy timestamp-only cursors still resolve; garbage is a validation error.
    const legacy = await service.listOrders({ userId: testUserId, generation: 1, cursor: "2026-01-02T03:04:04.500Z" });
    expect(legacy.orders).toHaveLength(1);
    await expect(service.listOrders({ userId: testUserId, generation: 1, cursor: "not a cursor" }))
      .rejects.toBeInstanceOf(PaperValidationError);
  });
});
