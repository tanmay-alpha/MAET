import { describe, expect, it, beforeAll } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import { resetConfigForTests } from "../../config";
import { computeIndianEquityCharges } from "@shared/domain/costs/indian-equity-charges";
import type { MarketPhase } from "../../domain/market/clock";
import type { Tick } from "@shared/types";
import { createPaperTradingService } from "./service";
import { paperTradingTickProcessor } from "./tick-processor";
import { PaperIdempotencyConflictError, PaperValidationError } from "./errors";

type QuoteOverrides = Partial<Pick<Tick, "price" | "volume" | "ts" | "source" | "quality" | "exchange">>;

function uniqueSymbol(prefix: string): string {
  return `${prefix}${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
}

function tick(symbol: string, price: number, volume: number, overrides: QuoteOverrides = {}): Tick {
  return {
    exchange: "NSE",
    symbol,
    price,
    volume,
    ts: new Date().toISOString(),
    source: "angelone",
    quality: "live",
    ...overrides,
  };
}

async function createTestUser(): Promise<string> {
  const userId = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`test-user-${userId}@example.com`}) ON CONFLICT DO NOTHING`;
  return userId;
}

function makeService(options: {
  prices?: Record<string, number>;
  quote?: QuoteOverrides;
  phase?: MarketPhase;
} = {}) {
  return createPaperTradingService({
    database: getDb(),
    marketPhase: () => options.phase ?? "OPEN",
    quoteLoader: async (symbol: string) => tick(symbol, options.prices?.[symbol] ?? 1000, 100, options.quote),
  });
}

async function fillsForOrder(orderId: string) {
  return getDb()
    .select()
    .from(paperFills)
    .where(eq(paperFills.orderId, orderId))
    .orderBy(asc(paperFills.executionSequence));
}

async function positionsFor(userId: string) {
  return getDb().select().from(paperPositions).where(eq(paperPositions.userId, userId));
}

/**
 * Settles a promise expected to reject. Bun 1.3's `expect(promise).rejects` can stall a
 * pending postgres.js transaction (the BEGIN reply is never processed), so await it directly.
 */
async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  return promise.then(
    () => undefined,
    (error: unknown) => error
  );
}

