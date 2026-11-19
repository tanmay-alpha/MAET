import { describe, expect, it, beforeAll } from "bun:test";
import { and, asc, eq } from "drizzle-orm";
import { getSqlClient, getDb } from "../../data/drizzle/client";
import { paperAccounts, paperFills, paperLedgerEntries, paperOrders, paperPositions } from "../../db/schema";
import { applyMigrations } from "../../scripts/apply-migrations";
import { resetConfigForTests } from "../../config";
import { computeIndianEquityCharges } from "@shared/domain/costs/indian-equity-charges";
import type { MarketPhase } from "../../domain/market/clock";
import type { Tick } from "@shared/types";
import { createPaperTradingService, MAX_WORKING_ORDERS_PER_USER } from "./service";
import { paperTradingTickProcessor } from "./tick-processor";
import { PaperRiskMonitor } from "./risk-monitor";
import { PaperIdempotencyConflictError, PaperValidationError } from "./errors";
import { quoteStore } from "../../domain/market/quote-store";

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
    quoteLoader: async (exchange: "NSE" | "BSE", symbol: string) =>
      tick(symbol, options.prices?.[symbol] ?? 1000, 100, { exchange, ...options.quote }),
    // Synthetic test symbols are not in the symbol master.
    symbolExists: async () => true,
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
 * Tick volume is the cumulative session volume; the matcher sizes fills from the change
 * since the previous tick. A first, non-marketable tick sets that baseline.
 */
