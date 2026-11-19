import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, getSqlClient } from "../../../data/drizzle/client";
import { strategyReplaySessions } from "../../../db/schema";
import {
  MAX_ACTIVE_REPLAY_SESSIONS,
  MAX_REPLAY_OPEN_ORDERS,
  MAX_REPLAY_ORDER_QTY,
  MAX_REPLAY_STORED_ORDERS,
  strategyReplayRouter,
} from "./strategy-replay";

async function setup(bars = 5) {
  const userId = crypto.randomUUID();
  const sql = getSqlClient();
  await sql`INSERT INTO auth.users (id) VALUES (${userId})`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`replay-${userId}@example.com`})`;
  const symbol = `RP${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
  const start = Date.UTC(2026, 0, 1);
  for (let i = 0; i < bars; i++) {
    const ts = new Date(start + i * 86_400_000).toISOString();
    await sql`
      INSERT INTO public.candles (symbol, timeframe, ts, open, high, low, close, volume)
      VALUES (${symbol}, '1d', ${ts}, ${100 + i}, ${110 + i}, ${90 + i}, ${105 + i}, 1000)
    `;
  }
  const caller = strategyReplayRouter.createCaller({ userId, email: null, role: "user" });
  const { session } = await caller.create({ symbol, timeframe: "1d", startTimestamp: new Date(start).toISOString() });
  return { caller, sessionId: session.id, userId, symbol, startTimestamp: new Date(start).toISOString() };
}

async function loadSession(id: string) {
  const [row] = await getDb().select().from(strategyReplaySessions).where(eq(strategyReplaySessions.id, id));
  return row!;
}

const PersistedOrders = z.object({ orders: z.array(z.object({ id: z.string() })) });
function orderIds(row: { state: unknown }): string[] {
  return PersistedOrders.parse(row.state).orders.map((o) => o.id);
}

