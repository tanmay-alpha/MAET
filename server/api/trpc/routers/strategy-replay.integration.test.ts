import { beforeAll, describe, expect, it } from "bun:test";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { getDb, getSqlClient } from "../../../data/drizzle/client";
import { strategyReplaySessions } from "../../../db/schema";
import { MAX_REPLAY_OPEN_ORDERS, MAX_REPLAY_ORDER_QTY, strategyReplayRouter } from "./strategy-replay";

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
  return { caller, sessionId: session.id };
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
});
