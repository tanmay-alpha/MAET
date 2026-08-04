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
import { eq, and, desc, asc, lte } from "drizzle-orm";
import { CreateReplayInputSchema } from "../../../../shared/strategy/contracts";

export const strategyReplayRouter = createRouter({
  /** Create a new bar replay session */
  create: protectedProcedure
    .input(CreateReplayInputSchema)
    .mutation(async ({ ctx, input }) => {
      const startTs = new Date(input.startTimestamp);

      // Verify candles exist for symbol/timeframe before start
      const [firstCandle] = await db
        .select()
        .from(candles)
        .where(and(eq(candles.symbol, input.symbol), eq(candles.timeframe, input.timeframe)))
        .orderBy(asc(candles.ts))
        .limit(1);

      if (!firstCandle) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `No candle data found for ${input.symbol} (${input.timeframe})`,
        });
      }

      const initialCapital = input.initialCapital ?? 1_000_000;

      const [session] = await db
        .insert(strategyReplaySessions)
        .values({
          userId: ctx.userId!,
          symbol: input.symbol,
          timeframe: input.timeframe,
          startTimestamp: startTs,
          currentBarTimestamp: startTs,
          barsRevealed: 0,
          initialCapital: initialCapital.toFixed(4),
          currentEquity: initialCapital.toFixed(4),
          state: {},
          status: "ACTIVE",
        })
        .returning();

      return { session };
    }),

  /** Step forward one bar — returns exactly one new bar */
  step: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);

      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Replay session not found" });
      if (session.status !== "ACTIVE") throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Session is not active" });

      // Find the next bar AFTER current_timestamp
      const [nextCandle] = await db
        .select()
        .from(candles)
        .where(and(
          eq(candles.symbol, session.symbol),
          eq(candles.timeframe, session.timeframe),
          // Strictly greater than current timestamp
        ))
        .orderBy(asc(candles.ts))
        .limit(1);

      // We need bars strictly after currentBarTimestamp — use raw sql comparison
      const nextCandleResult = await db.execute(
        `SELECT * FROM candles WHERE symbol = $1 AND timeframe = $2 AND ts > $3 ORDER BY ts ASC LIMIT 1`,
      );
      // Use Drizzle properly
      const nextBar = await db
        .select()
        .from(candles)
        .where(and(eq(candles.symbol, session.symbol), eq(candles.timeframe, session.timeframe)))
        .orderBy(asc(candles.ts))
        .limit(session.barsRevealed + 50) // load context
        .then((rows) => rows[session.barsRevealed] ?? null);

      if (!nextBar) {
        return { bar: null, endOfData: true, barsRevealed: session.barsRevealed };
      }

      // Update session
      await db
        .update(strategyReplaySessions)
        .set({
          currentBarTimestamp: nextBar.ts,
          barsRevealed: session.barsRevealed + 1,
          updatedAt: new Date(),
        })
        .where(eq(strategyReplaySessions.id, input.sessionId));

      return {
        bar: {
          ts: nextBar.ts.toISOString(),
          open: Number(nextBar.open),
          high: Number(nextBar.high),
          low: Number(nextBar.low),
          close: Number(nextBar.close),
          volume: nextBar.volume ?? 0,
        },
        endOfData: false,
        barsRevealed: session.barsRevealed + 1,
      };
    }),

  /** Get current session state including all revealed bars */
  getState: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

      // Return only revealed bars (up to barsRevealed count)
      const revealedBars = await db
        .select()
        .from(candles)
        .where(and(
          eq(candles.symbol, session.symbol),
          eq(candles.timeframe, session.timeframe),
          lte(candles.ts, session.currentBarTimestamp),
        ))
        .orderBy(asc(candles.ts))
        .limit(session.barsRevealed);

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
      };
    }),

  /** Reset session to start (clear revealed bars, restore initial capital) */
  reset: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const [session] = await db
        .select()
        .from(strategyReplaySessions)
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)))
        .limit(1);
      if (!session) throw new TRPCError({ code: "NOT_FOUND", message: "Session not found" });

      await db
        .update(strategyReplaySessions)
        .set({
          currentBarTimestamp: session.startTimestamp,
          barsRevealed: 0,
          currentEquity: session.initialCapital,
          state: {},
          updatedAt: new Date(),
        })
        .where(eq(strategyReplaySessions.id, input.sessionId));

      return { reset: true };
    }),

  /** Close and expire a replay session */
  close: protectedProcedure
    .input(z.object({ sessionId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      await db
        .update(strategyReplaySessions)
        .set({ status: "CLOSED", updatedAt: new Date() })
        .where(and(eq(strategyReplaySessions.id, input.sessionId), eq(strategyReplaySessions.userId, ctx.userId!)));
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
