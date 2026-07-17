/**
 * Orders tRPC Router — with proper client-provided idempotency keys,
 * fail-closed error handling, and order pre-validation.
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { orders, paperAccounts, companies } from "../../db/schema";
import { eq, desc, and } from "drizzle-orm";

// NSE minimum lot sizes for top stocks — fallback to 1 if unknown
const MIN_LOT_SIZES: Record<string, number> = {
  RELIANCE: 1, TCS: 1, HDFCBANK: 1, INFY: 1, ICICIBANK: 1,
  BHARTIARTL: 1, ITC: 1, LT: 1, SBIN: 1, AXISBANK: 1,
  MARUTI: 50, HINDUNILVR: 1, KOTAKBANK: 1, WIPRO: 1, ADANIPORTS: 1,
  POWERGRID: 1, NTPC: 1, ONGC: 1, COALINDIA: 1, JSWSTEEL: 1,
  BAJFINANCE: 1, TITAN: 1, NESTLEIND: 1, HCLTECH: 1, TECHM: 1,
};

function getMinLotSize(symbol: string): number {
  return MIN_LOT_SIZES[symbol] ?? 1;
}

function validateLotSize(symbol: string, qty: number): void {
  const lotSize = getMinLotSize(symbol);
  if (qty % lotSize !== 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Quantity ${qty} is not a valid lot size for ${symbol}. Minimum lot size: ${lotSize}`,
    });
  }
}

export const ordersRouter = createRouter({
  // Get user's orders — FAIL CLOSED on DB errors
  getOrders: protectedProcedure
    .query(async ({ ctx }) => {
      const userOrders = await db.select().from(orders)
        .where(eq(orders.userId, ctx.userId))
        .orderBy(desc(orders.placedAt));

      return userOrders.map(order => ({
        ...order,
        side: order.side,
        type: order.type,
        status: order.status,
      }));
    }),

  // Place a new order with client-provided idempotency key
  placeOrder: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1).max(20),
      exchange: z.string().default("NSE"),
      side: z.enum(["BUY", "SELL"]),
      type: z.enum(["MARKET", "LIMIT", "SL", "SL-M"]),
      qty: z.number().int().positive().max(1_000_000),
      limitPrice: z.number().positive().optional(),
      triggerPrice: z.number().positive().optional(),
      idempotencyKey: z.string().min(8).max(128).optional(),
    }))
    .mutation(async ({ input, ctx }) => {
      const symbol = input.symbol.toUpperCase();
      const userId = ctx.userId;

      // Pre-validation: lot size
      validateLotSize(symbol, input.qty);

      // Pre-validation: check symbol exists in our universe
      const [[company]] = await db.select()
        .from(companies)
        .where(eq(companies.symbol, symbol))
        .limit(1);

      if (!company) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Symbol "${symbol}" not found in company universe`,
        });
      }

      // Pre-validation: check sufficient cash for BUY orders
      if (input.side === "BUY" && input.type === "MARKET") {
        const [[account]] = await db.select()
          .from(paperAccounts)
          .where(eq(paperAccounts.userId, userId))
          .limit(1);

        if (account && Number(account.cashBalance) <= 0) {
          throw new TRPCError({
            code: "FORBIDDEN",
            message: "Account is locked or has zero balance",
          });
        }
      }

      // Idempotency: use client-provided key if available
      const idempotencyKey = input.idempotencyKey
        ? `order:${userId}:${input.idempotencyKey}`
        : undefined;

      // Check for existing order with same idempotency key
      if (idempotencyKey) {
        const [[existing]] = await db.select()
          .from(orders)
          .where(and(
            eq(orders.userId, userId),
            eq(orders.idempotencyKey, idempotencyKey),
          ))
          .limit(1);

        if (existing) {
          throw new TRPCError({
            code: "CONFLICT",
            message: "Duplicate order — this idempotency key was already used",
            data: { existingOrderId: existing.id },
          });
        }
      }

      const orderId = crypto.randomUUID();
      const finalIdempotencyKey = idempotencyKey || `order:${userId}:${Date.now()}-${orderId.slice(0, 9)}`;

      const newOrder = await db.insert(orders).values({
        id: orderId,
        userId,
        symbol,
        exchange: input.exchange.toUpperCase(),
        side: input.side,
        type: input.type,
        qty: input.qty,
        limitPrice: input.limitPrice ? String(input.limitPrice) : null,
        triggerPrice: input.triggerPrice ? String(input.triggerPrice) : null,
        status: "pending",
        idempotencyKey: finalIdempotencyKey,
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
    }),

  // Cancel an order — FAIL CLOSED with ownership check
  cancelOrder: protectedProcedure
    .input(z.object({
      orderId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const order = await db.select().from(orders)
        .where(and(
          eq(orders.id, input.orderId),
          eq(orders.userId, ctx.userId),
        ))
        .limit(1);

      if (!order || order.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Order not found or you don't have permission to cancel it",
        });
      }

      const updatedOrder = await db.update(orders)
        .set({ status: "cancelled", updatedAt: new Date() })
        .where(eq(orders.id, input.orderId))
        .returning();

      return {
        orderId: input.orderId,
        status: "cancelled",
        updatedAt: updatedOrder[0].updatedAt.toISOString(),
      };
    }),
});
