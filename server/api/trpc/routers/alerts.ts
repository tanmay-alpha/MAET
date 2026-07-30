/**
 * Alert tRPC router — exposes alert CRUD and query operations.
 */

import { createRouter, protectedProcedure } from "../core";
import { AlertDefinitionInputSchema, AlertTypeSchema } from "@server/modules/alerts/contracts";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const alertsRouter = createRouter({
  list: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().int().positive().max(100).default(20),
      enabled: z.boolean().optional(),
    }))
    .query(async ({ ctx }) => {
      // Stub: would call AlertService.listAlerts(ctx.userId)
      return {
        alerts: [],
        nextCursor: null,
      };
    }),

  create: protectedProcedure
    .input(AlertDefinitionInputSchema)
    .mutation(async ({ input }) => {
      // Stub: would persist to alert_definitions table
      return {
        id: `alert-${Date.now()}`,
        ...input,
        createdAt: new Date().toISOString(),
      };
    }),

  update: protectedProcedure
    .input(z.object({
      id: z.string(),
      enabled: z.boolean().optional(),
      label: z.string().min(1).max(100).optional(),
    }))
    .mutation(async ({ input }) => {
      return { id: input.id, updated: true };
    }),

  delete: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return { id: input.id, deleted: true };
    }),

  listTypes: protectedProcedure
    .query(async () => {
      return AlertTypeSchema.options.map((type) => ({
        type,
        description: describeAlertType(type),
      }));
    }),

  listEvents: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      limit: z.number().int().positive().max(100).default(20),
      symbol: z.string().optional(),
    }))
    .query(async ({ ctx }) => {
      return {
        events: [],
        nextCursor: null,
      };
    }),

  listNotifications: protectedProcedure
    .input(z.object({
      cursor: z.string().optional(),
      unreadOnly: z.boolean().default(false),
      limit: z.number().int().positive().max(100).default(20),
    }))
    .query(async ({ ctx }) => {
      return {
        notifications: [],
        nextCursor: null,
      };
    }),

  markNotificationRead: protectedProcedure
    .input(z.object({ id: z.string() }))
    .mutation(async ({ input }) => {
      return { id: input.id, marked: true };
    }),

  markAllNotificationsRead: protectedProcedure
    .mutation(async ({ ctx }) => {
      return { userId: ctx.userId, markedCount: 0 };
    }),
});

function describeAlertType(type: string): string {
  const map: Record<string, string> = {
    PRICE_ABOVE: "Triggers when price moves above threshold",
    PRICE_BELOW: "Triggers when price moves below threshold",
    PERCENT_CHANGE_ABOVE: "Triggers when percentage change exceeds threshold",
    PERCENT_CHANGE_BELOW: "Triggers when percentage change falls below threshold",
    VOLUME_ABOVE: "Triggers when volume exceeds threshold",
    RELATIVE_VOLUME_ABOVE: "Triggers when relative volume exceeds threshold",
    RSI_ABOVE: "Triggers when RSI exceeds threshold",
    RSI_BELOW: "Triggers when RSI falls below threshold",
    MACD_CROSS_ABOVE: "Triggers when MACD crosses above signal",
    MACD_CROSS_BELOW: "Triggers when MACD crosses below signal",
    PRICE_CROSS_SMA: "Triggers when price crosses above SMA",
    SCREENER_MATCH: "Triggers when a saved screener matches",
  };
  return map[type] ?? type;
}