/**
 * Research run reports tRPC router: immutable reports of the user's completed strategy backtests,
 * their CSV exports, and like-for-like comparisons of 2-4 runs. Only the owner can read a run;
 * anything else is NOT_FOUND.
 */

import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import { compareOwnedRuns, listCompletedRuns, loadOwnedRun } from "../../../modules/research-reports/repository";
import { buildRunReport, runCsv } from "../../../modules/research-reports/report";

const RUN_NOT_FOUND = "Completed run not found";
const jobId = z.string().uuid();

export const researchReportsRouter = createRouter({
  listRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().min(1).max(100).default(100) }).strict().optional())
    .query(async ({ ctx, input }) => ({ runs: await listCompletedRuns(ctx.userId!, input?.limit ?? 100) })),

  getReport: protectedProcedure
    .input(z.object({ jobId }).strict())
    .query(async ({ ctx, input }) => {
      const run = await loadOwnedRun(ctx.userId!, input.jobId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: RUN_NOT_FOUND });
      return buildRunReport(run, new Date());
    }),

  exportCsv: protectedProcedure
    .input(z.object({ jobId, kind: z.enum(["trades", "equity"]) }).strict())
    .query(async ({ ctx, input }) => {
      const run = await loadOwnedRun(ctx.userId!, input.jobId);
      if (!run) throw new TRPCError({ code: "NOT_FOUND", message: RUN_NOT_FOUND });
      return runCsv(run, input.kind);
    }),

  compare: protectedProcedure
    .input(
      z.object({
        jobIds: z.array(jobId).min(2).max(4).refine((ids) => new Set(ids).size === ids.length, "Pick each run once"),
      }).strict(),
    )
    .query(async ({ ctx, input }) => {
      const comparison = await compareOwnedRuns(ctx.userId!, input.jobIds);
      if (!comparison) throw new TRPCError({ code: "NOT_FOUND", message: RUN_NOT_FOUND });
      return comparison;
    }),
});
