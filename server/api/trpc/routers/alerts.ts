/**
 * Alerts tRPC Router
 * CRUD operations for price alerts, volume alerts, and indicator alerts
 */

import { router, protectedProcedure } from "../index";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../data/drizzle/client";
import { alerts } from "../../data/drizzle/schema";
import { eq, and } from "drizzle-orm";

export const alertsRouter = router({
  // Get all alerts for the current user
  getAlerts: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userAlerts = await db.select().from(alerts).where(eq(alerts.userId, ctx.userId));
        return userAlerts;
      } catch (error) {
        console.error("Error fetching alerts:", error);
        return [];
      }
    }),

  // Create a new alert
  createAlert: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      exchange: z.string().default("NSE"),
      type: z.enum(["price", "volume", "indicator"]),
      condition: z.enum(["above", "below", "crosses_above", "crosses_below"]),
      target: z.number().positive(),
      message: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const newAlert = await db.insert(alerts).values({
          id: crypto.randomUUID(),
          userId: ctx.userId,
          symbol: input.symbol.toUpperCase(),
          exchange: input.exchange.toUpperCase(),
          type: input.type,
          condition: input.condition,
          target: input.target,
          message: input.message || null,
          triggered: false,
          triggeredAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        }).returning();

        return newAlert[0];
      } catch (error) {
        console.error("Error creating alert:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create alert",
        });
      }
    }),

  // Delete an alert
  deleteAlert: protectedProcedure
    .input(z.object({
      alertId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const result = await db.delete(alerts).where(
          and(
            eq(alerts.id, input.alertId),
            eq(alerts.userId, ctx.userId)
          )
        );

        if (result.rowsAffected === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
        }

        return { success: true, alertId: input.alertId };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Error deleting alert:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to delete alert",
        });
      }
    }),

  // Update an alert
  updateAlert: protectedProcedure
    .input(z.object({
      alertId: z.string().uuid(),
      target: z.number().positive().optional(),
      condition: z.enum(["above", "below", "crosses_above", "crosses_below"]).optional(),
      message: z.string().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      try {
        const updateData: any = {
          updatedAt: new Date(),
        };

        if (input.target !== undefined) updateData.target = input.target;
        if (input.condition !== undefined) updateData.condition = input.condition;
        if (input.message !== undefined) updateData.message = input.message;

        const result = await db.update(alerts)
          .set(updateData)
          .where(and(eq(alerts.id, input.alertId), eq(alerts.userId, ctx.userId)))
          .returning();

        if (result.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Alert not found",
          });
        }

        return { success: true, alert: result[0] };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Error updating alert:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to update alert",
        });
      }
    }),
});