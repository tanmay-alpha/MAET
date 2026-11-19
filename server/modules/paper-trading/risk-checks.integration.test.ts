import { beforeAll, describe, expect, it } from "bun:test";
import { and, eq } from "drizzle-orm";
import { getDb, getSqlClient } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import type { Tick } from "@shared/types";
import { PaperValidationError } from "./errors";
import { createPaperTradingService } from "./service";
import { PaperTradingTickProcessor } from "./tick-processor";
import type { MarkPriceSource } from "./fill-writer";

function uniqueSymbol(prefix: string): string {
  return `${prefix}${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function tick(symbol: string, price: number, volume: number): Tick {
  return { exchange: "NSE", symbol, price, volume, ts: new Date().toISOString(), source: "angelone", quality: "live" };
}

async function createTestUser(): Promise<string> {
  const userId = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`test-user-${userId}@example.com`}) ON CONFLICT DO NOTHING`;
  return userId;
}

/** Service quoting from a mutable price table; `now` strictly increases so ledger rows have a total order. */
function makeService(prices: Map<string, number>, markFor: MarkPriceSource = () => undefined) {
  let clock = Date.now();
  return createPaperTradingService({
    database: getDb(),
    marketPhase: () => "OPEN",
    quoteLoader: async (exchange, symbol) => ({ ...tick(symbol, prices.get(symbol) ?? 1000, 100), exchange }),
    markFor,
    now: () => new Date((clock += 1_000)),
    // Synthetic test symbols are not in the symbol master.
    symbolExists: async () => true,
  });
}

