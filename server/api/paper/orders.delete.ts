import { defineEventHandler, getQuery, createError } from "h3";
import { db } from "../../data/drizzle/client";
import { paperOrders } from "../../db/schema";
import { eq, and, or } from "drizzle-orm";
import { requireAuth } from "../trpc/auth";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const query = getQuery(event);
    const orderId = query.id ? String(query.id) : null;

    if (!orderId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Missing order ID parameter 'id'",
      });
    }

    const updated = await db
      .update(paperOrders)
      .set({ status: "CANCELLED", updatedAt: new Date() })
      .where(
        and(
          eq(paperOrders.id, orderId),
          eq(paperOrders.userId, auth.userId),
          or(
            eq(paperOrders.status, "PENDING"),
            eq(paperOrders.status, "TRIGGER_PENDING"),
            eq(paperOrders.status, "PARTIALLY_FILLED")
          )
        )
      )
      .returning();

    if (updated.length === 0) {
      throw createError({
        statusCode: 404,
        statusMessage: "Order not found or cannot be cancelled",
      });
    }

    return { success: true, order: updated[0] };
  } catch (error: any) {
    console.error("[api/paper/orders.delete] Error:", error);
    throw error;
  }
});
