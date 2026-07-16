import { defineEventHandler, readBody, createError } from "h3";
import { db } from "../../data/drizzle/client";
import { paperOrders, paperAccounts } from "../../db/schema";
import { eq } from "drizzle-orm";
import { requireAuth } from "../trpc/auth";
import { onTick } from "../../domain/market/matcher";
import { loadQuotes } from "../../domain/market/quote-service";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const body = await readBody(event);

    const symbol = String(body.symbol).toUpperCase();
    const side = String(body.side) as "BUY" | "SELL";
    const type = String(body.type) as "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT";
    const qty = Number(body.qty);
    const limitPrice = body.limitPrice ? String(body.limitPrice) : null;
    const stopPrice = body.stopPrice ? String(body.stopPrice) : null;
    const stopLossPrice = body.stopLossPrice ? String(body.stopLossPrice) : null;
    const takeProfitPrice = body.takeProfitPrice ? String(body.takeProfitPrice) : null;
    const trailingDistance = body.trailingDistance ? String(body.trailingDistance) : null;
    const isTrailingPercent = body.isTrailingPercent === true;

    if (!symbol || !side || !type || qty <= 0) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid order parameters",
      });
    }

    // Locked Account Check
    const [account] = await db
      .select()
      .from(paperAccounts)
      .where(eq(paperAccounts.userId, auth.userId))
      .limit(1);

    if (account && (account.isLocked || Number(account.cashBalance) <= 0)) {
      throw createError({
        statusCode: 403,
        statusMessage: "Your paper account is locked due to margin call liquidation or negative balance.",
      });
    }

    // Load price
    const quoteRes = await loadQuotes([symbol]);
    const quote = quoteRes.quotes[0];
    if (!quote) {
      throw createError({
        statusCode: 502,
        statusMessage: "Market price currently unavailable for this symbol",
      });
    }

    const status = type === "MARKET" ? "PENDING" : type === "STOP_LOSS_LIMIT" ? "TRIGGER_PENDING" : "PENDING";

    const inserted = await db
      .insert(paperOrders)
      .values({
        id: crypto.randomUUID(),
        userId: auth.userId,
        symbol,
        exchange: "NSE",
        side,
        type,
        status,
        qty,
        limitPrice,
        stopPrice,
        stopLossPrice,
        takeProfitPrice,
        trailingDistance,
        isTrailingPercent,
        placedAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    const order = inserted[0];

    // If MARKET order, run immediate matching tick execution
    if (type === "MARKET") {
      const price = quote.price;
      await onTick(symbol, price, price, price, 1000);
    }

    return { success: true, order };
  } catch (error: any) {
    console.error("[api/paper/orders.post] Error:", error);
    throw error;
  }
});