async function primeVolume(symbol: string, price: number, volume = 0): Promise<void> {
  expect(await paperTradingTickProcessor.processTick(tick(symbol, price, volume))).toEqual([]);
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
    await primeVolume(symbol, 1001);
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
    const stopLoss = children.find((child) => child.type === "STOP_LOSS_MARKET");
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

    await primeVolume(symbol, 1001);
    const entry = await paperTradingTickProcessor.processTick(tick(symbol, 999, 1000));
    expect(entry.map((receipt) => receipt.status)).toEqual(["FILLED"]);

    const children = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
    expect(children.map((child) => child.type).sort()).toEqual(["LIMIT", "STOP_LOSS_MARKET"]);
    expect(children.map((child) => child.qty)).toEqual([10, 10]);

    const exit = await paperTradingTickProcessor.processTick(tick(symbol, 1051, 2000));
    const takeProfit = children.find((child) => child.type === "LIMIT")!;
    expect(exit.map((receipt) => receipt.orderId)).toEqual([takeProfit.id]);

    const after = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
    expect(after.find((child) => child.type === "STOP_LOSS_MARKET")?.status).toBe("CANCELLED");
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
    await primeVolume(symbol, 1001);
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

      await primeVolume(symbol, 1001);
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

      await primeVolume(symbol, 1000);
      expect(await paperTradingTickProcessor.processTick(tick(symbol, 970, 1000))).toHaveLength(0);
      const [triggered] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, stop.order.id));
      expect(triggered?.status).toBe("TRIGGERED");
      expect(triggered?.triggeredAt).not.toBeNull();

      const receipts = await paperTradingTickProcessor.processTick(tick(symbol, 986, 2000));
      expect(receipts.map((receipt) => receipt.status)).toEqual(["FILLED"]);
      const [fill] = await fillsForOrder(stop.order.id);
      expect(fill?.executionReason).toBe("STOP_TRIGGER");
      expect(Number(fill?.fillPrice)).toBeGreaterThanOrEqual(985);
      expect(await positionsFor(userId)).toHaveLength(0);
    });
  });

  describe("review follow-ups", () => {
    /**
     * Real default quote wiring. The provider HTTP boundary (Angel One REST, Yahoo) is faked as
     * unavailable and every call is recorded; the Angel One WS feed is faked via quoteStore.
     */
    async function withProvidersDown<T>(run: (calls: string[]) => Promise<T>): Promise<T> {
      const originalFetch = globalThis.fetch;
      const calls: string[] = [];
      globalThis.fetch = (async (input: string | URL | Request) => {
        calls.push(String(input instanceof Request ? input.url : input));
        return new Response("not found", { status: 404 });
      }) as typeof fetch;
      try {
        return await run(calls);
      } finally {
        globalThis.fetch = originalFetch;
      }
    }

    function defaultWiredService() {
      return createPaperTradingService({ database: getDb(), marketPhase: () => "OPEN" });
    }

    it("#1: a fresh streamed Angel One tick prices MARKET orders without any provider refetch", async () => {
      const userId = await createTestUser();
      quoteStore.set(tick("AXISBANK", 1111, 5000));
      const result = await withProvidersDown(async (calls) => {
        const placed = await defaultWiredService().placeOrder({
          userId,
          command: { symbol: "AXISBANK", exchange: "NSE", side: "BUY", type: "MARKET", qty: 2 },
        });
        expect(calls).toEqual([]);
        return placed;
      });
      expect(Number(result.fill?.referencePrice)).toBe(1111);
      expect(result.fill?.quoteSource).toBe("angelone");
    });

    it("#1: a stale streamed tick is not executed; the market-data fallback must supply a live quote", async () => {
      const userId = await createTestUser();
      quoteStore.set(tick("ADANIPORTS", 1234, 5000, { ts: new Date(Date.now() - 60_000).toISOString() }));
      await withProvidersDown(async () => {
        const error = await rejectionOf(
          defaultWiredService().placeOrder({
            userId,
            command: { symbol: "ADANIPORTS", exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 },
          })
        );
        expect(error).toBeInstanceOf(PaperValidationError);
      });
      expect(await getDb().select().from(paperOrders).where(eq(paperOrders.userId, userId))).toHaveLength(0);
    });

    it("#1/#10: a MARKET order never fills against a quote from another exchange", async () => {
      const userId = await createTestUser();
      quoteStore.set(tick("ASIANPAINT", 2500, 5000));
      await withProvidersDown(async () => {
        const error = await rejectionOf(
          defaultWiredService().placeOrder({
            userId,
            command: { symbol: "ASIANPAINT", exchange: "BSE", side: "BUY", type: "MARKET", qty: 1 },
          })
        );
        expect(error).toBeInstanceOf(PaperValidationError);
      });

      const mismatched = createPaperTradingService({
        database: getDb(),
        marketPhase: () => "OPEN",
        quoteLoader: async (_exchange, symbol) => tick(symbol, 1000, 100, { exchange: "NSE" }),
      });
      const error = await rejectionOf(
        mismatched.placeOrder({ userId, command: { symbol: "ASIANPAINT", exchange: "BSE", side: "BUY", type: "MARKET", qty: 1 } })
      );
      expect(error).toBeInstanceOf(PaperValidationError);
      expect(await getDb().select().from(paperOrders).where(eq(paperOrders.userId, userId))).toHaveLength(0);
    });

    it("rejects an order on a symbol the symbol master does not list, and writes nothing", async () => {
      const userId = await createTestUser();
      await withProvidersDown(async () => {
        const error = await rejectionOf(
          defaultWiredService().placeOrder({
            userId,
            command: { symbol: uniqueSymbol("NOPE"), exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 100, qty: 1 },
          })
        );
        expect(error).toBeInstanceOf(PaperValidationError);
      });
      expect(await getDb().select().from(paperOrders).where(eq(paperOrders.userId, userId))).toHaveLength(0);
    });

    it("caps the working orders a user may hold at once", async () => {
      const symbol = uniqueSymbol("CAP");
      const userId = await createTestUser();
      const service = makeService();
      const limitBuy = { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1, qty: 1 } as const;
      const first = await service.placeOrder({ userId, command: limitBuy });
      await getDb().insert(paperOrders).values(
        Array.from({ length: MAX_WORKING_ORDERS_PER_USER - 1 }, () => ({
          id: crypto.randomUUID(),
          userId,
          generation: first.order.generation,
          symbol,
          exchange: "NSE",
          side: "BUY" as const,
          type: "LIMIT" as const,
          status: "PENDING" as const,
          qty: 1,
          limitPrice: "1",
        }))
      );

      const error = await rejectionOf(service.placeOrder({ userId, command: limitBuy }));
      expect(error).toBeInstanceOf(PaperValidationError);

      await service.cancelOrder({ userId, orderId: first.order.id });
      const placed = await service.placeOrder({ userId, command: limitBuy });
      expect(placed.order.status).toBe("PENDING");
    });

    it("#2: bracket exits never close past the position (partial TP, then SL)", async () => {
      const symbol = uniqueSymbol("OCO");
      const userId = await createTestUser();
      const parent = await makeService({ prices: { [symbol]: 1000 } }).placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 100, stopLossPrice: 950, takeProfitPrice: 1050 },
      });

      await primeVolume(symbol, 1000);
      const tp = await paperTradingTickProcessor.processTick(tick(symbol, 1050, 100));
      expect(tp.map((receipt) => [receipt.status, receipt.quantity])).toEqual([["PARTIALLY_FILLED", 10]]);

      const afterTp = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
      expect(afterTp.find((child) => child.type === "STOP_LOSS_MARKET")?.qty).toBe(90);

      const sl = await paperTradingTickProcessor.processTick(tick(symbol, 950, 100100));
      expect(sl.map((receipt) => [receipt.status, receipt.quantity])).toEqual([["FILLED", 90]]);

      expect(await positionsFor(userId)).toHaveLength(0);
      const after = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
      const takeProfit = after.find((child) => child.type === "LIMIT");
      expect(takeProfit?.status).toBe("CANCELLED");
      expect(takeProfit?.filledQty).toBe(10);
    });

    it("#2: an exit is capped at the remaining position after a manual partial close", async () => {
      const symbol = uniqueSymbol("CAP");
      const userId = await createTestUser();
      const service = makeService({ prices: { [symbol]: 1000 } });
      await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 100, stopLossPrice: 950 },
      });
      await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 60 } });

      await primeVolume(symbol, 1000);
      const sl = await paperTradingTickProcessor.processTick(tick(symbol, 949, 100000));
      expect(sl.map((receipt) => [receipt.status, receipt.quantity])).toEqual([["PARTIALLY_FILLED", 40]]);
      expect(await positionsFor(userId)).toHaveLength(0);
    });

    it("#3: a bracket stop-loss exits at market when price gaps through the stop", async () => {
      const symbol = uniqueSymbol("GAP");
      const userId = await createTestUser();
      const parent = await makeService({ prices: { [symbol]: 1000 } }).placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 10, stopLossPrice: 950 },
      });

      await primeVolume(symbol, 1000);
      const receipts = await paperTradingTickProcessor.processTick(tick(symbol, 880, 10000));
      expect(receipts.map((receipt) => receipt.status)).toEqual(["FILLED"]);
      expect(Number(receipts[0]?.fillPrice)).toBeLessThan(900);
      expect(await positionsFor(userId)).toHaveLength(0);
      const [stop] = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
      expect(stop?.status).toBe("FILLED");
    });

    it("#4: a partially filled, then cancelled bracket entry keeps exits for the filled quantity", async () => {
      const symbol = uniqueSymbol("PBR");
      const userId = await createTestUser();
      const service = makeService({ prices: { [symbol]: 1000 } });
      const parent = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 100, stopLossPrice: 950, takeProfitPrice: 1050 },
      });

      await primeVolume(symbol, 1001);
      await paperTradingTickProcessor.processTick(tick(symbol, 999, 300));
      await service.cancelOrder({ userId, orderId: parent.order.id });

      const children = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, parent.order.id));
      expect(children.map((child) => [child.type, child.qty, child.status]).sort()).toEqual([
        ["LIMIT", 30, "PENDING"],
        ["STOP_LOSS_MARKET", 30, "TRIGGER_PENDING"],
      ]);
      const [position] = await positionsFor(userId);
      expect(position?.totalShares).toBe(30);
    });

    async function shortOnThinCash(prefix: string) {
      const symbol = uniqueSymbol(prefix);
      const userId = await createTestUser();
      const service = makeService({ prices: { [symbol]: 1000 } });
      await service.getState({ userId });
      await getDb().update(paperAccounts).set({ cashBalance: "30000.0000" }).where(eq(paperAccounts.userId, userId));
      await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 100 } });
      return { symbol, userId };
    }

    async function accountStatus(userId: string) {
      const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
      return account?.status;
    }

    it("R2#1 (P9/P18): stale or delayed ticks never mark a margin call", async () => {
      const { symbol, userId } = await shortOnThinCash("STL");
      const monitor = new PaperRiskMonitor();

      monitor.updateQuote(tick(symbol, 1300, 1000, { ts: new Date(Date.now() - 60_000).toISOString() }));
      await monitor.monitorRisk();
      expect(await accountStatus(userId)).toBe("ACTIVE");

      monitor.updateQuote(
        tick(symbol, 1300, 1000, { source: "yahoo", quality: "delayed", ts: new Date(Date.now() - 15 * 60_000).toISOString() })
      );
      await monitor.monitorRisk();
      expect(await accountStatus(userId)).toBe("ACTIVE");

      monitor.updateQuote(tick(symbol, 1000, 2000));
      await monitor.monitorRisk();
      expect(await accountStatus(userId)).toBe("ACTIVE");
      expect(await positionsFor(userId)).toHaveLength(1);

      monitor.updateQuote(tick(symbol, 1300, 3000));
      await monitor.monitorRisk();
      expect(await accountStatus(userId)).toBe("LIQUIDATED");
      expect(await positionsFor(userId)).toHaveLength(0);
    });

    it("R2#1: a pending liquidation is re-checked on live prices and released when no longer breached", async () => {
      const { symbol, userId } = await shortOnThinCash("REL");
      await getDb()
        .update(paperAccounts)
        .set({ status: "LIQUIDATION_PENDING", isLocked: true, lockReason: "MARGIN_CALL_LIQUIDATION", lockedAt: new Date() })
        .where(eq(paperAccounts.userId, userId));

      const monitor = new PaperRiskMonitor();
      monitor.updateQuote(tick(symbol, 1000, 1000));
      await monitor.monitorRisk();

      const [account] = await getDb().select().from(paperAccounts).where(eq(paperAccounts.userId, userId));
      expect(account?.status).toBe("ACTIVE");
      expect(account?.isLocked).toBe(false);
      expect(account?.lockReason).toBeNull();
      expect(await positionsFor(userId)).toHaveLength(1);
    });

    it("R2#2 (P13): a manual close or flip cancels the position's working bracket exits", async () => {
      const symbol = uniqueSymbol("STX");
      const userId = await createTestUser();
      const service = makeService({ prices: { [symbol]: 1000 } });
      const closed = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 10, stopLossPrice: 950, takeProfitPrice: 1050 },
      });
      await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 10 } });
      const afterClose = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, closed.order.id));
      expect(afterClose.map((exit) => exit.status)).toEqual(["CANCELLED", "CANCELLED"]);

      const flipped = await service.placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 10, stopLossPrice: 950 },
      });
      await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "SELL", type: "MARKET", qty: 25 } });
      const afterFlip = await getDb().select().from(paperOrders).where(eq(paperOrders.parentOrderId, flipped.order.id));
      expect(afterFlip.map((exit) => exit.status)).toEqual(["CANCELLED"]);

      // A later unbracketed position is never touched by the old exits.
      await service.placeOrder({ userId, command: { symbol, exchange: "NSE", side: "BUY", type: "MARKET", qty: 25 } });
      await primeVolume(symbol, 1000);
      expect(await paperTradingTickProcessor.processTick(tick(symbol, 940, 100000))).toEqual([]);
      const [position] = await positionsFor(userId);
      expect([position?.side, position?.totalShares]).toEqual(["LONG", 10]);
    });

    it("#6: fills are sized from the traded volume since the previous tick; nothing traded fills nothing", async () => {
      const symbol = uniqueSymbol("VOL");
      const userId = await createTestUser();
      await makeService({ prices: { [symbol]: 1000 } }).placeOrder({
        userId,
        command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 1000, qty: 500 },
      });

      // The first marketable tick has no baseline: its volume is not known to have traded now.
      expect(await paperTradingTickProcessor.processTick(tick(symbol, 999, 50_000))).toEqual([]);
      const quantities: number[] = [];
      for (const cumulative of [50_009, 50_109, 50_109, 50_309]) {
        const [receipt] = await paperTradingTickProcessor.processTick(tick(symbol, 999, cumulative));
        quantities.push(receipt?.quantity ?? 0);
      }
      // 9 traded -> the 1-share floor; 100 -> 10%; a repeated cumulative volume (0 traded) -> no fill.
      expect(quantities).toEqual([1, 10, 0, 20]);
    });

    it("#7: idempotent retries match prices at stored precision and keys are per generation", async () => {
      const symbol = uniqueSymbol("IDP");
      const userId = await createTestUser();
      const service = makeService({ prices: { [symbol]: 1000 } });
      const limit = { symbol, exchange: "NSE", side: "BUY" as const, type: "LIMIT" as const, limitPrice: 999.12345, qty: 2, idempotencyKey: `lim-${userId}` };
      const first = await service.placeOrder({ userId, command: limit });
      const retry = await service.placeOrder({ userId, command: { ...limit } });
      expect(retry.idempotentReplay).toBe(true);
      expect(retry.order.id).toBe(first.order.id);

      const market = { symbol, exchange: "NSE", side: "BUY" as const, type: "MARKET" as const, qty: 3, idempotencyKey: `mkt-${userId}` };
      const before = await service.placeOrder({ userId, command: market });
      await service.resetAccount({ userId, confirmation: true });
      const after = await service.placeOrder({ userId, command: market });
      expect(after.idempotentReplay).toBe(false);
      expect(after.order.id).not.toBe(before.order.id);
      expect(after.order.generation).toBe(2);
      expect(after.position?.totalShares).toBe(3);
    });
  });
});
