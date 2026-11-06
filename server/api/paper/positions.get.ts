import { defineEventHandler } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";
import { signedPositionQuantity } from "../../modules/paper-trading/mapper";
import { toPaperHttpError } from "./orders.post";

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const state = await createPaperTradingService().getState({ userId: auth.userId });

    return {
      positions: state.positions.map((position) => ({
        ...position,
        quantity: signedPositionQuantity(position),
      })),
    };
  } catch (error: unknown) {
    throw toPaperHttpError(error);
  }
});
