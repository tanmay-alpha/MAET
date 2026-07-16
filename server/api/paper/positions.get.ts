import { defineEventHandler } from "h3";
import { db } from "../../data/drizzle/client";
import { paperPositions } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../trpc/auth";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const positions = await db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.userId, auth.userId));

    return { positions };
  } catch (error: any) {
    console.error("[api/paper/positions.get] Error:", error);
    throw error;
  }
});
