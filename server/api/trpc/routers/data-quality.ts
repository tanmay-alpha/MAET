import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";

export const dataQualityRouter = createRouter({
  getOverview: protectedProcedure.query(async () => {
    return { totalAudits: 0, openAnomalies: 0, recentBatches: [] };
  }),
  listAudits: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async () => {
      return { items: [], nextCursor: null };
    }),
  listAnomalies: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async () => {
      return { items: [], nextCursor: null };
    }),
  resolveAnomaly: protectedProcedure
    .input(z.object({ anomalyId: z.string().uuid(), resolutionNote: z.string().optional() }).strict())
    .mutation(async () => {
      return { success: true };
    }),
  suppressAnomaly: protectedProcedure
    .input(z.object({ anomalyId: z.string().uuid() }).strict())
    .mutation(async () => {
      return { success: true };
    }),
  retryBatch: protectedProcedure
    .input(z.object({ batchId: z.string().min(1) }).strict())
    .mutation(async () => {
      return { success: true };
    }),
  getCoverage: protectedProcedure.query(async () => {
    return { companiesWithQuotes: 0, companiesWithFundamentals: 0, lastIngestion: null };
  }),
});