import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import {
  listTriggerHistory,
  listUserNotifications,
  markNotificationRead,
  dismissNotification,
  listUserAlerts,
  createAlert,
  toggleAlert,
  deleteAlert,
} from "../../../modules/alerts/repository";
import { AlertDefinitionInputSchema } from "../../../modules/alerts/contracts";

export const alertsEngineRouter = createRouter({
  listAlerts: protectedProcedure.query(async ({ ctx }) => {
    const items = await listUserAlerts(ctx.userId!);
    return { items };
  }),

  listTriggerHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      return await listTriggerHistory(ctx.userId!, input?.limit ?? 20);
    }),

  listNotifications: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).optional())
    .query(async ({ ctx, input }) => {
      return await listUserNotifications(ctx.userId!, input?.limit ?? 20);
    }),

  markNotificationRead: protectedProcedure
    .input(z.object({ notificationId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      return await markNotificationRead(input.notificationId, ctx.userId!);
    }),

  dismissNotification: protectedProcedure
    .input(z.object({ notificationId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      return await dismissNotification(input.notificationId, ctx.userId!);
    }),

  createAlert: protectedProcedure
    .input(AlertDefinitionInputSchema)
    .mutation(async ({ ctx, input }) => {
      return await createAlert(ctx.userId!, input);
    }),

  toggleAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid(), enabled: z.boolean() }).strict())
    .mutation(async ({ ctx, input }) => {
      return await toggleAlert(input.alertId, ctx.userId!, input.enabled);
    }),

  deleteAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      return await deleteAlert(input.alertId, ctx.userId!);
    }),
});