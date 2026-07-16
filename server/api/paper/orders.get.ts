import { defineEventHandler } from "h3";
import { db } from "../../data/drizzle/client";
import { paperOrders } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { requireAuth } from "../trpc/auth";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const orders = await db
      .select()
      .from(paperOrders)
      .where(eq(paperOrders.userId, auth.userId))
      .orderBy(desc(paperOrders.placedAt))
      .limit(100);

    return { orders };
  } catch (error: any) {
    console.error("[api/paper/orders.get] Error:", error);
    throw error;
  }
});
