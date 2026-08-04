/**
 * Strategy Backtests tRPC Router.
 * Handles job creation, polling, run retrieval, comparison, trade/equity fetching.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import { db } from "../../../data/drizzle/client";
import {
  strategyBacktestJobs,
  strategyBacktestTrades,
  strategyEquityPoints,
  strategyPerformanceSnapshots,
  strategyVersions,
} from "../../../db/schema";
import { eq, and, desc, inArray } from "drizzle-orm";
import * as jobsRepo from "../../../modules/strategy-jobs/repository";
import { CreateBacktestJobInputSchema } from "../../../../shared/strategy/contracts";

export const strategyBacktestsRouter = createRouter({
  /** Create a backtest job and add it to the durable queue */
  createJob: protectedProcedure
    .input(CreateBacktestJobInputSchema)
    .mutation(async ({ ctx, input }) => {
      // Verify the version exists and belongs to the user
      const [version] = await db
        .select()
        .from(strategyVersions)
        .where(and(eq(strategyVersions.id, input.strategyVersionId), eq(strategyVersions.userId, ctx.userId!)))
        .limit(1);
      if (!version) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Strategy version not found" });
      }

      const job = await jobsRepo.createJob(
        ctx.userId!,
        input.strategyVersionId,
        input.symbolOrUniverse,
        input.timeframe,
        new Date(input.from),
        new Date(input.to),
        input.overrideCapital,
        input.benchmarkSymbol,
      );
      return { job };
    }),

  /** Get a job and its current status/progress */
  getJob: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [job] = await db
        .select()
        .from(strategyBacktestJobs)
        .where(and(eq(strategyBacktestJobs.id, input.jobId), eq(strategyBacktestJobs.userId, ctx.userId!)))
        .limit(1);
      if (!job) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Backtest job not found" });
      }

      // Load snapshot if completed
      let snapshot = null;
      if (job.status === "COMPLETED") {
        const [snap] = await db
          .select()
          .from(strategyPerformanceSnapshots)
          .where(eq(strategyPerformanceSnapshots.jobId, job.id))
          .limit(1);
        snapshot = snap ?? null;
      }

      return { job, snapshot };
    }),

  /** Cancel a queued or running job */
  cancelJob: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      const cancelled = await jobsRepo.requestCancellation(ctx.userId!, input.jobId);
      if (!cancelled) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Job not found or already completed" });
      }
      return { requested: true };
    }),

  /** List all backtest jobs for the user */
  listJobs: protectedProcedure
    .input(z.object({
      strategyVersionId: z.string().uuid().optional(),
      limit: z.number().int().min(1).max(50).default(20),
    }).optional())
    .query(async ({ ctx, input }) => {
      const query = db
        .select()
        .from(strategyBacktestJobs)
        .where(eq(strategyBacktestJobs.userId, ctx.userId!))
        .orderBy(desc(strategyBacktestJobs.requestedAt))
        .limit(input?.limit ?? 20);

      const rows = await query;
      return { jobs: rows };
    }),

  /** Get trade-level records for a completed job */
  getTrades: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      // Verify ownership
      const [job] = await db
        .select()
        .from(strategyBacktestJobs)
        .where(and(eq(strategyBacktestJobs.id, input.jobId), eq(strategyBacktestJobs.userId, ctx.userId!)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const trades = await db
        .select()
        .from(strategyBacktestTrades)
        .where(eq(strategyBacktestTrades.jobId, input.jobId))
        .orderBy(strategyBacktestTrades.entryFillTimestamp);
      return { trades };
    }),

  /** Get equity curve for a completed job */
  getEquityCurve: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [job] = await db
        .select()
        .from(strategyBacktestJobs)
        .where(and(eq(strategyBacktestJobs.id, input.jobId), eq(strategyBacktestJobs.userId, ctx.userId!)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const points = await db
        .select()
        .from(strategyEquityPoints)
        .where(eq(strategyEquityPoints.jobId, input.jobId))
        .orderBy(strategyEquityPoints.timestamp);
      return { points };
    }),

  /** Compare up to 5 backtest runs side-by-side */
  compareJobs: protectedProcedure
    .input(z.object({ jobIds: z.array(z.string().uuid()).min(2).max(5) }).strict())
    .query(async ({ ctx, input }) => {
      const snapshots = await db
        .select()
        .from(strategyPerformanceSnapshots)
        .where(and(
          eq(strategyPerformanceSnapshots.userId, ctx.userId!),
          inArray(strategyPerformanceSnapshots.jobId, input.jobIds),
        ));
      return { snapshots };
    }),

  /** Get performance snapshot for a job */
  getPerformance: protectedProcedure
    .input(z.object({ jobId: z.string().uuid() }).strict())
    .query(async ({ ctx, input }) => {
      const [job] = await db
        .select()
        .from(strategyBacktestJobs)
        .where(and(eq(strategyBacktestJobs.id, input.jobId), eq(strategyBacktestJobs.userId, ctx.userId!)))
        .limit(1);
      if (!job) throw new TRPCError({ code: "NOT_FOUND", message: "Job not found" });

      const [snapshot] = await db
        .select()
        .from(strategyPerformanceSnapshots)
        .where(eq(strategyPerformanceSnapshots.jobId, input.jobId))
        .limit(1);

      return { snapshot: snapshot ?? null };
    }),
});
