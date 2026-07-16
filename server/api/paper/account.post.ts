import { defineEventHandler } from "h3";
import { db } from "../../data/drizzle/client";
import { paperAccounts, paperOrders, paperPositions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../trpc/auth";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);

    await db.transaction(async (tx) => {
      // Delete positions
      await tx.delete(paperPositions).where(eq(paperPositions.userId, auth.userId));
      // Cancel pending orders
      await tx.delete(paperOrders).where(eq(paperOrders.userId, auth.userId));
      // Reset account state
      await tx
        .insert(paperAccounts)
        .values({
          userId: auth.userId,
          cashBalance: "1000000.0000",
          allocatedMargin: "0.0000",
          maintenanceMargin: "0.0000",
          leverageFactor: 5,
          isLocked: false,
          updatedAt: new Date(),
        })
        .onConflictDoUpdate({
          target: [paperAccounts.userId],
          set: {
            cashBalance: "1000000.0000",
            allocatedMargin: "0.0000",
            maintenanceMargin: "0.0000",
            isLocked: false,
            updatedAt: new Date(),
          },
        });
    });

    return { success: true, message: "Account reset successfully" };
  } catch (error: any) {
    console.error("[api/paper/account.post] Error:", error);
    throw error;
  }
});
