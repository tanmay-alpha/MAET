import { defineEventHandler } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";
import { toPaperHttpError } from "./orders.post";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const { orders } = await createPaperTradingService().listOrders({ userId: auth.userId, limit: 100 });
    return { orders };
  } catch (error: unknown) {
    throw toPaperHttpError(error);
  }
});
