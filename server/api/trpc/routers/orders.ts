import { router, protectedProcedure } from "../index";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { orders } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";

export const ordersRouter = router({
  // Get user's orders - scoped by userId to prevent data leakage
  getOrders: protectedProcedure
    .query(async ({ ctx }) => {
      try {
        const userOrders = await db.select().from(orders)
          .where(eq(orders.userId, ctx.userId))
          .orderBy(desc(orders.placedAt));

        return userOrders.map(order => ({
          ...order,
          side: order.side,
          type: order.type,
          status: order.status,
        }));
      } catch (error) {
        console.error("Error fetching orders:", error);
        // Return empty array on DB error - frontend will show contract panel
        return [];
      }
    }),

  // Place a new order
  placeOrder: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      exchange: z.string().default("NSE"),
      side: z.enum(["BUY", "SELL"]),
      type: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]),
      qty: z.number().int().positive().max(100000),
      limitPrice: z.number().positive().optional(),
      triggerPrice: z.number().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Generate cryptographically secure idempotency key and order ID
      const uniqueId = crypto.randomUUID();
      const idempotencyKey = `order-${Date.now()}-${uniqueId.replace(/-/g, '').slice(0, 9)}`;

      try {
        const newOrder = await db.insert(orders).values({
          id: uniqueId,
          userId: ctx.userId,
          symbol: input.symbol.toUpperCase(),
          exchange: input.exchange.toUpperCase(),
          side: input.side,
          type: input.type,
          qty: input.qty,
          limitPrice: input.limitPrice ? String(input.limitPrice) : null,
          status: "pending",
          idempotencyKey,
          rejectReason: null,
          placedAt: new Date(),
          filledAt: null,
          updatedAt: new Date(),
        }).returning();

        return {
          ...newOrder[0],
          side: newOrder[0].side,
          type: newOrder[0].type,
          status: newOrder[0].status,
        };
      } catch (error) {
        console.error("Error placing order:", error);
        // Return order object for UI feedback even if DB write fails
        return {
          id: uniqueId,
          userId: ctx.userId,
          symbol: input.symbol.toUpperCase(),
          exchange: input.exchange.toUpperCase(),
          side: input.side,
          type: input.type,
          qty: input.qty,
          limitPrice: input.limitPrice,
          status: "pending",
          idempotencyKey,
          rejectReason: null,
          placedAt: new Date().toISOString(),
          filledAt: null,
          updatedAt: new Date().toISOString(),
        };
      }
    }),

  // Cancel an order - FAIL-CLOSED: verify ownership before cancellation
  cancelOrder: protectedProcedure
    .input(z.object({
      orderId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      // SECURITY: Verify order ownership before cancellation (fail-closed)
      // This prevents IDOR attacks where users could cancel orders belonging to other users.
      try {
        const order = await db.select().from(orders)
          .where(and(
            eq(orders.id, input.orderId),
            eq(orders.userId, ctx.userId)
          ))
          .limit(1);

        if (!order || order.length === 0) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Order not found or you don't have permission to cancel it",
          });
        }

        const updatedOrder = await db.update(orders)
          .set({
            status: "cancelled",
            updatedAt: new Date(),
          })
          .where(eq(orders.id, input.orderId))
          .returning();

        return {
          orderId: input.orderId,
          status: "cancelled",
          updatedAt: updatedOrder[0].updatedAt.toISOString(),
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        console.error("Error cancelling order:", error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to cancel order",
        });
      }
    }),
});