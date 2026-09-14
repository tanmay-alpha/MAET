import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { backtestRuns, backtestPresets, candles } from "../../../db/schema";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
// P0-A fix: Route the Backtest Lab to the canonical V3 engine.
// The legacy runBacktest (runner.ts / strategies-v2.ts) is deprecated.
import { runBacktestV3, InsufficientHistoryV3Error } from "../../../domain/strategy/runner-v3";
import { presetToV3Definition } from "../../../domain/backtest/preset-to-v3-adapter";
import { StrategyTypeSchema } from "../../../modules/backtest/contracts";
import type { Candle } from "@shared/types";

export const MAX_BACKTEST_CANDLES = parseInt(process.env.MAX_BACKTEST_CANDLES || "50000", 10);

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

      // Validate maximumOpenPositions for single-symbol engine
      if (input.risk.maximumOpenPositions > 1) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Single-symbol backtest engine supports maximumOpenPositions = 1 (got ${input.risk.maximumOpenPositions}). For concurrent multi-position execution across multiple symbols, use portfolio backtesting.`,
        });
      }

      // Validate date bounds if provided
      let fromDate: Date | undefined;
      let toDate: Date | undefined;

      if (input.from) {
        fromDate = new Date(input.from);
        if (isNaN(fromDate.getTime())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid 'from' date format: ${input.from}. Expected a valid ISO-8601 or YYYY-MM-DD date string.`,
          });
        }
      }

      if (input.to) {
        toDate = new Date(input.to);
        if (isNaN(toDate.getTime())) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: `Invalid 'to' date format: ${input.to}. Expected a valid ISO-8601 or YYYY-MM-DD date string.`,
          });
        }
      }

      if (fromDate && toDate && fromDate.getTime() > toDate.getTime()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `'from' date (${input.from}) must be earlier than or equal to 'to' date (${input.to}).`,
        });
      }

      // Build database query filters
      const conditions = [
        eq(candles.symbol, symbol),
        eq(candles.timeframe, input.timeframe),
      ];

      if (fromDate) {
        conditions.push(gte(candles.ts, fromDate));
      }
      if (toDate) {
        conditions.push(lte(candles.ts, toDate));
      }

      // Fetch candles in chronological order with upper safety bound
      const dbCandles = await db
        .select()
        .from(candles)
        .where(and(...conditions))
        .orderBy(asc(candles.ts))
        .limit(MAX_BACKTEST_CANDLES + 1);

      if (dbCandles.length > MAX_BACKTEST_CANDLES) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Backtest interval contains too many candles (exceeds safety limit of ${MAX_BACKTEST_CANDLES}). Please narrow your date range or select a higher timeframe.`,
        });
      }

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
        // P0-A fix: translate preset params → V3 AST, then run through canonical V3 engine.
        const definition = presetToV3Definition(input.strategy, input.risk);
        const result = runBacktestV3({
          strategyVersionId: `preset:${input.strategy.type}:${Date.now()}`,
          definition,
          symbol,
          candles: candleList,
          timeframe: input.timeframe,
        });

        const effectivePeriod = {
          from: candleList[0].ts,
          to: candleList[candleList.length - 1].ts,
        };

        const resultPayload: Record<string, unknown> = {
          runId: result.runId,
          symbol: result.symbol,
          from: effectivePeriod.from,
          to: effectivePeriod.to,
          effectivePeriod,
          metrics: result.metrics,
          equityCurve: result.equityCurve,
          trades: result.trades,
          signalCount: result.trades.length,
          insufficientHistory: false,
          // Tag the engine version so stored runs are self-describing.
          engineVersion: "v3",
        };

        const [saved] = await db
          .insert(backtestRuns)
          .values({
            userId: ctx.userId!,
            symbol,
            timeframe: input.timeframe,
            strategy: input.strategy.type,
            parameters: {
              ...input.strategy,
              risk: input.risk,
              from: input.from,
              to: input.to,
              effectivePeriod,
            },
            result: resultPayload,
          })
          .returning();

        return {
          runId: saved.id,
          status: "completed",
          effectivePeriod,
          result: {
            ...result,
            from: effectivePeriod.from,
            to: effectivePeriod.to,
            engineVersion: "v3" as const,
          },
        };
      } catch (err: any) {
        if (err instanceof InsufficientHistoryV3Error) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: err.message,
          });
        }
        if (err instanceof Error && (err.message.includes("cannot be automatically translated") || err.message.includes("Single-symbol strategy execution requires maximumOpenPositions = 1"))) {
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
    .query(async ({ ctx, input }) => {
      const limit = input?.limit ?? 20;
      const rows = await db
        .select()
        .from(backtestRuns)
        .where(eq(backtestRuns.userId, ctx.userId!))
        .orderBy(desc(backtestRuns.createdAt))
        .limit(limit);
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