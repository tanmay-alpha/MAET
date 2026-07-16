import { defineEventHandler } from "h3";
import { db } from "../../data/drizzle/client";
import { paperAccounts } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../trpc/auth";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    let [account] = await db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, auth.userId))
      .limit(1);

    if (!account) {
      // Auto-create account with ₹1,000,000 cash
      const inserted = await db
        .insert(paperAccounts)
        .values({
          userId: auth.userId,
          cashBalance: "1000000.0000",
          allocatedMargin: "0.0000",
          maintenanceMargin: "0.0000",
          leverageFactor: 5,
        })
        .returning();
      account = inserted[0];
    }

    return {
      cashBalance: Number(account.cashBalance),
      allocatedMargin: Number(account.allocatedMargin),
      maintenanceMargin: Number(account.maintenanceMargin),
      leverageFactor: account.leverageFactor,
      isLocked: account.isLocked,
      createdAt: account.createdAt,
      updatedAt: account.updatedAt,
    };
  } catch (error: any) {
    console.error("[api/paper/account.get] Error:", error);
    throw error;
  }
});
