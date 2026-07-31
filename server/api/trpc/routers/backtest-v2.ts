import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { backtestRuns, backtestPresets, candles } from "../../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { runBacktest, InsufficientHistoryError } from "../../../domain/backtest/runner";
import { StrategyTypeSchema } from "../../../modules/backtest/contracts";
import type { Candle } from "@shared/types";

const StrictRiskSchema = z.object({
  initialCapital: z.number().positive().default(100000),
  feeBps: z.number().min(0).default(10),
  slippageBps: z.number().min(0).default(5),
  positionSizePercent: z.number().min(1).max(100).default(100),
  maximumOpenPositions: z.number().int().min(1).max(100).default(1),
  stopLossPercent: z.number().positive().optional(),
  takeProfitPercent: z.number().positive().optional(),
  trailingStopPercent: z.number().positive().optional(),
});

const StrictStrategySchema = z.object({
  type: StrategyTypeSchema,
  fastPeriod: z.number().int().positive().optional(),
  slowPeriod: z.number().int().positive().optional(),
  signalPeriod: z.number().int().positive().optional(),
  rsiPeriod: z.number().int().positive().optional(),
  rsiOversold: z.number().min(0).max(100).optional(),
  rsiOverbought: z.number().min(0).max(100).optional(),
  donchianPeriod: z.number().int().positive().optional(),
  bollingerPeriod: z.number().int().positive().optional(),
  bollingerStdDev: z.number().positive().optional(),
  combinedRules: z.array(z.object({
    indicator: z.string(),
    op: z.string(),
    value: z.number(),
  })).optional(),
});

export const backtestV2Router = createRouter({
  run: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1),
      timeframe: z.string().default("1d"),
      from: z.string().optional(),
      to: z.string().optional(),
      strategy: StrictStrategySchema,
      risk: StrictRiskSchema.default({
        initialCapital: 100000,
        feeBps: 10,
        slippageBps: 5,
        positionSizePercent: 100,
        maximumOpenPositions: 1,
      }),
    }).strict())
    .mutation(async ({ ctx, input }) => {
      const symbol = input.symbol.toUpperCase();

      // Fetch candles from DB
      const dbCandles = await db
        .select()
        .from(candles)
        .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, input.timeframe)))
        .orderBy(desc(candles.ts))
        .limit(500);

      const candleList: Candle[] = dbCandles.map((c) => ({
        symbol: c.symbol,
        tf: c.timeframe as any,
        ts: c.ts.toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: c.volume || 0,
        source: c.source,
      }));

      const slowPeriod = input.strategy.slowPeriod ?? 26;
      const requiredCandleCount = slowPeriod + 20;

      if (candleList.length < requiredCandleCount) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Insufficient history for ${symbol} (${input.timeframe}): required ${requiredCandleCount} candles, available ${candleList.length}`,
        });
      }

      try {
        const result = runBacktest({
          symbol,
          from: input.from ?? candleList[0].ts,
          to: input.to ?? candleList[candleList.length - 1].ts,
          strategyType: input.strategy.type,
          strategyParams: input.strategy,
          riskConfig: input.risk,
        }, candleList);

        // Persist run in PostgreSQL with typed JSON result contract (no 'as any')
        const resultPayload: Record<string, unknown> = {
          runId: result.runId,
          symbol: result.symbol,
          from: result.from,
          to: result.to,
          strategy: result.strategy,
          metrics: result.metrics,
          equityCurve: result.equityCurve,
          benchmarkCurve: result.benchmarkCurve,
          trades: result.trades,
          signalCount: result.signalCount,
          insufficientHistory: result.insufficientHistory,
        };

        const [saved] = await db
          .insert(backtestRuns)
          .values({
            userId: ctx.userId!,
            symbol,
            timeframe: input.timeframe,
            strategy: input.strategy.type,
            parameters: input.strategy,
            result: resultPayload,
          })
          .returning();

        return {
          runId: saved.id,
          status: "completed",
          result,
        };
      } catch (err: any) {
        if (err instanceof InsufficientHistoryError) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err.message,
          });
        }
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Backtest execution failed due to an internal server error",
        });
      }
    }),

  listRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx }) => {
      const rows = await db
        .select()
        .from(backtestRuns)
        .where(eq(backtestRuns.userId, ctx.userId!))
        .orderBy(desc(backtestRuns.createdAt))
        .limit(20);
      return { runs: rows };
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [run] = await db
        .select()
        .from(backtestRuns)
        .where(and(eq(backtestRuns.id, input.runId), eq(backtestRuns.userId, ctx.userId!)))
        .limit(1);

      if (!run) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Backtest run not found" });
      }
      return { run };
    }),

  deleteRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      await db.delete(backtestRuns).where(and(eq(backtestRuns.id, input.runId), eq(backtestRuns.userId, ctx.userId!)));
      return { success: true };
    }),

  compareRuns: protectedProcedure
    .input(z.object({ runIds: z.array(z.string().uuid()).min(2).max(5) }).strict())
    .query(async ({ ctx, input }) => {
      const rows = await db
        .select()
        .from(backtestRuns)
        .where(and(eq(backtestRuns.userId, ctx.userId!), sql`${backtestRuns.id} = ANY(${input.runIds}::uuid[])`));
      return { runs: rows };
    }),

  savePreset: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80), strategy: StrictStrategySchema, risk: StrictRiskSchema }).strict())
    .mutation(async ({ ctx, input }) => {
      const [saved] = await db
        .insert(backtestPresets)
        .values({
          userId: ctx.userId!,
          name: input.name,
          strategy: input.strategy.type,
          parameters: input.strategy,
          riskConfig: input.risk,
        })
        .returning();

      return { presetId: saved.id, name: saved.name };
    }),
});