/**
 * Alerts tRPC Router
 * CRUD operations for price alerts, volume alerts, and indicator alerts
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { alerts } from "../../../db/schema";
import { eq, and, sql } from "drizzle-orm";

export const alertsRouter = createRouter({
  // Get all alerts for the current user with pagination and limits
  getAlerts: protectedProcedure
    .input(z.object({
      limit: z.number().int().positive().max(200).default(50),
      cursor: z.string().uuid().optional(),
    }).optional())
    .query(async ({ input, ctx }) => {
      const { limit = 50, cursor } = input ?? {};
      const conditions = [eq(alerts.userId, ctx.userId)];
      if (cursor) {
        conditions.push(sql`${alerts.id} > ${cursor}`);
      }

      const rows = await db.select().from(alerts)
        .where(and(...conditions))
        .orderBy(alerts.id)
        .limit(limit + 1);

      const hasMore = rows.length > limit;
      const items = hasMore ? rows.slice(0, -1) : rows;

      return {
        items,
        nextCursor: hasMore ? items[items.length - 1]?.id : null,
      };
    }),

  // Create a new alert — bounded to max 100 active alerts of the same type
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
      // Query active count first
      const [countResult] = await db
        .select({ count: sql<number>`count(*)` })
        .from(alerts)
        .where(
          and(
            eq(alerts.userId, ctx.userId),
            eq(alerts.type, input.type),
            eq(alerts.triggered, false),
          ),
        );

      const activeCount = Number(countResult?.count ?? 0);
      if (activeCount >= 100) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `You cannot have more than 100 active ${input.type} alerts.`,
        });
      }

      const newAlert = await db.insert(alerts).values({
        id: crypto.randomUUID(),
        userId: ctx.userId,
        symbol: input.symbol.toUpperCase(),
        exchange: input.exchange.toUpperCase(),
        type: input.type,
        condition: input.condition,
        target: String(input.target),
        message: input.message || null,
        triggered: false,
        triggeredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }).returning();

      return newAlert[0];
    }),

  // Delete an alert
  deleteAlert: protectedProcedure
    .input(z.object({
      alertId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const result = await db.delete(alerts).where(
        and(
          eq(alerts.id, input.alertId),
          eq(alerts.userId, ctx.userId)
        )
      ).returning();

      if (result.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Alert not found",
        });
      }

      return { success: true, alertId: input.alertId };
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
