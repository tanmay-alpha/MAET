import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";

export const marketBreadthRouter = createRouter({
  getBreadth: protectedProcedure
    .input(z.object({ universe: z.enum(["NIFTY_50", "NIFTY_100", "NIFTY_200", "NIFTY_500", "ALL_NSE"]).default("NIFTY_50") }).optional())
    .query(async () => {
      return { advances: 0, declines: 0, unchanged: 0, advanceDeclineRatio: 0 };
    }),
  getHeatmap: protectedProcedure
    .input(z.object({ universe: z.enum(["NIFTY_50", "NIFTY_100", "NIFTY_200", "NIFTY_500", "ALL_NSE"]).default("NIFTY_50") }).optional())
    .query(async () => {
      return { cells: [], universe: "NIFTY_50", asOf: new Date().toISOString() };
    }),
});