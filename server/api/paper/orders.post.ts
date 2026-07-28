import { defineEventHandler, readBody, createError, H3Error } from "h3";
import { requireAuth } from "../trpc/auth";
import { createPaperTradingService } from "../../modules/paper-trading/service";
import {
  PaperValidationError,
  PaperQuoteRejectedError,
  PaperInsufficientMarginError,
  PaperAccountLockedError,
  PaperOrderNotFoundError,
  PaperIdempotencyConflictError,
  PaperAuthenticationError,
  PaperOrderConflictError,
} from "../../modules/paper-trading/errors";
import {
  PaperOrderCommandSchema,
  PaperOrderCommand,
} from "../../modules/paper-trading/contracts";

const service = createPaperTradingService();

export function toPaperHttpError(error: unknown): H3Error {
  if (error instanceof PaperValidationError) {
    return createError({
      statusCode: 400,
      statusMessage: error.message,
      data: { code: error.code },
      cause: error,
    });
  }
  if (error instanceof PaperAuthenticationError) {
    return createError({
      statusCode: 401,
      statusMessage: error.message,
      data: { code: error.code },
      cause: error,
    });
  }
  if (error instanceof PaperOrderNotFoundError) {
    return createError({
      statusCode: 404,
      statusMessage: error.message,
      data: { code: error.code },
      cause: error,
    });
  }
  if (
    error instanceof PaperQuoteRejectedError ||
    error instanceof PaperInsufficientMarginError ||
    error instanceof PaperIdempotencyConflictError ||
    error instanceof PaperOrderConflictError
  ) {
    return createError({
      statusCode: 409,
      statusMessage: error.message,
      data: { code: error.code },
      cause: error,
    });
  }
  if (error instanceof PaperAccountLockedError) {
    return createError({
      statusCode: 423,
      statusMessage: error.message,
      data: { code: error.code },
      cause: error,
    });
  }
  return createError({
    statusCode: 500,
    statusMessage: "Paper trading request failed",
    data: { code: "INTERNAL_ERROR" },
    cause: error,
  });
}

export default defineEventHandler(async (event) => {
  try {
    const auth = await requireAuth(event);
    const body = await readBody(event);

    const parseResult = PaperOrderCommandSchema.safeParse(body);
    if (!parseResult.success) {
      const issueMsg = parseResult.error.issues.map((i) => i.message).join("; ");
      throw new PaperValidationError(`Invalid order command: ${issueMsg}`, parseResult.error.flatten());
    }
    const input = parseResult.data;

    const command: PaperOrderCommand = {
      type: input.type,
      symbol: input.symbol,
      exchange: input.exchange,
      side: input.side,
      qty: input.quantity,
      limitPrice: "limitPrice" in input ? input.limitPrice : undefined,
      stopPrice: "stopPrice" in input ? input.stopPrice : undefined,
      stopLossPrice: "stopLossPrice" in input ? input.stopLossPrice : undefined,
      takeProfitPrice: "takeProfitPrice" in input ? input.takeProfitPrice : undefined,
      trailingDistance: "trailingDistance" in input ? input.trailingDistance : undefined,
      trailingIsPercent: "trailingIsPercent" in input ? input.trailingIsPercent : undefined,
      clientOrderId: input.clientOrderId,
      idempotencyKey: input.idempotencyKey,
    };

    const result = await service.placeOrder({
      userId: auth.userId,
      command,
    });

    return {
      success: true,
      order: {
        ...result.order,
        qty: Number(result.order.qty),
        quantity: Number(result.order.qty),
        limitPrice: result.order.limitPrice ? Number(result.order.limitPrice) : undefined,
        stopPrice: result.order.stopPrice ? Number(result.order.stopPrice) : undefined,
      },
      fill: result.fill
        ? {
            ...result.fill,
            qty: Number(result.fill.quantity),
            quantity: Number(result.fill.quantity),
            fillPrice: Number(result.fill.fillPrice),
          }
        : null,
      account: {
        ...result.account,
        cashBalance: Number(result.account.cashBalance),
        allocatedMargin: Number(result.account.allocatedMargin),
      },
      position: result.position
        ? {
            ...result.position,
            quantity: Number(result.position.totalShares),
            averagePrice: Number(result.position.averageEntryPrice),
          }
        : null,
      idempotentReplay: result.idempotentReplay,
      asOf: result.asOf.toISOString(),
    };
  } catch (error: unknown) {
    throw toPaperHttpError(error);
  }
});
