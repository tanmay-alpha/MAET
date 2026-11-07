import { beforeAll, describe, expect, it } from "bun:test";
import { and, asc, eq, sql } from "drizzle-orm";
import { getDb, getSqlClient } from "../../data/drizzle/client";
import { paperAccounts, paperLedgerEntries, paperPortfolioSnapshots, paperPositions } from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import type { Tick } from "@shared/types";
import { createPaperTradingService } from "./service";
import {
  createPaperPortfolioSnapshotService,
  END_OF_DAY_LOCK_KEY,
  type SnapshotPrice,
} from "./portfolio-snapshots";

// Synthetic trading days (Mon-Thu) in the past; no holidays are configured for these tests.
const D1 = "2026-10-05";
const D2 = "2026-10-06";
const D3 = "2026-10-07";
const D4 = "2026-10-08";

/** IST wall-clock time as a Date (IST = UTC+05:30). */
function ist(date: string, time: string): Date {
  return new Date(Date.parse(`${date}T${time}:00.000+05:30`));
}

function uniqueSymbol(prefix: string): string {
  return `${prefix}${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

async function createTestUser(): Promise<string> {
  const userId = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`snap-${userId}@example.com`}) ON CONFLICT DO NOTHING`;
  return userId;
}

function tradingService(price: number) {
  return createPaperTradingService({
    database: getDb(),
    marketPhase: () => "OPEN",
    quoteLoader: async (exchange: "NSE" | "BSE", symbol: string): Promise<Tick> => ({
      exchange,
      symbol,
      price,
      volume: 100,
      ts: new Date().toISOString(),
      source: "angelone",
      quality: "live",
    }),
    // Synthetic test symbols are not in the symbol master.
    symbolExists: async () => true,
  });
}

/** A quote printed at 15:29 IST on `date`. */
function closeQuote(price: number, date: string): SnapshotPrice {
  return { price, ts: ist(date, "15:29").toISOString(), source: "angelone", quality: "delayed" };
}

function snapshotService(price: (symbol: string) => SnapshotPrice | null) {
  return createPaperPortfolioSnapshotService({
    database: getDb(),
    holidays: () => [],
    loadPrice: async (_exchange, symbol) => price(symbol),
  });
}

/**
 * The engine stamps fills with the real clock. Re-date the account's start
 * and its positions' last fill quote so the synthetic sessions follow them.
 */
async function backdate(userId: string, accountStart: string, lastFill: Date): Promise<void> {
  await getDb()
    .update(paperAccounts)
    .set({ createdAt: new Date(`${accountStart}T00:00:00.000Z`) })
    .where(eq(paperAccounts.userId, userId));
  await getDb().update(paperPositions).set({ lastQuoteTimestamp: lastFill }).where(eq(paperPositions.userId, userId));
}

/** Buys 10 at 1000, then sells 4 at 1100: an open long of 6 plus realised P&L and fees. */
async function seedTradedAccount(): Promise<{ userId: string; symbol: string }> {
  const userId = await createTestUser();
  const symbol = uniqueSymbol("SNAP");
  await tradingService(1000).placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 10 } });
  await tradingService(1100).placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 4 } });
  await backdate(userId, "2026-09-01", ist(D1, "10:00"));
  return { userId, symbol };
}

async function snapshotsOf(userId: string) {
  return getDb()
    .select()
    .from(paperPortfolioSnapshots)
    .where(eq(paperPortfolioSnapshots.userId, userId))
    .orderBy(asc(paperPortfolioSnapshots.generation), asc(paperPortfolioSnapshots.snapshotDate));
}

async function ledgerTotals(userId: string, generation: number) {
  const [row] = await getDb()
    .select({
      initial: sql<string>`coalesce(sum(${paperLedgerEntries.amount}) filter (where ${paperLedgerEntries.entryType} = 'INITIAL_CASH'), 0)`,
      realized: sql<string>`coalesce(sum(${paperLedgerEntries.amount}) filter (where ${paperLedgerEntries.entryType} = 'TRADE_REALIZED_PNL'), 0)`,
      fees: sql<string>`coalesce(-sum(${paperLedgerEntries.amount}) filter (where ${paperLedgerEntries.entryType} = 'EXECUTION_FEE'), 0)`,
    })
    .from(paperLedgerEntries)
    .where(and(eq(paperLedgerEntries.userId, userId), eq(paperLedgerEntries.generation, generation)));
  return { initial: Number(row!.initial), realized: Number(row!.realized), fees: Number(row!.fees) };
}

