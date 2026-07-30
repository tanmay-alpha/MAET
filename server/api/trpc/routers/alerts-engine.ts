import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";

export const alertsEngineRouter = createRouter({
  // Server-side alert evaluation is performed by the worker.
  // This router provides the trigger history that the frontend consumes.
  listTriggerHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).optional())
    .query(async ({ ctx }) => {
      // Placeholder: returns empty until the worker writes alert_events
      return { items: [], nextCursor: null };
    }),
});