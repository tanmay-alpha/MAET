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

const MAX_COMBINATIONS = 500;

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

      // Validate combination count
      const combinationCount = input.parameters.reduce((product, p) => product * p.values.length, 1);
      if (combinationCount > MAX_COMBINATIONS) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Too many parameter combinations: ${combinationCount} (max ${MAX_COMBINATIONS}). Reduce the number of parameters or values.`,
        });
      }

      const [sweep] = await db
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
        .returning();

      return { sweep };
    }),

  /** Get a parameter sweep and its results */
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

      return { sweep, results };
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

      // Validate minimum windows
      const totalDays = (new Date(input.to).getTime() - new Date(input.from).getTime()) / 86_400_000;
      const windowSize = input.trainingWindowDays + input.validationWindowDays;
      const maxWindows = Math.floor(totalDays / input.validationWindowDays);
      if (maxWindows < input.minimumWindows) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Date range is too short for ${input.minimumWindows} windows. Need at least ${input.minimumWindows * windowSize} days, got ${Math.floor(totalDays)}.`,
        });
      }

      const [run] = await db
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
        .returning();

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
});
