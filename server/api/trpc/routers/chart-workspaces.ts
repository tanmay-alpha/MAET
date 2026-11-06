import { z } from "zod";
import { createRouter as router, protectedProcedure } from "../core";
import { chartWorkspaceService } from "@server/modules/chart-workspaces/service";
import { IndicatorInstanceSchema } from "@shared/research/schemas";

// Pane settings are persisted as JSONB; bound every level so a caller cannot
// store arbitrarily large documents.
const IndicatorInputSchema = z.object({
  id: z.string().min(1).max(64),
  type: IndicatorInstanceSchema.shape.type,
  pane: z.enum(["main", "subpanel"]).default("main"),
  parameters: z
    .record(z.string().max(40), z.union([z.number().finite(), z.string().max(64), z.boolean()]))
    .refine((params) => Object.keys(params).length <= 16, "At most 16 indicator parameters")
    .default({}),
  style: z
    .object({ color: z.string().max(32), lineWidth: z.number().min(0).max(20).optional() })
    .default({ color: "#3b82f6" }),
  visible: z.boolean().default(true),
});

export const chartWorkspacesRouter = router({
  list: protectedProcedure.query(async ({ ctx }) => {
    return chartWorkspaceService.getUserWorkspaces(ctx.userId);
  }),

  get: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .query(async ({ ctx, input }) => {
      return chartWorkspaceService.getWorkspaceDetails(ctx.userId, input.id);
    }),

  create: protectedProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        layoutType: z.enum(["SINGLE", "VERTICAL_2", "HORIZONTAL_2", "GRID_4"]).default("SINGLE"),
      })
    )
    .mutation(async ({ ctx, input }) => {
      return chartWorkspaceService.createWorkspace(ctx.userId, input.name, input.layoutType);
    }),

  saveLayout: protectedProcedure
    .input(
      z.object({
        workspaceId: z.string().uuid(),
        layoutType: z.enum(["SINGLE", "VERTICAL_2", "HORIZONTAL_2", "GRID_4"]),
        panes: z.array(
          z.object({
            id: z.string().max(64).optional(),
            paneKey: z.string().max(40).optional(),
            symbol: z.string().min(1).max(30),
            exchange: z.string().max(10).default("NSE"),
            timeframe: z.string().max(10).default("5m"),
            chartType: z.string().max(20).default("CANDLE"),
            indicators: z.array(IndicatorInputSchema).max(20).optional(),
          })
        ).max(4),
      })
    )
    .mutation(async ({ ctx, input }) => {
      await chartWorkspaceService.saveLayout(ctx.userId, input.workspaceId, input.layoutType, input.panes);
      return { success: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string().uuid() }))
    .mutation(async ({ ctx, input }) => {
      await chartWorkspaceService.deleteWorkspace(ctx.userId, input.id);
      return { success: true };
    }),
});
