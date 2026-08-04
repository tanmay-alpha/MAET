import { z } from "zod";
import { createRouter as router, protectedProcedure } from "../core";
import { tradeThesisService } from "@server/modules/trade-theses/service";

export const tradeThesesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return tradeThesisService.listTheses(ctx.userId);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return tradeThesisService.getThesisDetails(ctx.userId, input.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        symbol: z.string().min(1),
        exchange: z.enum(["NSE", "BSE"]).default("NSE"),
        screenerRunId: z.string().optional(),
        workspaceId: z.string().uuid().optional(),
        title: z.string().min(1).max(120),
        setupType: z.string().min(1),
        direction: z.enum(["LONG", "SHORT", "WATCH"]),
        hypothesis: z.string().min(1),
        entryPlan: z.string().optional(),
        stopPrice: z.number().positive().optional(),
        targetPrice: z.number().positive().optional(),
        riskAmount: z.number().nonnegative().optional(),
        riskPercent: z.number().nonnegative().optional(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return tradeThesisService.createThesis(ctx.userId, input);
    }),

  captureSnapshot: protectedProcedure
    .input(
      z.object({
        thesisId: z.string().uuid(),
        quotePrice: z.number().positive(),
        quoteSource: z.string(),
        quoteQuality: z.string(),
        timeframe: z.string(),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return tradeThesisService.captureSnapshot(
        ctx.userId,
        input.thesisId,
        input.quotePrice,
        input.quoteSource,
        input.quoteQuality,
        input.timeframe
      );
    }),

  linkOrder: protectedProcedure
    .input(
      z.object({
        thesisId: z.string().uuid(),
        paperOrderId: z.string().uuid(),
        relationship: z.enum(["ENTRY", "ADD", "REDUCE", "EXIT", "STOP", "TARGET"]),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return tradeThesisService.linkOrder(ctx.userId, input);
    }),
});
