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
  AlertStateError,
} from "../../../modules/alerts/repository";
import {
  CreateAlertInputSchema,
  type AlertView,
  type AlertTriggerView,
  type AlertNotificationView,
} from "../../../modules/alerts/contracts";

/**
 * Only domain state errors are the caller's fault (BAD_REQUEST). Anything else
 * (database failures, bugs) is INTERNAL_SERVER_ERROR with the original error as
 * `cause`, so its message (SQL, parameters) is logged but never returned.
 */
export function toAlertMutationError(err: unknown, action: string): TRPCError {
  if (err instanceof TRPCError) return err;
  if (err instanceof AlertStateError) {
    return new TRPCError({ code: "BAD_REQUEST", message: err.message, cause: err });
  }
  return new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: `Failed to ${action} alert`, cause: err });
}

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
      } catch (err) {
        throw toAlertMutationError(err, "toggle");
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
      } catch (err) {
        throw toAlertMutationError(err, "rearm");
      }
    }),

  deleteAlert: protectedProcedure
    .input(z.object({ alertId: z.string().uuid() }).strict())
    .mutation(async ({ ctx, input }) => {
      return await deleteAlert(input.alertId, ctx.userId!);
    }),
});