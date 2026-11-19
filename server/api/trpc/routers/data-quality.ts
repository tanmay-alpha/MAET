import { createRouter, adminProcedure, publicProcedure } from "../core";
import { z } from "zod";
import { DATA_QUALITY_UNIVERSES } from "../../../modules/data-quality/contracts";
import {
  getDataQualityReport,
  getRecentIngestionBatches,
  getReliabilityReport,
  retryBatch,
} from "../../../modules/data-quality/service";

export const dataQualityRouter = createRouter({
  /** Market-data freshness and completeness for a bounded universe. Aggregates only: no user data. */
  getPublicReport: publicProcedure
    .input(z.object({ universe: z.enum(DATA_QUALITY_UNIVERSES).default("nifty50") }).strict().optional())
    .query(async ({ input }) => {
      return await getDataQualityReport(input?.universe ?? "nifty50");
    }),

  getReliability: adminProcedure.query(async () => {
    return await getReliabilityReport();
  }),

  getOverview: adminProcedure.query(async () => {
    return await getRecentIngestionBatches();
  }),

  retryBatch: adminProcedure
    .input(z.object({ batchId: z.string().min(1) }).strict())
    .mutation(async ({ input }) => {
      return await retryBatch(input.batchId);
    }),
});
