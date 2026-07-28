import { defineEventHandler, getRouterParam } from "h3";
import { requireAuth } from "../../trpc/auth";
import { createPaperTradingService } from "../../../modules/paper-trading/service";
import { toPaperHttpError } from "../orders.post";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const orderId = getRouterParam(event, "id");

    if (!orderId) {
      throw new Error("Missing order ID parameter");
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