describe("strategy replay router (Postgres)", () => {
  beforeAll(() => {
    if (!process.env.TEST_DATABASE_URL) throw new Error("TEST_DATABASE_URL is required for strategy replay integration tests");
  });

  it("keeps both effects when step and placeOrder race on the same session", async () => {
    for (let round = 0; round < 5; round++) {
      const { caller, sessionId } = await setup();
      const [stepped, placed] = await Promise.all([
        caller.step({ sessionId }),
        caller.placeOrder({ sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 }),
      ]);
      const row = await loadSession(sessionId);
      expect(row.barsRevealed).toBe(stepped.barsRevealed);
      expect(row.barsRevealed).toBe(2);
      expect(orderIds(row)).toEqual([placed.order.id]);
    }
  }, 60_000);

  it("keeps every order when placeOrder calls race", async () => {
    const { caller, sessionId } = await setup();
    const placed = await Promise.all(
      Array.from({ length: 8 }, () => caller.placeOrder({ sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 })),
    );
    const row = await loadSession(sessionId);
    expect(orderIds(row).sort()).toEqual(placed.map((p) => p.order.id).sort());
  }, 30_000);

  it("rejects quantities above the maximum", async () => {
    const { caller, sessionId } = await setup();
    await expect(
      caller.placeOrder({ sessionId, side: "BUY", type: "MARKET", qty: MAX_REPLAY_ORDER_QTY + 1 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("caps open orders per session", async () => {
    const { caller, sessionId } = await setup();
    for (let i = 0; i < MAX_REPLAY_OPEN_ORDERS; i++) {
      await caller.placeOrder({ sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 });
    }
    await expect(
      caller.placeOrder({ sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    const row = await loadSession(sessionId);
    expect(orderIds(row)).toHaveLength(MAX_REPLAY_OPEN_ORDERS);
  }, 30_000);

  it("rejects orders on closed sessions", async () => {
    const { caller, sessionId } = await setup();
    await caller.close({ sessionId });
    await expect(
      caller.placeOrder({ sessionId, side: "BUY", type: "MARKET", qty: 1 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await loadSession(sessionId)).state).toMatchObject({ orders: [] });
  });

  it("treats another user's session as NOT_FOUND and leaves it untouched", async () => {
    const owner = await setup();
    const { order } = await owner.caller.placeOrder({ sessionId: owner.sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 });
    await owner.caller.step({ sessionId: owner.sessionId });
    const before = await loadSession(owner.sessionId);

    const { caller: other } = await setup();
    const sessionId = owner.sessionId;
    const attempts: [string, () => Promise<unknown>][] = [
      ["getState", () => other.getState({ sessionId })],
      ["listOrders", () => other.listOrders({ sessionId })],
      ["listFills", () => other.listFills({ sessionId })],
      ["getPositions", () => other.getPositions({ sessionId })],
      ["getLedger", () => other.getLedger({ sessionId })],
      ["step", () => other.step({ sessionId })],
      ["placeOrder", () => other.placeOrder({ sessionId, side: "BUY", type: "MARKET", qty: 1 })],
      ["cancelOrder", () => other.cancelOrder({ sessionId, orderId: order.id })],
      ["reset", () => other.reset({ sessionId })],
      ["close", () => other.close({ sessionId })],
    ];
    for (const [name, attempt] of attempts) {
      const outcome = await attempt().then(
        (value) => ({ resolved: value }),
        (error: unknown) => ({ code: error instanceof Error && "code" in error ? error.code : String(error) }),
      );
      expect({ name, outcome }).toEqual({ name, outcome: { code: "NOT_FOUND" } });
    }
    expect((await other.list()).sessions.map((s) => s.id)).not.toContain(sessionId);

    expect(await loadSession(owner.sessionId)).toEqual(before);
    expect(before.status).toBe("ACTIVE");
    expect(before.barsRevealed).toBe(2);
    expect(orderIds(before)).toEqual([order.id]);
  }, 30_000);

  it("caps stored orders per session, including filled and cancelled ones", async () => {
    const { caller, sessionId } = await setup();
    const seeded = Array.from({ length: MAX_REPLAY_STORED_ORDERS }, () => ({ id: crypto.randomUUID(), status: "CANCELLED" }));
    const row = await loadSession(sessionId);
    await getDb()
      .update(strategyReplaySessions)
      .set({ state: { ...PersistedOrders.passthrough().parse(row.state), orders: seeded } })
      .where(eq(strategyReplaySessions.id, sessionId));
    await expect(
      caller.placeOrder({ sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 }),
    ).rejects.toMatchObject({ code: "PRECONDITION_FAILED", message: expect.stringContaining(`${MAX_REPLAY_STORED_ORDERS} orders`) });
    expect(orderIds(await loadSession(sessionId))).toHaveLength(MAX_REPLAY_STORED_ORDERS);
  }, 30_000);

  it("caps ACTIVE sessions per user, even when creates race", async () => {
    const { caller, sessionId, userId, symbol, startTimestamp } = await setup();
    const results = await Promise.allSettled(
      Array.from({ length: MAX_ACTIVE_REPLAY_SESSIONS + 2 }, () => caller.create({ symbol, timeframe: "1d", startTimestamp })),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(MAX_ACTIVE_REPLAY_SESSIONS - 1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "PRECONDITION_FAILED" });
    }
    const active = await getSqlClient()`
      SELECT count(*)::int AS n FROM public.strategy_replay_sessions WHERE user_id = ${userId} AND status = 'ACTIVE'
    `;
    expect(active[0]!.n).toBe(MAX_ACTIVE_REPLAY_SESSIONS);

    // Closing a session frees a slot.
    await caller.close({ sessionId });
    await caller.create({ symbol, timeframe: "1d", startTimestamp });
  }, 30_000);

  it("only cancels pending orders on active sessions", async () => {
    const { caller, sessionId } = await setup();
    const { order: filled } = await caller.placeOrder({ sessionId, side: "BUY", type: "MARKET", qty: 1 });
    await caller.step({ sessionId });
    await expect(caller.cancelOrder({ sessionId, orderId: filled.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await caller.listOrders({ sessionId })).orders).toMatchObject([{ id: filled.id, status: "FILLED" }]);

    const { order: pending } = await caller.placeOrder({ sessionId, side: "BUY", type: "LIMIT", qty: 1, limitPrice: 1 });
    await caller.close({ sessionId });
    await expect(caller.cancelOrder({ sessionId, orderId: pending.id })).rejects.toMatchObject({ code: "PRECONDITION_FAILED" });
    expect((await caller.listOrders({ sessionId })).orders).toMatchObject([{ status: "FILLED" }, { id: pending.id, status: "PENDING" }]);
  }, 30_000);

  it("returns CONFLICT within the lock timeout when another transaction holds the session", async () => {
    const { caller, sessionId } = await setup();
    const acquired = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    // A real Postgres lock wait is under test, so the holder needs a real-time
    // bound: without lock_timeout, step would otherwise wait for the holder forever.
    const safetyRelease = setTimeout(release.resolve, 4_000);
    const holder = getSqlClient().begin(async (tx) => {
      await tx`SELECT id FROM public.strategy_replay_sessions WHERE id = ${sessionId} FOR UPDATE`;
      acquired.resolve();
      await release.promise;
    });
    try {
      await acquired.promise;
      const startedAt = performance.now();
      const outcome = await caller.step({ sessionId }).then(
        () => ({ code: "OK" }),
        (error: unknown) => ({ code: error instanceof Error && "code" in error ? error.code : String(error) }),
      );
      const elapsed = performance.now() - startedAt;
      expect(outcome).toEqual({ code: "CONFLICT" });
      expect(elapsed).toBeLessThan(3_500);
    } finally {
      clearTimeout(safetyRelease);
      release.resolve();
      await holder;
    }
    expect((await loadSession(sessionId)).barsRevealed).toBe(1);
  }, 30_000);
});
