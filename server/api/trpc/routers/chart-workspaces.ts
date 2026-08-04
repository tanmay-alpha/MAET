import { z } from "zod";
import { createRouter as router, protectedProcedure } from "../core";
import { chartWorkspaceService } from "@server/modules/chart-workspaces/service";

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
            id: z.string().optional(),
            paneKey: z.string().optional(),
            symbol: z.string().min(1),
            exchange: z.string().default("NSE"),
            timeframe: z.string().default("5m"),
            chartType: z.string().default("CANDLE"),
            indicators: z.array(z.any()).optional(),
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
