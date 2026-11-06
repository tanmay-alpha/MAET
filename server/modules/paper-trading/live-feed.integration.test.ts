import { afterEach, beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import type { Tick } from "@shared/types";
import { parsePaperStreamMessage, paperUserChannel } from "@shared/domain/paper-trading/stream-events";
import { getDb, getSqlClient } from "../../data/drizzle/client";
import { paperOrders } from "../../db/schema";
import { bus, type PaperInterestChanged } from "../../infra/bus";
import { applyMigrations } from "../../scripts/apply-migrations";
import {
  getPaperInterestSymbols,
  getSubscriptionRefCount,
  reconcilePaperInterestSubscriptions,
  resetSubscriptionRefsForTesting,
} from "../../orchestrator";
import { OrderMatcherWorker } from "../../workers/order-matcher";
import { processOutboxBatch, type OutboxPublisher } from "../../workers/paper-outbox-publisher";
import { listPaperInterest } from "./interest-subscriptions";
import { createPaperTradingService } from "./service";

function tick(symbol: string, price: number): Tick {
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

async function createTestUser(): Promise<string> {
  const userId = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${userId}) ON CONFLICT DO NOTHING`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`test-user-${userId}@example.com`}) ON CONFLICT DO NOTHING`;
  return userId;
}

function serviceQuoting(price: number) {
  return createPaperTradingService({
    database: getDb(),
    marketPhase: () => "OPEN",
    quoteLoader: async (exchange, symbol) => ({ ...tick(symbol, price), exchange }),
  });
}

async function outboxRowsFor(userId: string) {
  return getSqlClient()<Array<{
    id: string;
    event_type: string;
    status: string;
    attempt_count: number;
    last_error: string | null;
    backoff_pending: boolean;
    published: boolean;
  }>>`
    SELECT id, event_type, status, attempt_count, last_error,
           COALESCE(next_attempt_at > NOW(), false) AS backoff_pending,
           published_at IS NOT NULL AS published
    FROM public.paper_outbox_events
    WHERE user_id = ${userId}
    ORDER BY created_at
  `;
}

/** Publishes every due PENDING event (other test files leave theirs behind too). */
async function drainOutbox(publisher: OutboxPublisher): Promise<void> {
  while ((await processOutboxBatch({ publisher: () => publisher })).claimed > 0) {
    // keep claiming batches until nothing is due
  }
}

function nextInterestChange(reason: PaperInterestChanged["reason"]): Promise<void> {
  const { promise, resolve } = Promise.withResolvers<void>();
  const off = bus.on("paper:interest_changed", (event) => {
    if (event.reason !== reason) return;
    off();
    resolve();
  });
  return promise;
}

describe("paper live feed", () => {
  beforeAll(async () => {
    if (!process.env.TEST_DATABASE_URL) {
      throw new Error("TEST_DATABASE_URL is required for paper live-feed integration tests.");
    }
    await applyMigrations();
  });

  afterEach(() => {
    resetSubscriptionRefsForTesting();
  });

  it("subscribes a resting LIMIT order's symbol without viewers, fills it from a bus tick and publishes its events", async () => {
    const userId = await createTestUser();
    const symbol = `LIVE${crypto.randomUUID().slice(0, 8).toUpperCase()}`;

    const placedSignal = nextInterestChange("order_placed");
    const placed = await serviceQuoting(105).placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 100, qty: 1 },
    });
    expect(placed.order.status).toBe("PENDING");
    await placedSignal;

    // Nobody watches the symbol: only the working order can put it on the live feed.
    expect(getSubscriptionRefCount(symbol)).toBe(0);
    await reconcilePaperInterestSubscriptions();
    expect(getSubscriptionRefCount(symbol)).toBe(1);
    expect(getPaperInterestSymbols()).toContain(symbol);

    const matcher = new OrderMatcherWorker();
    matcher.start();
    try {
      const filledSignal = nextInterestChange("order_filled");
      bus.emit("tick", tick(symbol, 99));
      await filledSignal;
    } finally {
      matcher.stop();
    }
    const [order] = await getDb().select().from(paperOrders).where(eq(paperOrders.id, placed.order.id));
    expect(order!.status).toBe("FILLED");

    // The open position keeps the symbol on the feed for margin monitoring.
    await reconcilePaperInterestSubscriptions();
    expect(getSubscriptionRefCount(symbol)).toBe(1);

    // Redis not ready: nothing is claimed, every event stays PENDING for a later retry.
    expect(await processOutboxBatch({ publisher: () => undefined })).toEqual({ claimed: 0, published: 0 });
    const pending = await outboxRowsFor(userId);
    expect(pending.map((row) => row.event_type)).toEqual(
      expect.arrayContaining(["PAPER_ORDER_ACCEPTED", "PAPER_ORDER_FILLED"])
    );
    expect(pending.every((row) => row.status === "PENDING" && row.attempt_count === 0)).toBe(true);

    const sql = getSqlClient();
    const published: Array<{ channel: string; eventType: string; id: string }> = [];
    const observations: Array<{ lockedByPublisher: boolean; statusWhilePublishing: string }> = [];
    await drainOutbox({
      async publish(channel, message) {
        const parsed = parsePaperStreamMessage(message);
        if (!parsed || parsed.userId !== userId) return 1;
        // Another worker must not be able to claim the row while it is being published,
        // and the PUBLISHED mark must not be visible before the claiming transaction commits.
        const claimable = await sql`
          SELECT id FROM public.paper_outbox_events WHERE id = ${parsed.id} FOR UPDATE SKIP LOCKED
        `;
        const [row] = await sql<Array<{ status: string }>>`
          SELECT status FROM public.paper_outbox_events WHERE id = ${parsed.id}
        `;
        observations.push({ lockedByPublisher: claimable.length === 0, statusWhilePublishing: row!.status });
        published.push({ channel, eventType: parsed.eventType, id: parsed.id });
        return 1;
      },
    });

    const after = await outboxRowsFor(userId);
    expect(after.every((row) => row.status === "PUBLISHED" && row.published)).toBe(true);
    expect(published.map((event) => event.id).sort()).toEqual(after.map((row) => row.id).sort());
    expect(published.every((event) => event.channel === paperUserChannel(userId))).toBe(true);
    expect(published.map((event) => event.eventType)).toContain("PAPER_ORDER_FILLED");
    expect(observations.every((seen) => seen.lockedByPublisher && seen.statusWhilePublishing === "PENDING")).toBe(true);
  });

  it("leaves an event PENDING with a backoff when publishing fails, and publishes it on a later attempt", async () => {
    const userId = await createTestUser();
    const symbol = `LIVF${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    await serviceQuoting(105).placeOrder({
      userId,
      command: { symbol, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 100, qty: 1 },
    });

    await drainOutbox({
      async publish(_channel, message) {
        if (parsePaperStreamMessage(message)?.userId === userId) throw new Error("redis connection lost");
        return 1;
      },
    });

    // Each of the user's events failed once and backs off; none was marked published.
    const failed = await outboxRowsFor(userId);
    expect(failed.length).toBeGreaterThan(0);
    for (const row of failed) {
      expect(row).toMatchObject({ status: "PENDING", last_error: "redis connection lost", backoff_pending: true });
      expect(row.attempt_count).toBeGreaterThanOrEqual(1);
    }

    // Once the backoff has elapsed the events are delivered (at least once).
    await getSqlClient()`UPDATE public.paper_outbox_events SET next_attempt_at = NOW() WHERE user_id = ${userId}`;
    await drainOutbox({ publish: async () => 1 });
    const delivered = await outboxRowsFor(userId);
    expect(delivered.map((row) => row.status)).toEqual(failed.map(() => "PUBLISHED"));
  });

  it("lists working orders and open positions of current generations only, orders first", async () => {
    const userId = await createTestUser();
    const held = `LIVH${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const resting = `LIVR${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const cancelled = `LIVC${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
    const service = serviceQuoting(105);
    await service.placeOrder({ userId, command: { symbol: held, exchange: "NSE", side: "BUY", type: "MARKET", qty: 1 } });
    await service.placeOrder({
      userId,
      command: { symbol: resting, exchange: "BSE", side: "BUY", type: "LIMIT", limitPrice: 100, qty: 1 },
    });
    const toCancel = await service.placeOrder({
      userId,
      command: { symbol: cancelled, exchange: "NSE", side: "BUY", type: "LIMIT", limitPrice: 100, qty: 1 },
    });
    const cancelSignal = nextInterestChange("order_cancelled");
    await service.cancelOrder({ userId, orderId: toCancel.order.id });
    await cancelSignal;

    const ours = (await listPaperInterest()).filter((row) => [held, resting, cancelled].includes(row.symbol));
    expect(ours).toEqual([
      { exchange: "BSE", symbol: resting, kind: "ORDER" },
      { exchange: "NSE", symbol: held, kind: "POSITION" },
    ]);

    // After a reset the previous generation's position no longer needs ticks.
    const resetSignal = nextInterestChange("account_reset");
    await service.resetAccount({ userId, confirmation: true });
    await resetSignal;
    const afterReset = (await listPaperInterest()).filter((row) => [held, resting].includes(row.symbol));
    expect(afterReset).toEqual([]);
  });
});
