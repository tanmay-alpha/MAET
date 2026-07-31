import { createRouter, adminProcedure } from "../core";
import { z } from "zod";
import {
  getDataQualityOverview,
  listAudits,
  listAnomalies,
  resolveAnomaly,
  suppressAnomaly,
  retryBatch,
  getDataCoverage,
} from "../../../modules/data-quality/service";

export const dataQualityRouter = createRouter({
  getOverview: adminProcedure.query(async () => {
    return await getDataQualityOverview();
  }),

  listAudits: adminProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ input }) => {
      return await listAudits(input?.limit ?? 20);
    }),

  listAnomalies: adminProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ input }) => {
      return await listAnomalies(input?.limit ?? 20);
    }),

  resolveAnomaly: adminProcedure
    .input(z.object({ anomalyId: z.string().uuid(), resolutionNote: z.string().optional() }).strict())
    .mutation(async ({ input }) => {
      return await resolveAnomaly(input.anomalyId, input.resolutionNote);
    }),

  suppressAnomaly: adminProcedure
    .input(z.object({ anomalyId: z.string().uuid() }).strict())
    .mutation(async ({ input }) => {
      return await suppressAnomaly(input.anomalyId);
    }),

  retryBatch: adminProcedure
    .input(z.object({ batchId: z.string().min(1) }).strict())
    .mutation(async ({ input }) => {
      return await retryBatch(input.batchId);
    }),

  getCoverage: adminProcedure.query(async () => {
    return await getDataCoverage();
  }),
});