/**
 * Strategy Optimisation tRPC Router.
 * Handles parameter sweeps and walk-forward validation runs.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import { db } from "../../../data/drizzle/client";
import {
  strategyParameterSweeps,
  strategySweepResults,
  strategyWalkForwardRuns,
  strategyWalkForwardWindows,
  strategyDefinitions,
} from "../../../db/schema";
import { eq, and, desc } from "drizzle-orm";
import { CreateSweepInputSchema, CreateWalkForwardInputSchema } from "../../../../shared/strategy/contracts";
import { insertWithinActiveJobCap } from "../../../modules/strategy-jobs/repository";
import { analyseSweepRobustness } from "../../../modules/strategy-optimisation/sweep-robustness";
import { countWalkForwardWindows, walkForwardRange, walkForwardRunSpans } from "../../../domain/strategy/walk-forward";
import { countCombinations, MAX_SWEEP_COMBINATIONS, type SweepParameter } from "../../../domain/strategy/parameter-sweep";

/** Rejects parameter grids larger than a sweep or walk-forward run may request; returns the grid size. */
function assertCombinationLimit(parameters: SweepParameter[]): number {
  const combinationCount = countCombinations(parameters);
  if (combinationCount > MAX_SWEEP_COMBINATIONS) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Too many parameter combinations: ${combinationCount} (max ${MAX_SWEEP_COMBINATIONS}). Reduce the number of parameters or values.`,
    });
  }
  return combinationCount;
}

export const strategyOptimisationRouter = createRouter({
  /** Create a parameter sweep (bounded grid search) */
  createSweep: protectedProcedure
    .input(CreateSweepInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify strategy ownership
      const [strategy] = await db
        .select()
        .from(strategyDefinitions)
        .where(and(eq(strategyDefinitions.id, input.strategyId), eq(strategyDefinitions.userId, ctx.userId!)))
        .limit(1);
      if (!strategy) throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });

      const combinationCount = assertCombinationLimit(input.parameters);

      const [sweep] = await insertWithinActiveJobCap(ctx.userId!, "sweep", (tx) => tx
        .insert(strategyParameterSweeps)
        .values({
          userId: ctx.userId!,
          strategyId: input.strategyId,
          parameters: input.parameters as any,
          combinationCount,
          symbolOrUniverse: input.symbolOrUniverse,
          timeframe: input.timeframe,
          fromDate: new Date(input.from),
          toDate: new Date(input.to),
          status: "QUEUED",
          completedCount: 0,
        })
        .returning());

      return { sweep };
    }),

  /**
   * Get a parameter sweep, its results and (once completed) their robustness analysis, including
   * the retrospective-selection label, trial count and probability of backtest overfitting.
   */
  getSweep: protectedProcedure
    .input(z.object({ sweepId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [sweep] = await db
        .select()
        .from(strategyParameterSweeps)
        .where(and(eq(strategyParameterSweeps.id, input.sweepId), eq(strategyParameterSweeps.userId, ctx.userId!)))
        .limit(1);
      if (!sweep) throw new TRPCError({ code: "NOT_FOUND", message: "Sweep not found" });

      const results = await db
        .select()
        .from(strategySweepResults)
        .where(eq(strategySweepResults.sweepId, input.sweepId))
        .orderBy(strategySweepResults.combinationIndex);

      const robustness = sweep.status === "COMPLETED" && results.length > 0
        // Validated against SweepParameterSchema when the sweep was created.
        ? analyseSweepRobustness(sweep.parameters as SweepParameter[], results)
        : null;

      // The per-block returns feed the PBO above; the client does not need them.
      const summaries = results.map(({ resultSummary, ...row }) => {
        if (!resultSummary || typeof resultSummary !== "object") return { ...row, resultSummary };
        const { returnBlocks: _returnBlocks, ...summary } = resultSummary as Record<string, unknown>;
        return { ...row, resultSummary: summary };
      });

      return { sweep, results: summaries, robustness };
    }),

  /** List sweeps for a strategy */
  listSweeps: protectedProcedure
    .input(z.object({ strategyId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const sweeps = await db
        .select()
        .from(strategyParameterSweeps)
        .where(and(eq(strategyParameterSweeps.strategyId, input.strategyId), eq(strategyParameterSweeps.userId, ctx.userId!)))
        .orderBy(desc(strategyParameterSweeps.createdAt))
        .limit(20);
      return { sweeps };
    }),

  /** Cancel a queued sweep */
  cancelSweep: protectedProcedure
    .input(z.object({ sweepId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      await db
        .update(strategyParameterSweeps)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(and(
          eq(strategyParameterSweeps.id, input.sweepId),
          eq(strategyParameterSweeps.userId, ctx.userId!),
          eq(strategyParameterSweeps.status, "QUEUED"),
        ));
      return { cancelled: true };
    }),

  /** Create a walk-forward validation run */
  createWalkForward: protectedProcedure
    .input(CreateWalkForwardInputSchema)
    .mutation(async ({ ctx, input }) => {
      const [strategy] = await db
        .select()
        .from(strategyDefinitions)
        .where(and(eq(strategyDefinitions.id, input.strategyId), eq(strategyDefinitions.userId, ctx.userId!)))
        .limit(1);
      if (!strategy) throw new TRPCError({ code: "NOT_FOUND", message: "Strategy not found" });

      assertCombinationLimit(input.parameters);

      // Calendar-day windows of training, validation and out-of-sample test that step by the test span.
      const { rangeStart, rangeEnd } = walkForwardRange(new Date(input.from), new Date(input.to));
      const rangeMs = rangeEnd.getTime() - rangeStart.getTime();
      const spans = walkForwardRunSpans({ trainingDays: input.trainingWindowDays, validationDays: input.validationWindowDays });
      const maxWindows = countWalkForwardWindows(rangeMs, spans);
      if (maxWindows < input.minimumWindows) {
        const neededDays = spans.trainingDays + spans.validationDays + input.minimumWindows * spans.testDays;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Date range is too short for ${input.minimumWindows} windows. Need at least ${neededDays} days, got ${Math.floor(rangeMs / 86_400_000)}.`,
        });
      }

      const [run] = await insertWithinActiveJobCap(ctx.userId!, "walk-forward", (tx) => tx
        .insert(strategyWalkForwardRuns)
        .values({
          userId: ctx.userId!,
          strategyId: input.strategyId,
          mode: input.mode,
          parameters: input.parameters as any,
          symbol: input.symbol,
          timeframe: input.timeframe,
          fromDate: new Date(input.from),
          toDate: new Date(input.to),
          trainingDays: input.trainingWindowDays,
          validationDays: input.validationWindowDays,
          windowCount: Math.min(maxWindows, input.minimumWindows * 2),
          status: "QUEUED",
        })
        .returning());

      return { run };
    }),

  /** Get walk-forward run and its windows */
  getWalkForward: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [run] = await db
        .select()
        .from(strategyWalkForwardRuns)
        .where(and(eq(strategyWalkForwardRuns.id, input.runId), eq(strategyWalkForwardRuns.userId, ctx.userId!)))
        .limit(1);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: "Walk-forward run not found" });

      const windows = await db
        .select()
        .from(strategyWalkForwardWindows)
        .where(eq(strategyWalkForwardWindows.runId, input.runId))
        .orderBy(strategyWalkForwardWindows.windowIndex);

      return { run, windows };
    }),

  /** List walk-forward runs for a strategy */
  listWalkForwards: protectedProcedure
    .input(z.object({ strategyId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const runs = await db
        .select()
        .from(strategyWalkForwardRuns)
        .where(and(eq(strategyWalkForwardRuns.strategyId, input.strategyId), eq(strategyWalkForwardRuns.userId, ctx.userId!)))
        .orderBy(desc(strategyWalkForwardRuns.createdAt))
        .limit(20);
      return { runs };
    }),
});
