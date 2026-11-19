/**
 * Strategy Replay tRPC Router.
 * Server-side bar replay: reveals bars one at a time.
 * Isolated replay account — never touches paper trading account.
 * Strictly no future candle disclosure.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import { db } from "../../../data/drizzle/client";
import { strategyReplaySessions, candles } from "../../../db/schema";
import { eq, and, desc, asc, lte, gte, gt, sql, count } from "drizzle-orm";
import { CreateReplayInputSchema } from "../../../../shared/strategy/contracts";

/** Largest quantity a single replay order may carry. */
export const MAX_REPLAY_ORDER_QTY = 1_000_000;
/** Pending orders a single replay session may hold at once. */
export const MAX_REPLAY_OPEN_ORDERS = 50;
/**
 * Orders of any status a session may store. Each order fills at most once and
 * each fill adds one ledger entry, so this also bounds fills (<= orders) and
 * the ledger (<= fills + 1). `reset` clears all three.
 */
export const MAX_REPLAY_STORED_ORDERS = 1_000;
/** ACTIVE replay sessions a user may hold at once; `close` frees a slot. */
export const MAX_ACTIVE_REPLAY_SESSIONS = 10;

type ReplayTx = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ReplaySessionRow = typeof strategyReplaySessions.$inferSelect;

/** Postgres `lock_not_available`, raised when `lock_timeout` expires; drizzle wraps it in `cause`. */
function isLockTimeout(error: unknown): boolean {
  for (let current = error, depth = 0; current && typeof current === "object" && depth < 5; depth++) {
    if ("code" in current && current.code === "55P03") return true;
    current = "cause" in current ? current.cause : undefined;
  }
  return false;
}

/**
 * Runs a read-modify-write of a replay session's JSONB state under a row lock.
 * step, placeOrder, cancelOrder and reset each rewrite the whole `state`
 * document, so without the lock a concurrent step + placeOrder would let the
 * later writer drop the other's orders/fills. The timeouts stop a stuck holder
 * from parking callers (and connections from the small pool) indefinitely.
 */
async function withLockedSession<T>(
  sessionId: string,
  userId: string,
  fn: (tx: ReplayTx, session: ReplaySessionRow) => Promise<T>,
): Promise<T> {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`SET LOCAL lock_timeout = '2s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '5s'`);
      const [session] = await tx
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, sessionId), eq(strategyReplaySessions.userId, userId)))
        .limit(1)
        .for("update");
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Replay session not found" });
      return fn(tx, session);
    });
  } catch (error) {
    if (isLockTimeout(error)) {
      throw new TRPCError({ code: "CONFLICT", message: "Replay session is busy, retry", cause: error });
    }
    throw error;
  }
}

