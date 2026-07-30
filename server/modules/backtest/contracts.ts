/**
 * Backtest V2 contracts, service, and tRPC router.
 */

import { createRouter, protectedProcedure } from "../../api/trpc/core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

// ===== Contracts =====

export const StrategyTypeSchema = z.enum([
  "SMA_CROSS", "EMA_CROSS", "RSI_REVERSAL", "MACD_CROSS",
  "DONCHIAN_BREAKOUT", "BOLLINGER_MEAN_REVERSION", "COMBINED_RULES",
]);
export type StrategyType = z.infer<typeof StrategyTypeSchema>;

export const RiskConfigSchema = z.object({
  initialCapital: z.number().positive(),
  feeBps: z.number().min(0),
  slippageBps: z.number().min(0),
  positionSizePercent: z.number().min(1).max(100),
  maximumOpenPositions: z.number().int().min(1).max(100),
  stopLossPercent: z.number().positive().optional(),
  takeProfitPercent: z.number().positive().optional(),
  trailingStopPercent: z.number().positive().optional(),
});

export const StrategyParamsSchema = z.object({
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

export const RunBacktestInputSchema = z.object({
  symbol: z.string().min(1),
  from: z.string().datetime(),
  to: z.string().datetime(),
  strategy: StrategyParamsSchema,
  risk: RiskConfigSchema,
  benchmarkSymbol: z.string().optional(),
});

export type RunBacktestInput = z.infer<typeof RunBacktestInputSchema>;
export type RiskConfig = z.infer<typeof RiskConfigSchema>;
export type StrategyParams = z.infer<typeof StrategyParamsSchema>;

// ===== Router =====

export const backtestRouter = createRouter({
  run: protectedProcedure
    .input(RunBacktestInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Stub: actual execution would fetch candle data and run strategy.
      return {
        runId: `bt-${Date.now()}-${ctx.userId.slice(0, 4)}`,
        symbol: input.symbol,
        from: input.from,
        to: input.to,
        strategy: input.strategy.type,
        metrics: {
          totalReturn: 0,
          annualisedReturn: 0,
          benchmarkReturn: 0,
          alpha: 0,
          volatility: 0,
          sharpe: 0,
          sortino: 0,
          maxDrawdown: 0,
          calmar: 0,
          winRate: 0,
          profitFactor: 0,
          expectancy: 0,
          averageHoldingPeriod: 0,
          exposure: 0,
          turnover: 0,
        },
        trades: [],
        equityCurve: [],
        insufficientHistory: false,
      };
    }),

  listRuns: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().int().positive().max(50).default(20),
    }))
    .query(async ({ ctx }) => {
      // Stub: return empty list until persistence layer is connected.
      return {
        runs: [],
        nextCursor: null,
      };
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .query(async ({ input }) => {
      throw new TRPCError({ code: "NOT_FOUND", message: `Run ${input.runId} not found` });
    }),

  deleteRun: protectedProcedure
    .input(z.object({ runId: z.string() }))
    .mutation(async () => {
      // Stub: would delete the run if it exists and belongs to the user.
      return { deleted: false };
    }),

  compareRuns: protectedProcedure
    .input(z.object({ runIds: z.array(z.string()).min(2).max(10) }))
    .query(async () => {
      // Stub: would fetch and compare runs side by side.
      return { runs: [] };
    }),

  savePreset: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      strategy: StrategyParamsSchema,
      risk: RiskConfigSchema,
    }))
    .mutation(async ({ ctx }) => {
      // Stub: would persist a preset for the user.
      return { presetId: `preset-${Date.now()}` };
    }),
});

export type BacktestRouter = typeof backtestRouter;