import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { calculateMarketBreadth, getHeatmapCells } from "../../../modules/market-breadth/service";

export const marketBreadthRouter = createRouter({
  getOverview: protectedProcedure
    .input(z.object({ universe: z.string().default("ALL_NSE") }).optional())
    .query(async ({ input }) => {
      return await calculateMarketBreadth(input?.universe ?? "ALL_NSE");
    }),
  getBreadth: protectedProcedure
    .input(z.object({ universe: z.string().default("ALL_NSE") }).optional())
    .query(async ({ input }) => {
      return await calculateMarketBreadth(input?.universe ?? "ALL_NSE");
    }),
  getHeatmapCells: protectedProcedure
    .input(z.object({ universe: z.string().default("ALL_NSE") }).optional())
    .query(async ({ input }) => {
      return await getHeatmapCells(input?.universe ?? "ALL_NSE");
    }),
  getHeatmap: protectedProcedure
    .input(z.object({ universe: z.string().default("ALL_NSE") }).optional())
    .query(async ({ input }) => {
      return await getHeatmapCells(input?.universe ?? "ALL_NSE");
    }),
});