export const strategyReplayRouter = createRouter({
  /** Create a new bar replay session */
  create: protectedProcedure
    .input(CreateReplayInputSchema)
    .mutation(async ({ ctx, input }) => {
      const startTs = new Date(input.startTimestamp);

      // Verify candles exist at or after startTimestamp
      const [firstCandle] = await db
        .select()
        .from(candles)
        .where(and(
          eq(candles.symbol, input.symbol),
          eq(candles.timeframe, input.timeframe),
          gte(candles.ts, startTs),
        ))
        .orderBy(asc(candles.ts))
        .limit(1);

      if (!firstCandle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No candle data found for ${input.symbol} (${input.timeframe}) at or after ${input.startTimestamp}`,
        });
      }

      const initialCapital = input.initialCapital ?? 1_000_000;
      const initialState = {
        orders: [],
        fills: [],
        positions: [],
        ledger: [
          {
            id: crypto.randomUUID(),
            type: "INITIAL_FUNDING",
            amount: initialCapital,
            balanceAfter: initialCapital,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      return db.transaction(async (tx) => {
        // Serialise this user's creates so concurrent calls cannot all pass the count.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`replay-sessions:${ctx.userId!}`}))`);
        const [{ active }] = await tx
          .select({ active: count() })
          .from(strategyReplaySessions)
          .where(and(eq(strategyReplaySessions.userId, ctx.userId!), eq(strategyReplaySessions.status, "ACTIVE")));
        if (active >= MAX_ACTIVE_REPLAY_SESSIONS) {
          throw new TRPCError({
            code: "PRECONDITION_FAILED",
            message: `You can have at most ${MAX_ACTIVE_REPLAY_SESSIONS} active replay sessions; close one first`,
          });
        }

        const [session] = await tx
          .insert(strategyReplaySessions)
          .values({
            userId: ctx.userId!,
            symbol: input.symbol,
            timeframe: input.timeframe,
            startTimestamp: firstCandle.ts,
            currentBarTimestamp: firstCandle.ts,
            barsRevealed: 1,
            initialCapital: initialCapital.toFixed(4),
            currentEquity: initialCapital.toFixed(4),
            state: initialState as any,
            status: "ACTIVE",
          })
          .returning();

        return { session };
      });
    }),

  /** Step forward one bar — reveals exactly one next candle and processes pending replay orders */
  step: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => withLockedSession(input.sessionId, ctx.userId!, async (tx, session) => {
      if (session.status !== "ACTIVE") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session is not active" });

      // Find the next candle strictly after currentBarTimestamp
      const [nextBar] = await tx
        .select()
        .from(candles)
        .where(and(
          eq(candles.symbol, session.symbol),
          eq(candles.timeframe, session.timeframe),
          gt(candles.ts, session.currentBarTimestamp),
        ))
        .orderBy(asc(candles.ts))
        .limit(1);

      if (!nextBar) {
        return { bar: null, endOfData: true, barsRevealed: session.barsRevealed };
      }

      const barObj = {
        ts: nextBar.ts.toISOString(),
        open: Number(nextBar.open),
        high: Number(nextBar.high),
        low: Number(nextBar.low),
        close: Number(nextBar.close),
        volume: nextBar.volume ?? 0,
      };

      // Process pending replay limit/stop orders on new bar open
      const state = (session.state as any) ?? { orders: [], fills: [], positions: [], ledger: [] };
      const orders = state.orders ?? [];
      const fills = state.fills ?? [];
      const positions = state.positions ?? [];
      const ledger = state.ledger ?? [];
      let currentEquity = Number(session.currentEquity);

      for (const order of orders) {
        if (order.status !== "PENDING") continue;

        let shouldFill = false;
        let fillPrice = barObj.open;

        if (order.type === "MARKET") {
          shouldFill = true;
        } else if (order.type === "LIMIT") {
          if (order.side === "BUY" && barObj.low <= order.limitPrice) {
            shouldFill = true;
            fillPrice = Math.min(order.limitPrice, barObj.open);
          } else if (order.side === "SELL" && barObj.high >= order.limitPrice) {
            shouldFill = true;
            fillPrice = Math.max(order.limitPrice, barObj.open);
          }
        }

        if (shouldFill) {
          order.status = "FILLED";
          order.filledAt = barObj.ts;
          order.fillPrice = fillPrice;

          const fillId = crypto.randomUUID();
          fills.push({
            id: fillId,
            orderId: order.id,
            symbol: session.symbol,
            side: order.side,
            qty: order.qty,
            price: fillPrice,
            filledAt: barObj.ts,
          });

          // Update position
          let pos = positions.find((p: any) => p.symbol === session.symbol);
          if (!pos) {
            pos = { symbol: session.symbol, qty: 0, averagePrice: 0 };
            positions.push(pos);
          }

          if (order.side === "BUY") {
            const totalVal = pos.qty * pos.averagePrice + order.qty * fillPrice;
            pos.qty += order.qty;
            pos.averagePrice = pos.qty > 0 ? totalVal / pos.qty : 0;
            currentEquity -= order.qty * fillPrice;
          } else {
            pos.qty -= order.qty;
            currentEquity += order.qty * fillPrice;
          }

          ledger.push({
            id: crypto.randomUUID(),
            type: "FILL",
            amount: order.side === "BUY" ? -order.qty * fillPrice : order.qty * fillPrice,
            balanceAfter: currentEquity,
            createdAt: barObj.ts,
          });
        }
      }

      // Update session in DB
      await tx
        .update(strategyReplaySessions)
        .set({
          currentBarTimestamp: nextBar.ts,
          barsRevealed: session.barsRevealed + 1,
          currentEquity: currentEquity.toFixed(4),
          state: { orders, fills, positions, ledger },
          updatedAt: new Date(),
        })
        .where(eq(strategyReplaySessions.id, input.sessionId));

      return {
        bar: barObj,
        endOfData: false,
        barsRevealed: session.barsRevealed + 1,
      };
    })),

  /** Get current session state including revealed bars */
  getState: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

      const revealedBars = await db
        .select()
        .from(candles)
        .where(and(
          eq(candles.symbol, session.symbol),
          eq(candles.timeframe, session.timeframe),
          gte(candles.ts, session.startTimestamp),
          lte(candles.ts, session.currentBarTimestamp),
        ))
        .orderBy(asc(candles.ts));

      return {
        session,
        bars: revealedBars.map((c) => ({
          ts: c.ts.toISOString(),
          open: Number(c.open),
          high: Number(c.high),
          low: Number(c.low),
          close: Number(c.close),
          volume: c.volume ?? 0,
        })),
        state: session.state,
      };
    }),

  /** Place a replay order (isolated to replay session state) */
  placeOrder: protectedProcedure
    .input(z.object({
      sessionId: z.string().uuid(),
      side: z.enum(["BUY", "SELL"]),
      type: z.enum(["MARKET", "LIMIT"]),
      qty: z.number().int().positive().max(MAX_REPLAY_ORDER_QTY),
      limitPrice: z.number().positive().optional(),
    }).strict())
    .mutation(async ({ ctx, input }) => withLockedSession(input.sessionId, ctx.userId!, async (tx, session) => {
      if (session.status !== "ACTIVE") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session is not active" });

      const state = (session.state as any) ?? { orders: [], fills: [], positions: [], ledger: [] };
      const orders = state.orders ?? [];
      const openOrders = orders.filter((o: { status?: string }) => o.status === "PENDING").length;
      if (openOrders >= MAX_REPLAY_OPEN_ORDERS) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `A replay session can hold at most ${MAX_REPLAY_OPEN_ORDERS} open orders`,
        });
      }
      if (orders.length >= MAX_REPLAY_STORED_ORDERS) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: `A replay session can store at most ${MAX_REPLAY_STORED_ORDERS} orders; reset the session to continue`,
        });
      }
      const newOrder = {
        id: crypto.randomUUID(),
        symbol: session.symbol,
        side: input.side,
        type: input.type,
        qty: input.qty,
        limitPrice: input.limitPrice,
        status: "PENDING",
        createdAt: session.currentBarTimestamp.toISOString(),
      };

      orders.push(newOrder);

      await tx
        .update(strategyReplaySessions)
        .set({
          state: { ...state, orders },
          updatedAt: new Date(),
        })
        .where(eq(strategyReplaySessions.id, input.sessionId));

      return { order: newOrder };
    })),

  /** Cancel a pending replay order */
  cancelOrder: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid(), orderId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => withLockedSession(input.sessionId, ctx.userId!, async (tx, session) => {
      if (session.status !== "ACTIVE") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session is not active" });
      const state = (session.state as any) ?? { orders: [], fills: [], positions: [], ledger: [] };
      const orders = state.orders ?? [];
      const order = orders.find((o: any) => o.id === input.orderId);
      if (!order) throw new TRPCError({ code: "NOT_FOUND", message: "Replay order not found" });
      if (order.status !== "PENDING") {
        throw new TRPCError({ code: "PRECONDITION_FAILED", message: `Only pending orders can be cancelled; this order is ${order.status}` });
      }

      order.status = "CANCELLED";

      await tx
        .update(strategyReplaySessions)
        .set({
          state: { ...state, orders },
          updatedAt: new Date(),
        })
        .where(eq(strategyReplaySessions.id, input.sessionId));

      return { cancelled: true };
    })),

  /** List replay orders */
  listOrders: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      const state = (session.state as any) ?? {};
      return { orders: state.orders ?? [] };
    }),

  /** List replay fills */
  listFills: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      const state = (session.state as any) ?? {};
      return { fills: state.fills ?? [] };
    }),

  /** Get replay positions */
  getPositions: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      const state = (session.state as any) ?? {};
      return { positions: state.positions ?? [] };
    }),

  /** Get replay ledger entries */
  getLedger: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });
      const state = (session.state as any) ?? {};
      return { ledger: state.ledger ?? [] };
    }),

  /** Reset session to start (clear revealed bars, restore initial capital) */
  reset: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => withLockedSession(input.sessionId, ctx.userId!, async (tx, session) => {
      const initialCap = Number(session.initialCapital);
      const resetState = {
        orders: [],
        fills: [],
        positions: [],
        ledger: [
          {
            id: crypto.randomUUID(),
            type: "RESET_FUNDING",
            amount: initialCap,
            balanceAfter: initialCap,
            createdAt: new Date().toISOString(),
          },
        ],
      };

      await tx
        .update(strategyReplaySessions)
        .set({
          currentBarTimestamp: session.startTimestamp,
          barsRevealed: 1,
          currentEquity: session.initialCapital,
          state: resetState as any,
          updatedAt: new Date(),
        })
        .where(eq(strategyReplaySessions.id, input.sessionId));

      return { reset: true };
    })),

  /** Close and expire a replay session */
  close: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const closed = await db
        .update(strategyReplaySessions)
        .set({ status: "CLOSED", updatedAt: new Date() })
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .returning({ id: strategyReplaySessions.id });
      if (closed.length === 0) throw new TRPCError({ code: "NOT_FOUND", message: "Replay session not found" });
      return { closed: true };
    }),

  /** List active replay sessions */
  list: protectedProcedure
    .query(async ({ ctx }) => {
      const sessions = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.userId, ctx.userId!), eq(strategyReplaySessions.status, "ACTIVE")))
        .orderBy(desc(strategyReplaySessions.updatedAt))
        .limit(10);
      return { sessions };
    }),
});
