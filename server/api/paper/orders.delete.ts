import { defineEventHandler, getQuery, createError } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";
import { toPaperHttpError } from "./orders.post";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const query = getQuery(event);
    const pathParts = event.path ? event.path.split("?")[0].split("/").filter(Boolean) : [];
    const lastPathPart = pathParts.pop();

    const orderId =
      query.id ? String(query.id) :
      lastPathPart && lastPathPart !== "orders" ? lastPathPart : null;

    if (!orderId) {
      throw createError({
        statusCode: 400,
        statusMessage: "Missing order ID",
      });
    }

    const service = createPaperTradingService();
    const cancelledOrder = await service.cancelOrder({ userId: auth.userId, orderId });

    return { success: true, order: cancelledOrder };
  } catch (error: unknown) {
    throw toPaperHttpError(error);
  }
});
