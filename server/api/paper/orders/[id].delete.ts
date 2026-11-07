import { defineEventHandler, getRouterParam, createError } from "h3";
import { z } from "zod";
import { requireAuth } from "../../trpc/auth";
import { createPaperTradingService } from "../../../modules/paper-trading/service";
import { toPaperHttpError } from "../orders.post";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const orderId = getRouterParam(event, "id");

    if (!orderId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Missing order ID parameter",
      });
    }
    if (!z.string().uuid().safeParse(orderId).success) {
      throw createError({
        statusCode: 400,
        statusMessage: "Invalid order ID parameter",
      });
    }

    const service = createPaperTradingService();
    const cancelledOrder = await service.cancelOrder({ userId: auth.userId, orderId });

    return {
      success: true,
      order: {
        ...cancelledOrder,
        qty: Number(cancelledOrder.qty),
        quantity: Number(cancelledOrder.qty),
        limitPrice: cancelledOrder.limitPrice ? Number(cancelledOrder.limitPrice) : undefined,
        stopPrice: cancelledOrder.stopPrice ? Number(cancelledOrder.stopPrice) : undefined,
      },
    };
  } catch (error: unknown) {
    throw toPaperHttpError(error);
  }
});
