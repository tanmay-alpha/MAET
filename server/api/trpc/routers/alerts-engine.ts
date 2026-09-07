import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  listTriggerHistory,
  listUserNotifications,
  markNotificationRead,
  dismissNotification,
  listUserAlerts,
  createAlert,
  toggleAlert,
  rearmAlert,
  deleteAlert,
} from "../../../modules/alerts/repository";
import {
  CreateAlertInputSchema,
  type AlertView,
  type AlertTriggerView,
  type AlertNotificationView,
} from "../../../modules/alerts/contracts";

export const alertsEngineRouter = createRouter({
  listAlerts: protectedProcedure.query(async ({ ctx }): Promise<{ items: AlertView[] }> => {
    const items = await listUserAlerts(ctx.userId!);
    return { items };
  }),

  listTriggerHistory: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).optional())
    .query(async ({ ctx, input }): Promise<{ items: AlertTriggerView[] }> => {
      return await listTriggerHistory(ctx.userId!, input?.limit ?? 20);
    }),

  listNotifications: protectedProcedure
    .input(z.object({ limit: z.number().int().positive().max(100).default(20) }).optional())
    .query(async ({ ctx, input }): Promise<{ items: AlertNotificationView[] }> => {
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
    .input(CreateAlertInputSchema)
    .mutation(async ({ ctx, input }): Promise<AlertView> => {
      return await createAlert(ctx.userId!, input);
    }),

  toggleAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid(), enabled: z.boolean() }).strict())
    .mutation(async ({ ctx, input }): Promise<AlertView> => {
      try {
        const result = await toggleAlert(input.alertId, ctx.userId!, input.enabled);
        if (!result) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
        }
        return result;
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message ?? "Failed to toggle alert",
        });
      }
    }),

  rearmAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }): Promise<AlertView> => {
      try {
        const result = await rearmAlert(input.alertId, ctx.userId!);
        if (!result) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
        }
        return result;
      } catch (err: any) {
        if (err instanceof TRPCError) throw err;
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: err.message ?? "Failed to rearm alert",
        });
      }
    }),

  deleteAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      return await deleteAlert(input.alertId, ctx.userId!);
    }),
});