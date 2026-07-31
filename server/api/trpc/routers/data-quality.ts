import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import {
  assertAdmin,
  getDataQualityOverview,
  listAudits,
  listAnomalies,
  resolveAnomaly,
  suppressAnomaly,
  retryBatch,
  getDataCoverage,
} from "../../../modules/data-quality/service";

export const dataQualityRouter = createRouter({
  getOverview: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx as any);
    return await getDataQualityOverview();
  }),

  listAudits: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx as any);
      return await listAudits(input?.limit ?? 20);
    }),

  listAnomalies: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      assertAdmin(ctx as any);
      return await listAnomalies(input?.limit ?? 20);
    }),

  resolveAnomaly: protectedProcedure
    .input(z.object({ anomalyId: z.string().uuid(), resolutionNote: z.string().optional() }).strict())
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx as any);
      return await resolveAnomaly(input.anomalyId, input.resolutionNote);
    }),

  suppressAnomaly: protectedProcedure
    .input(z.object({ anomalyId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx as any);
      return await suppressAnomaly(input.anomalyId);
    }),

  retryBatch: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }).strict())
    .mutation(async ({ ctx, input }) => {
      assertAdmin(ctx as any);
      return await retryBatch(input.batchId);
    }),

  getCoverage: protectedProcedure.query(async ({ ctx }) => {
    assertAdmin(ctx as any);
    return await getDataCoverage();
  }),
});