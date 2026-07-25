import { defineEventHandler, readBody, createError } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";
import { PaperTradingError } from "../../modules/paper-trading/errors";

const service = createPaperTradingService();

export default defineEventHandler(async (event) => {
  const auth = await requireAuth(event);
  const body = await readBody(event);

  try {
    const qty = Number(body.quantity || body.qty);
    const command = {
      symbol: String(body.symbol || ""),
      exchange: body.exchange ? String(body.exchange) : "NSE",
      side: body.side as "BUY" | "SELL",
      type: body.type as "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT",
      qty,
      limitPrice: body.limitPrice ? Number(body.limitPrice) : undefined,
      stopPrice: body.stopPrice ? Number(body.stopPrice) : undefined,
      stopLossPrice: body.stopLossPrice ? Number(body.stopLossPrice) : undefined,
      takeProfitPrice: body.takeProfitPrice ? Number(body.takeProfitPrice) : undefined,
      clientOrderId: body.clientOrderId ? String(body.clientOrderId) : undefined,
      idempotencyKey: body.idempotencyKey ? String(body.idempotencyKey) : undefined,
    };

    const result = await service.placeOrder({
      userId: auth.userId,
      command,
    });

    return {
      success: true,
      order: result.order,
      fill: result.fill,
      account: result.account,
      position: result.position,
      idempotentReplay: result.idempotentReplay,
      asOf: result.asOf.toISOString(),
    };
  } catch (error: unknown) {
    if (error instanceof PaperTradingError) {
      throw createError({
        statusCode: 400,
        statusMessage: error.message,
        data: { code: error.code, details: error.details },
      });
    }
    throw error;
  }
});