describe("Paper portfolio snapshots", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for paper portfolio snapshot integration tests.");
    }
    await applyMigrations();
  });

  it("writes one idempotent end-of-day snapshot that reconciles with the ledger", async () => {
    const { userId, symbol } = await seedTradedAccount();
    const snapshots = snapshotService((s) => (s === symbol ? closeQuote(1050, D1) : null));

    const first = await snapshots.captureAccount(userId, { now: ist(D1, "16:00"), capturedBy: "SCHEDULER" });
    expect(first.status).toBe("written");

    const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    const [position] = await getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId));
    const ledger = await ledgerTotals(userId, 1);
    expect(ledger.realized).toBeGreaterThan(0);
    expect(ledger.fees).toBeGreaterThan(0);

    const [row] = await snapshotsOf(userId);
    const cash = Number(row!.cashBalance);
    const realized = Number(row!.realizedPnl);
    const fees = Number(row!.feesToDate);
    // cash = initial + realised - fees, against the ledger and the account row.
    expect(cash).toBeCloseTo(Number(account!.initialCash) + realized - fees, 4);
    expect(cash).toBeCloseTo(ledger.initial + ledger.realized - ledger.fees, 4);
    expect(cash).toBeCloseTo(Number(account!.cashBalance), 4);
    expect(realized).toBeCloseTo(ledger.realized, 4);
    expect(realized).toBeCloseTo(Number(account!.realisedPnl), 4);
    expect(fees).toBeCloseTo(ledger.fees, 4);

    const unrealized = 6 * (1050 - Number(position!.averageEntryPrice));
    expect(row).toMatchObject({
      generation: 1,
      snapshotDate: D1,
      positionsCount: 1,
      stalePrices: false,
      priceSource: "angelone",
      isFinal: true,
      capturedBy: "SCHEDULER",
    });
    expect(Number(row!.positionsMarketValue)).toBeCloseTo(6 * 1050, 4);
    expect(Number(row!.unrealizedPnl)).toBeCloseTo(unrealized, 4);
    expect(Number(row!.equity)).toBeCloseTo(cash + unrealized, 4);
    expect(row!.positionPrices).toEqual([
      expect.objectContaining({ symbol, quantity: 6, price: 1050, source: "angelone", stale: false }),
    ]);

    // Re-running for the same session, even at a different price, changes nothing.
    const again = await snapshotService(() => closeQuote(1200, D1)).captureAccount(userId, {
      now: ist(D1, "18:00"),
      capturedBy: "SCHEDULER",
    });
    expect(again.status).toBe("unchanged");
    const rows = await snapshotsOf(userId);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual(row!);
  });

  it("replaces a provisional intraday snapshot at the close and never rewrites a final one", async () => {
    const { userId } = await seedTradedAccount();
    let price = 1000;
    const snapshots = snapshotService(() => ({ ...closeQuote(price, D1), ts: ist(D1, "10:59").toISOString() }));

    expect(await snapshots.ensureCurrentSnapshot(userId, ist(D1, "11:00"))).toBe("written");
    price = 1020;
    expect(await snapshots.ensureCurrentSnapshot(userId, ist(D1, "12:00"))).toBe("existing");
    let [row] = await snapshotsOf(userId);
    expect(row).toMatchObject({ isFinal: false, capturedBy: "ON_READ" });
    expect(row!.positionPrices).toEqual([expect.objectContaining({ price: 1000 })]);

    price = 1080;
    expect(await snapshots.ensureCurrentSnapshot(userId, ist(D1, "16:00"))).toBe("written");
    [row] = await snapshotsOf(userId);
    expect(row!.isFinal).toBe(true);
    expect(row!.positionPrices).toEqual([expect.objectContaining({ price: 1080 })]);

    price = 1200;
    expect(await snapshots.ensureCurrentSnapshot(userId, ist(D1, "17:00"))).toBe("existing");
    const after = await snapshotsOf(userId);
    expect(after).toHaveLength(1);
    expect(after[0]).toEqual(row!);
  });

  it("replaces a final snapshot valued with stale prices by a later closing valuation, never the reverse", async () => {
    const { userId } = await seedTradedAccount();

    // The feed is down at the close: only the morning fill price exists, which is not a close.
    expect(await snapshotService(() => null).ensureCurrentSnapshot(userId, ist(D1, "16:00"))).toBe("written");
    let [row] = await snapshotsOf(userId);
    expect(row).toMatchObject({ isFinal: true, stalePrices: true, priceSource: "last_fill:angelone" });

    // A later read with a closing quote repairs it.
    expect(await snapshotService(() => closeQuote(1050, D1)).ensureCurrentSnapshot(userId, ist(D1, "17:00"))).toBe("written");
    [row] = await snapshotsOf(userId);
    expect(row).toMatchObject({ isFinal: true, stalePrices: false, priceSource: "angelone" });
    expect(row!.positionPrices).toEqual([expect.objectContaining({ price: 1050 })]);

    // A stale valuation never overwrites a good close.
    const stale = await snapshotService(() => null).captureAccount(userId, { now: ist(D1, "18:00"), capturedBy: "ON_READ" });
    expect(stale.status).toBe("unchanged");
    expect(await snapshotsOf(userId)).toEqual([row!]);
  });

  it("finalises a provisional snapshot before the next open, and flags one the instance slept through", async () => {
    const intraday = (date: string) => snapshotService(() => ({ ...closeQuote(1000, date), ts: ist(date, "10:59").toISOString() }));

    // Read at 11:00, asleep through the close, awake before the next open: the close is still recorded.
    const caughtUp = await seedTradedAccount();
    expect(await intraday(D1).ensureCurrentSnapshot(caughtUp.userId, ist(D1, "11:00"))).toBe("written");
    expect(await snapshotService(() => closeQuote(1040, D1)).ensureCurrentSnapshot(caughtUp.userId, ist(D2, "08:00"))).toBe("written");
    const [finalised] = await snapshotsOf(caughtUp.userId);
    expect(finalised).toMatchObject({ snapshotDate: D1, isFinal: true, stalePrices: false });

    // Asleep until the next session had opened: D1 keeps its intraday value, flagged as provisional.
    const slept = await seedTradedAccount();
    expect(await intraday(D1).ensureCurrentSnapshot(slept.userId, ist(D1, "11:00"))).toBe("written");
    const analytics = await intraday(D2).getAnalytics(slept.userId, { now: ist(D2, "11:00") });
    expect(analytics.curve.map((point) => [point.date, point.isFinal])).toEqual([[D1, false], [D2, false]]);
    // D2 is today's intraday point; only D1 is a past provisional snapshot.
    expect(analytics.metrics.provisionalSnapshotCount).toBe(1);
  });

  it("measures total return from the generation's initial cash", async () => {
    const { userId, symbol } = await seedTradedAccount();
    const snapshots = snapshotService((s) => (s === symbol ? closeQuote(1050, D1) : null));
    await snapshots.captureAccount(userId, { now: ist(D1, "16:00"), capturedBy: "SCHEDULER" });

    const analytics = await snapshots.getAnalytics(userId, { now: ist(D1, "17:00") });
    expect(analytics.anchor).toEqual({ date: "2026-09-01", equity: 1_000_000 });
    const equity = analytics.curve[0]!.equity;
    expect(equity).not.toBe(1_000_000);
    expect(analytics.metrics.firstDate).toBe("2026-09-01");
    expect(analytics.metrics.totalReturn.value).toBeCloseTo(equity / 1_000_000 - 1, 12);
  });

  it("flags stale prices instead of silently valuing at entry prices", async () => {
    const { userId, symbol } = await seedTradedAccount();

    // Only a quote from the previous session exists.
    await snapshotService(() => closeQuote(990, "2026-10-02")).captureAccount(userId, {
      now: ist(D2, "16:00"),
      capturedBy: "SCHEDULER",
    });
    // No quote and no last-fill price: the entry price is used, labelled and flagged.
    await getDb().update(paperPositions).set({ lastQuotePrice: null, lastQuoteTimestamp: null }).where(eq(paperPositions.userId, userId));
    await snapshotService(() => null).captureAccount(userId, { now: ist(D3, "16:00"), capturedBy: "SCHEDULER" });

    const [d2, d3] = await snapshotsOf(userId);
    // D2: the D1 last-fill quote is newer than the 10-02 quote, but neither is from D2.
    expect(d2).toMatchObject({ snapshotDate: D2, stalePrices: true, priceSource: "last_fill:angelone" });
    expect(d3).toMatchObject({ snapshotDate: D3, stalePrices: true, priceSource: "entry_price" });
    expect(Number(d3!.unrealizedPnl)).toBe(0);
    expect(d3!.positionPrices).toEqual([expect.objectContaining({ symbol, source: "entry_price", stale: true, asOf: null })]);
  });

  it("starts a new curve when the account is reset", async () => {
    const { userId, symbol } = await seedTradedAccount();
    const prices: Record<string, number> = { [D1]: 1050, [D2]: 1100, [D3]: 1000, [D4]: 1000 };
    const at = (date: string) => snapshotService((s) => (s === symbol ? closeQuote(prices[date]!, date) : null));

    await at(D1).captureAccount(userId, { now: ist(D1, "16:00"), capturedBy: "SCHEDULER" });
    await at(D2).captureAccount(userId, { now: ist(D2, "16:00"), capturedBy: "SCHEDULER" });
    const beforeReset = await at(D2).getAnalytics(userId, { now: ist(D2, "17:00") });
    expect(beforeReset.account?.generation).toBe(1);
    expect(beforeReset.curve.map((point) => point.date)).toEqual([D1, D2]);
    expect(beforeReset.metrics.totalReturn.value).not.toBeNull();

    await tradingService(1000).resetAccount({ userId, confirmation: true });
    await getDb()
      .update(paperAccounts)
      .set({ resetAt: ist(D2, "17:30") })
      .where(eq(paperAccounts.userId, userId));

    const afterReset = await at(D3).getAnalytics(userId, { now: ist(D3, "16:00") });
    expect(afterReset.onDemandSnapshot).toBe("written");
    expect(afterReset.account).toEqual({ generation: 2, initialCash: 1_000_000, status: "ACTIVE" });
    expect(afterReset.curve).toHaveLength(1);
    expect(afterReset.curve[0]).toMatchObject({ date: D3, equity: 1_000_000, positionsCount: 0, priceSource: "none" });
    // Measured from the reset's initial cash; one return is too few for volatility.
    expect(afterReset.anchor).toEqual({ date: D2, equity: 1_000_000 });
    expect(afterReset.metrics.totalReturn.value).toBe(0);
    expect(afterReset.metrics.gapCount).toBe(0);
    expect(afterReset.metrics.volatility.value).toBeNull();
    expect(afterReset.metrics.volatility.reason).toContain("Insufficient history");

    const next = await at(D4).getAnalytics(userId, { now: ist(D4, "16:00") });
    expect(next.curve.map((point) => point.date)).toEqual([D3, D4]);
    expect(next.metrics.totalReturn.value).toBe(0);

    // The first generation's curve is kept, separately.
    const rows = await snapshotsOf(userId);
    expect(rows.map((row) => `${row.generation}:${row.snapshotDate}`)).toEqual([`1:${D1}`, `1:${D2}`, `2:${D3}`, `2:${D4}`]);
  });

  it("does not invent snapshots for sessions before the generation began", async () => {
    const userId = await createTestUser();
    // Creates the account (generation 1) and resets it to generation 2.
    await tradingService(1000).resetAccount({ userId, confirmation: true });
    await getDb().update(paperAccounts).set({ createdAt: ist(D1, "09:00"), resetAt: ist(D3, "12:00") }).where(eq(paperAccounts.userId, userId));

    const result = await snapshotService(() => null).getAnalytics(userId, { now: ist(D2, "16:00") });
    expect(result.onDemandSnapshot).toBe("generation_not_started");
    expect(result.curve).toEqual([]);
  });

  it("reports a missing account without creating one", async () => {
    const userId = await createTestUser();
    const result = await snapshotService(() => null).getAnalytics(userId, { now: ist(D1, "16:00") });
    expect(result).toMatchObject({ account: null, reason: "No paper trading account yet", curve: [], onDemandSnapshot: "no_account" });
    expect(await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId))).toHaveLength(0);
  });

  it("the end-of-day run snapshots each open account once and yields to a concurrent run", async () => {
    const a = await seedTradedAccount();
    const b = await seedTradedAccount();
    const snapshots = snapshotService(() => null);

    expect((await snapshots.runEndOfDay(ist(D2, "11:00"))).status).toBe("session_open");
    expect(await snapshotsOf(a.userId)).toHaveLength(0);

    const first = await snapshots.runEndOfDay(ist(D2, "16:00"));
    expect(first.status).toBe("ran");
    expect(first.failed).toBe(0);
    expect(first.written).toBeGreaterThanOrEqual(2);
    const [rowA] = await snapshotsOf(a.userId);
    const [rowB] = await snapshotsOf(b.userId);
    expect(rowA).toMatchObject({ snapshotDate: D2, isFinal: true, capturedBy: "SCHEDULER" });
    expect(rowB).toMatchObject({ snapshotDate: D2, isFinal: true, capturedBy: "SCHEDULER" });

    // A second run finds nothing left to do for these accounts.
    await snapshots.runEndOfDay(ist(D2, "16:01"));
    expect(await snapshotsOf(a.userId)).toEqual([rowA!]);

    // Another holder of the advisory lock makes the run skip.
    const holder = await getSqlClient().reserve();
    try {
      await holder`SELECT pg_advisory_lock(hashtext(${END_OF_DAY_LOCK_KEY}))`;
      expect((await snapshots.runEndOfDay(ist(D3, "16:00"))).status).toBe("locked");
    } finally {
      await holder`SELECT pg_advisory_unlock(hashtext(${END_OF_DAY_LOCK_KEY}))`;
      holder.release();
    }
    expect(await snapshotsOf(a.userId)).toHaveLength(1);
  });
});