describe("Paper trading engine integrity", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for paper trading integration tests.");
    }
    await applyMigrations();
  });

  it("A1: never fills an order that belongs to a previous account generation", async () => {
    const symbol = uniqueSymbol("GEN");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    const placed = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 100 },
    });
    const [partial] = await paperTradingTickProcessor.processTick(tick(symbol, 990, 30));
    expect(partial?.status).toBe("PARTIALLY_FILLED");

    await service.resetAccount({ userId, confirmation: true });

    const [afterReset] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, placed.order.id));
    expect(afterReset?.status).toBe("CANCELLED");
    expect(afterReset?.filledQty).toBe(3);

    // A stale-generation order that is somehow still open must not be matched either.
    const staleOrderId = crypto.randomUUID();
    await getDb().insert(paperOrders).values({
      id: staleOrderId,
      userId,
      generation: 1,
      symbol,
      exchange: "NSE",
      side: "BUY",
      type: "LIMIT",
      status: "PENDING",
      qty: 10,
      limitPrice: "1000",
    });

    const receipts = await paperTradingTickProcessor.processTick(tick(symbol, 985, 1000));
    expect(receipts).toHaveLength(0);
    expect(await fillsForOrder(staleOrderId)).toHaveLength(0);

    const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
    expect(Number(account?.cashBalance)).toBe(1000000);
  });

  it("A2: flipping long to short in one order persists side SHORT and bumps the version", async () => {
    const symbol = uniqueSymbol("FLIP");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 10 } });
    const flipped = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 25 },
    });

    const [row] = await positionsFor(userId);
    expect(row?.side).toBe("SHORT");
    expect(row?.totalShares).toBe(15);
    expect(row?.version).toBe(2);
    expect(flipped.position?.side).toBe("SHORT");
  });

  it("A5/A14: a MARKET fill persists margins and the order's average fill price", async () => {
    const symbol = uniqueSymbol("MRG");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    const result = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 50 },
    });

    const fillPrice = Number(result.fill?.fillPrice);
    const expectedAllocated = (50 * fillPrice) / 5;
    expect(Number(result.account.allocatedMargin)).toBeCloseTo(expectedAllocated, 2);
    expect(Number(result.account.maintenanceMargin)).toBeCloseTo(expectedAllocated * 0.8, 2);
    expect(Number(result.order.averageFillPrice)).toBeCloseTo(fillPrice, 4);
    expect(result.order.filledAt).not.toBeNull();
  });

  it("A6: fills charge the statutory Indian equity schedule for the order's exchange", async () => {
    const symbol = uniqueSymbol("FEE");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    const result = await service.placeOrder({
      userId,
      command: { symbol, exchange: "BSE", side: "BUY", type: "MARKET", qty: 40 },
    });

    const fillPrice = Number(result.fill?.fillPrice);
    const expected = computeIndianEquityCharges({
      exchange: "BSE",
      product: "DELIVERY",
      side: "BUY",
      turnoverInr: fillPrice * 40,
    });
    expect(Number(result.fill?.fees)).toBeCloseTo(expected.total, 2);
    expect(Number(result.account.cashBalance)).toBeCloseTo(1000000 - expected.total, 2);

    const feeEntries = await getDb()
      .select()
      .from(paperLedgerEntries)
      .where(and(eq(paperLedgerEntries.userId, userId), eq(paperLedgerEntries.entryType, "EXECUTION_FEE")));
    expect(feeEntries).toHaveLength(1);
    expect(Number(feeEntries[0]?.amount)).toBeCloseTo(-expected.total, 2);
  });

  it("A8: MARKET bracket orders persist plain SL/TP children", async () => {
    const symbol = uniqueSymbol("BRK");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    const result = await service.placeOrder({
      userId,
      command: {
        symbol,
        exchange: "NSE",
        side: "BUY",
        type: "MARKET",
        qty: 10,
        stopLossPrice: 950,
        takeProfitPrice: 1100,
      },
    });

    const children = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, result.order.id));
    const takeProfit = children.find((child) => child.type === "LIMIT");
    const stopLoss = children.find((child) => child.type === "STOP_LOSS_LIMIT");
    expect(children).toHaveLength(2);
    expect(takeProfit?.side).toBe("SELL");
    expect(Number(takeProfit?.limitPrice)).toBe(1100);
    expect(takeProfit?.status).toBe("PENDING");
    expect(stopLoss?.side).toBe("SELL");
    expect(Number(stopLoss?.stopPrice)).toBe(950);
    expect(stopLoss?.status).toBe("TRIGGER_PENDING");
    // Children are plain exits: they must not spawn their own brackets when they fill.
    for (const child of children) {
      expect(child.stopLossPrice).toBeNull();
      expect(child.takeProfitPrice).toBeNull();
    }
  });

  it("A8: the tick path persists bracket children and OCO-cancels the sibling on exit", async () => {
    const symbol = uniqueSymbol("TBK");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    const parent = await service.placeOrder({
      userId,
      command: {
        symbol,
        exchange: "NSE",
        side: "BUY",
        type: "LIMIT",
        limitPrice: 1000,
        qty: 10,
        stopLossPrice: 950,
        takeProfitPrice: 1050,
      },
    });

    const entry = await paperTradingTickProcessor.processTick(tick(symbol, 999, 1000));
    expect(entry.map((receipt) => receipt.status)).toEqual(["FILLED"]);

    const children = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
    expect(children.map((child) => child.type).sort()).toEqual(["LIMIT", "STOP_LOSS_LIMIT"]);

    const exit = await paperTradingTickProcessor.processTick(tick(symbol, 1051, 1000));
    const takeProfit = children.find((child) => child.type === "LIMIT")!;
    expect(exit.map((receipt) => receipt.orderId)).toEqual([takeProfit.id]);

    const after = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
    expect(after.find((child) => child.type === "STOP_LOSS_LIMIT")?.status).toBe("CANCELLED");
    expect(await positionsFor(userId)).toHaveLength(0);
  });

  it("A9: re-buying a symbol after an account reset succeeds", async () => {
    const symbol = uniqueSymbol("RST");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 5 } });
    await service.resetAccount({ userId, confirmation: true });
    const rebuy = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 7 },
    });

    expect(rebuy.position?.generation).toBe(2);
    expect(rebuy.position?.totalShares).toBe(7);
  });

  it("A10: MARKET orders are rejected outside the regular session", async () => {
    const symbol = uniqueSymbol("CLS");
    const userId = await createTestUser();

    for (const phase of ["PRE_OPEN", "CLOSED", "AFTER_HOURS", "HOLIDAY"] as const) {
      const service = makeService({ prices: { [symbol]: 1000 }, phase });
      const error = await rejectionOf(
        service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 } })
      );
      expect(error).toBeInstanceOf(PaperValidationError);
    }

    const orders = await getDb().select().from(paperOrders).where(eq(paperOrders.userId, userId));
    expect(orders).toHaveLength(0);
  });

  it("A10: MARKET orders reject delayed or older-than-15s quotes by default", async () => {
    resetConfigForTests();
    const symbol = uniqueSymbol("DLY");
    const userId = await createTestUser();

    const delayed = makeService({ prices: { [symbol]: 1000 }, quote: { source: "yahoo", quality: "delayed" } });
    expect(
      await rejectionOf(
        delayed.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 } })
      )
    ).toBeInstanceOf(PaperValidationError);

    const old = makeService({
      prices: { [symbol]: 1000 },
      quote: { ts: new Date(Date.now() - 60_000).toISOString() },
    });
    expect(
      await rejectionOf(
        old.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 } })
      )
    ).toBeInstanceOf(PaperValidationError);
  });

  it("A11: idempotent replays return the original fill and position; payload changes conflict", async () => {
    const symbol = uniqueSymbol("IDM");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();
    const command = {
      symbol,
      exchange: "NSE",
      side: "BUY" as const,
      type: "MARKET" as const,
      qty: 5,
      idempotencyKey: `idem-${userId}`,
    };

    const first = await service.placeOrder({ userId, command });
    const replay = await service.placeOrder({ userId, command });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.order.id).toBe(first.order.id);
    expect(replay.fill?.id).toBe(first.fill?.id);
    expect(replay.position?.totalShares).toBe(5);

    expect(await rejectionOf(service.placeOrder({ userId, command: { ...command, qty: 6 } }))).toBeInstanceOf(
      PaperIdempotencyConflictError
    );
    expect(await rejectionOf(service.placeOrder({ userId, command: { ...command, side: "SELL" } }))).toBeInstanceOf(
      PaperIdempotencyConflictError
    );
    expect(await fillsForOrder(first.order.id)).toHaveLength(1);
  });

  it("A13: list endpoints default to the account's current generation", async () => {
    const symbol = uniqueSymbol("LST");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 2 } });
    await service.resetAccount({ userId, confirmation: true });
    const current = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 3 },
    });

    const orders = await service.listOrders({ userId });
    const fills = await service.listFills({ userId });
    const ledger = await service.listLedger({ userId });
    expect(orders.orders.map((order) => order.id)).toEqual([current.order.id]);
    expect(fills.fills.map((fill) => fill.orderId)).toEqual([current.order.id]);
    expect(ledger.entries.every((entry) => entry.generation === 2)).toBe(true);
  });

  it("A14: the unfilled remainder of a PARTIALLY_FILLED order can be cancelled", async () => {
    const symbol = uniqueSymbol("PCX");
    const service = makeService({ prices: { [symbol]: 1000 } });
    const userId = await createTestUser();

    const placed = await service.placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 100 },
    });
    await paperTradingTickProcessor.processTick(tick(symbol, 995, 40));

    const cancelled = await service.cancelOrder({ userId, orderId: placed.order.id });
    expect(cancelled.status).toBe("CANCELLED");
    expect(cancelled.filledQty).toBe(4);

    const receipts = await paperTradingTickProcessor.processTick(tick(symbol, 990, 1000));
    expect(receipts).toHaveLength(0);
    expect(await fillsForOrder(placed.order.id)).toHaveLength(1);
  });

  it("A15: new accounts use PAPER_INITIAL_CASH_INR and record an INITIAL_CASH ledger entry", async () => {
    const previous = process.env.PAPER_INITIAL_CASH_INR;
    process.env.PAPER_INITIAL_CASH_INR = "250000";
    resetConfigForTests();
    try {
      const service = makeService();
      const userId = await createTestUser();

      const state = await service.getState({ userId });
      expect(Number(state.account.cashBalance)).toBe(250000);
      expect(Number(state.account.initialCash)).toBe(250000);

      const ledger = await service.listLedger({ userId });
      const opening = ledger.entries.filter((entry) => entry.entryType === "INITIAL_CASH");
      expect(opening).toHaveLength(1);
      expect(Number(opening[0]?.amount)).toBe(250000);
      expect(opening[0]?.generation).toBe(1);
    } finally {
      if (previous === undefined) delete process.env.PAPER_INITIAL_CASH_INR;
      else process.env.PAPER_INITIAL_CASH_INR = previous;
      resetConfigForTests();
    }
  });

  describe("tick matcher against PostgreSQL", () => {
    it("ignores delayed ticks", async () => {
      const symbol = uniqueSymbol("DLT");
      const service = makeService({ prices: { [symbol]: 1000 } });
      const userId = await createTestUser();
      const placed = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 10 },
      });

      const receipts = await paperTradingTickProcessor.processTick(
        tick(symbol, 990, 1000, { source: "yahoo", quality: "delayed" })
      );
      expect(receipts).toHaveLength(0);
      expect(await fillsForOrder(placed.order.id)).toHaveLength(0);
    });

    it("keeps an order working when the fill would exceed free margin", async () => {
      const symbol = uniqueSymbol("MGN");
      const service = makeService({ prices: { [symbol]: 1000 } });
      const userId = await createTestUser();
      const placed = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 6000 },
      });

      const receipts = await paperTradingTickProcessor.processTick(tick(symbol, 1000, 100000));
      expect(receipts).toHaveLength(0);
      const [order] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, placed.order.id));
      expect(order?.status).toBe("PENDING");
      expect(order?.filledQty).toBe(0);
    });

    it("does not match orders of a locked account", async () => {
      const symbol = uniqueSymbol("LCK");
      const service = makeService({ prices: { [symbol]: 1000 } });
      const userId = await createTestUser();
      const placed = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 10 },
      });
      await getDb()
        .update(paperAccounts)
        .set({ status: "LIQUIDATION_PENDING", isLocked: true })
        .where(eq(paperAccounts.userId, userId));

      expect(await paperTradingTickProcessor.processTick(tick(symbol, 990, 1000))).toHaveLength(0);
      expect(await fillsForOrder(placed.order.id)).toHaveLength(0);
    });

    it("triggers a stop-limit on a gap through the stop and fills only once the limit is reachable", async () => {
      const symbol = uniqueSymbol("STP");
      const service = makeService({ prices: { [symbol]: 1000 } });
      const userId = await createTestUser();
      await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 10 } });
      const stop = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "SELL", type: "STOP_LOSS_LIMIT", stopPrice: 990, limitPrice: 985, qty: 10 },
      });
      expect(stop.order.status).toBe("TRIGGER_PENDING");

      expect(await paperTradingTickProcessor.processTick(tick(symbol, 970, 1000))).toHaveLength(0);
      const [triggered] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, stop.order.id));
      expect(triggered?.status).toBe("TRIGGERED");
      expect(triggered?.triggeredAt).not.toBeNull();

      const receipts = await paperTradingTickProcessor.processTick(tick(symbol, 986, 1000));
      expect(receipts.map((receipt) => receipt.status)).toEqual(["FILLED"]);
      const [fill] = await fillsForOrder(stop.order.id);
      expect(fill?.executionReason).toBe("STOP_TRIGGER");
      expect(Number(fill?.fillPrice)).toBeGreaterThanOrEqual(985);
      expect(await positionsFor(userId)).toHaveLength(0);
    });
  });
});
