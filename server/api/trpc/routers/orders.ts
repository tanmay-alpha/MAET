import { router, protectedProcedure } from "../index";
import { z } from "zod";
import { TRPCError } from "@trpc/server";

export const ordersRouter = router({
  // Get user's orders
  getOrders: protectedProcedure
    .query(async ({ ctx }) => {
      // Mock data - would come from database
      const mockOrders = [
        {
          id: "1",
          userId: ctx.userId,
          symbol: "RELIANCE",
          exchange: "NSE",
          side: "BUY",
          type: "LIMIT",
          qty: 10,
          limitPrice: 2500,
          status: "pending",
          idempotencyKey: "unique-key-1",
          rejectReason: null,
          placedAt: new Date().toISOString(),
          filledAt: null,
          updatedAt: new Date().toISOString(),
        }
      ];

      return mockOrders;
    }),

  // Place a new order
  placeOrder: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      exchange: z.string().default("NSE"),
      side: z.enum(["BUY", "SELL"]),
      type: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]),
      qty: z.number().int().positive().max,
      limitPrice: z.number().positive().optional(),
      triggerPrice: z.number().positive().optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      // Generate cryptographically secure idempotency key and order ID
      const uniqueId = crypto.randomUUID();
      const idempotencyKey = `order-${Date.now()}-${uniqueId.replace(/-/g, '').slice(0, 9)}`;

      // Mock order creation
      const newOrder = {
        id: uniqueId,
        userId: ctx.userId,
        symbol: input.symbol,
        exchange: input.exchange,
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

      return newOrder;
    }),

  // Cancel an order
  cancelOrder: protectedProcedure
    .input(z.object({
      orderId: z.string(),
    }))
    .mutation(async ({ input, ctx }) => {
      // SECURITY: Verify order ownership before cancellation
      // This prevents IDOR attacks where users could cancel orders belonging to other users
      // In production with database:
      // const order = await db.orders.findUnique({ where: { id: input.orderId } });
      // if (!order || order.userId !== ctx.userId) {
      //   throw new TRPCError({ code: "NOT_FOUND", message: "Order not found" });
      // }

      // Mock cancellation with ownership check
      // For now we simulate the check - in production this would query the database
      const mockOrderOwnershipCheck = true; // In production: order.userId === ctx.userId

      if (!mockOrderOwnershipCheck) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found",
        });
      }

      return {
        orderId: input.orderId,
        status: "cancelled",
        updatedAt: new Date().toISOString(),
      };
    }),
});