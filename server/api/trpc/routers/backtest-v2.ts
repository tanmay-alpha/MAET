import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";

export const backtestV2Router = createRouter({
  run: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1),
      timeframe: z.string().default("1d"),
      strategy: z.string().default("sma_cross"),
      parameters: z.record(z.any()).default({}),
      risk: z.object({
        initialCapital: z.number().positive().optional(),
        feeBps: z.number().min(0).default(10),
        slippageBps: z.number().min(0).default(5),
      }).default({ feeBps: 10, slippageBps: 5 }),
    }).strict())
    .mutation(async ({ input }) => {
      // Placeholder: delegates to existing backtest engine
      return { runId: crypto.randomUUID(), status: "queued", symbols: [input.symbol] };
    }),

  listRuns: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(50).default(20) }).optional())
    .query(async ({ ctx }) => {
      return { items: [], nextCursor: null };
    }),

  getRun: protectedProcedure
    .input(z.object({ runId: z.string().uuid() }).strict())
    .query(async () => {
      return { run: null };
    }),

  compareRuns: protectedProcedure
    .input(z.object({ runIds: z.array(z.string().uuid()).min(2).max(5) }).strict())
    .query(async () => {
      return { runs: [] };
    }),

  savePreset: protectedProcedure
    .input(z.object({ name: z.string().min(1).max(80), strategy: z.string(), parameters: z.record(z.any()) }).strict())
    .mutation(async () => {
      return { presetId: crypto.randomUUID() };
    }),
});