async function setCash(userId: string, cash: number): Promise<void> {
  await getDb().update(paperAccounts).set({ cashBalance: cash.toFixed(4) }).where(eq(paperAccounts.userId, userId));
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

describe("paper risk checks against PostgreSQL", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for paper risk-check integration tests.");
    }
    await applyMigrations();
  });

  it("marks other open positions at the live price, not at their last fill, before a new order", async () => {
    const held = uniqueSymbol("MKA");
    const traded = uniqueSymbol("MKB");
    const userId = await createTestUser();
    const marks = new Map<string, number>();
    const service = makeService(new Map([[held, 1000], [traded, 1000]]), (exchange, symbol) =>
      exchange === "NSE" ? marks.get(symbol) : undefined
    );
    await service.getState({ userId });
    await setCash(userId, 100_000);
    await service.placeOrder({ userId, command: { symbol: held, exchange: "NSE", side: "BUY", type: "MARKET", qty: 100 } });

    // The held stock now trades at 800: equity is ~80,000, short of the ~90,000 of margin
    // that 100 held plus 350 new shares need. Its stored P&L still says ~0.
    marks.set(held, 800);
    const order = { symbol: traded, exchange: "NSE", side: "BUY" as const, type: "MARKET" as const, qty: 350 };
    const rejection = await rejectionOf(service.placeOrder({ userId, command: order }));
    expect(rejection).toBeInstanceOf(PaperValidationError);
    expect((rejection as Error).message).toContain("projected free margin");

    marks.set(held, 1000);
    const accepted = await service.placeOrder({ userId, command: order });
    expect(accepted.order.status).toBe("FILLED");
  });

  it("fills a stop-loss exit on an under-margined account, and only from volume that traded", async () => {
    const symbol = uniqueSymbol("RRD");
    const userId = await createTestUser();
    const service = makeService(new Map([[symbol, 1000]]));
    const entry = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 100, stopLossPrice: 950 },
    });
    const [stop] = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, entry.order.id));
    // 20,010 of margin is allocated; 15,000 of cash leaves the account under-margined.
    await setCash(userId, 15_000);

    const processor = new PaperTradingTickProcessor(() => undefined);
    expect(await processor.processTick(tick(symbol, 1001, 10_000))).toEqual([]);
    // 50 shares traded through the stop: the exit may take 5 and must not be refused for margin.
    const partial = await processor.processTick(tick(symbol, 949, 10_050));
    expect(partial.map((receipt) => [receipt.orderId, receipt.status, receipt.quantity])).toEqual([
      [stop!.id, "PARTIALLY_FILLED", 5],
    ]);

    // A quote with no new volume moves the price but fills nothing.
    expect(await processor.processTick(tick(symbol, 948, 10_050))).toEqual([]);
    const [position] = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId));
    expect(position?.totalShares).toBe(95);

    const rest = await processor.processTick(tick(symbol, 947, 11_050));
    expect(rest.map((receipt) => [receipt.status, receipt.quantity])).toEqual([["FILLED", 95]]);
    expect(await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId))).toHaveLength(0);
  });

  it("replaying the ledger reproduces the running cash after every row, with one fee per fill (seeded orders)", async () => {
    const symbols = [uniqueSymbol("LGA"), uniqueSymbol("LGB")];
    const prices = new Map(symbols.map((symbol) => [symbol, 1000]));
    const userId = await createTestUser();
    const service = makeService(prices);
    let state = 0x1ed6e5;
    const random = () => {
      state = (Math.imul(state, 1_103_515_245) + 12_345) >>> 0;
      return state / 4_294_967_296;
    };
    for (let index = 0; index < 24; index++) {
      const symbol = symbols[Math.floor(random() * symbols.length)]!;
      prices.set(symbol, Math.round(prices.get(symbol)! * (0.95 + random() * 0.1) * 100) / 100);
      await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: random() < 0.5 ? "BUY" : "SELL", type: "MARKET", qty: 1 + Math.floor(random() * 40) },
      });
    }

    const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    const fills = await getDb().select().from(paperFills).where(eq(paperFills.userId, userId));
    const precedence: Record<string, number> = { INITIAL_CASH: 0, TRADE_REALIZED_PNL: 1, EXECUTION_FEE: 2 };
    const ledger = (
      await getDb()
        .select()
        .from(paperLedgerEntries)
        .where(and(eq(paperLedgerEntries.userId, userId), eq(paperLedgerEntries.generation, account!.generation)))
    ).sort(
      (left, right) =>
        left.createdAt.getTime() - right.createdAt.getTime() ||
        precedence[left.entryType]! - precedence[right.entryType]!
    );
    expect(fills).toHaveLength(24);
    expect(ledger[0]?.entryType).toBe("INITIAL_CASH");
    expect(ledger).toHaveLength(1 + 2 * fills.length);

    let balance = 0;
    for (const entry of ledger) {
      balance += Number(entry.amount);
      expect(Number(entry.balanceAfter)).toBeCloseTo(balance, 4);
      balance = Number(entry.balanceAfter);
    }
    expect(balance).toBeCloseTo(Number(account!.cashBalance), 4);

    // Each fill charges its fee exactly once and books its realised P&L exactly once.
    for (const fill of fills) {
      const rows = ledger.filter((entry) => entry.fillId === fill.id);
      expect(rows.map((entry) => entry.entryType)).toEqual(["TRADE_REALIZED_PNL", "EXECUTION_FEE"]);
      expect(Number(rows[0]!.amount)).toBeCloseTo(Number(fill.realizedPnl), 4);
      expect(Number(rows[1]!.amount)).toBeCloseTo(-Number(fill.fees), 4);
    }
    const realised = fills.reduce((sum, fill) => sum + Number(fill.realizedPnl), 0);
    expect(Number(account!.realisedPnl)).toBeCloseTo(realised, 3);
  });

  it("concurrent deliveries of one idempotency key create one order and one fill", async () => {
    const symbol = uniqueSymbol("DUP");
    const userId = await createTestUser();
    const service = makeService(new Map([[symbol, 1000]]));
    await service.getState({ userId });
    const command = { symbol, exchange: "NSE", side: "BUY" as const, type: "MARKET" as const, qty: 7, idempotencyKey: `dup-${userId}` };

    const results = await Promise.all([1, 2, 3].map(() => service.placeOrder({ userId, command })));
    expect(new Set(results.map((result) => result.order.id)).size).toBe(1);
    expect(results.filter((result) => !result.idempotentReplay)).toHaveLength(1);

    const orders = await getDb().select().from(paperOrders).where(eq(paperOrders.userId, userId));
    expect(orders).toHaveLength(1);
    expect(await getDb().select().from(paperFills).where(eq(paperFills.orderId, orders[0]!.id))).toHaveLength(1);
    const [position] = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId));
    expect(position?.totalShares).toBe(7);
  });
});
