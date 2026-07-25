import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import {
  createPaperTradingService,
  PaperTradingService,
} from "../../../modules/paper-trading/service";
import { PaperTradingError } from "../../../modules/paper-trading/errors";

const PLACE_MARKET_ORDER = z.object({
  type: z.literal("MARKET"),
  clientOrderId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  symbol: z.string().min(1).max(32),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().int(),
  stopLossPrice: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
  trailingDistance: z.number().positive().optional(),
  trailingIsPercent: z.boolean().optional(),
});

const PLACE_LIMIT_ORDER = z.object({
  type: z.literal("LIMIT"),
  clientOrderId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  symbol: z.string().min(1).max(32),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().int(),
  limitPrice: z.number().positive(),
  stopLossPrice: z.number().positive().optional(),
  takeProfitPrice: z.number().positive().optional(),
});

const PLACE_STOP_LOSS_LIMIT_ORDER = z.object({
  type: z.literal("STOP_LOSS_LIMIT"),
  clientOrderId: z.string().optional(),
  idempotencyKey: z.string().min(1).max(128).optional(),
  symbol: z.string().min(1).max(32),
  exchange: z.enum(["NSE", "BSE"]).default("NSE"),
  side: z.enum(["BUY", "SELL"]),
  quantity: z.number().positive().int(),
  stopPrice: z.number().positive(),
  limitPrice: z.number().positive(),
});

const PLACE_ORDER_COMMAND = z.discriminatedUnion("type", [
  PLACE_MARKET_ORDER,
  PLACE_LIMIT_ORDER,
  PLACE_STOP_LOSS_LIMIT_ORDER,
]);

const defaultService = createPaperTradingService();

export function createPaperTradingRouter(service: PaperTradingService = defaultService) {
  return createRouter({
    getState: protectedProcedure.query(async ({ ctx }) => {
      const userId = ctx.userId;
      if (!userId) {
        throw new TRPCError({ code: "UNAUTHORIZED" });
      }
      return service.getState({ userId });
    }),

    placeOrder: protectedProcedure
      .input(PLACE_ORDER_COMMAND)
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        try {
          const command = {
            ...input,
            qty: input.quantity,
          };
          return await service.placeOrder({ userId, command });
        } catch (error) {
          if (error instanceof PaperTradingError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              cause: error,
              message: error.message,
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to place order",
          });
        }
      }),

    cancelOrder: protectedProcedure
      .input(z.object({ orderId: z.string() }))
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        try {
          await service.cancelOrder({ userId, orderId: input.orderId });
          return { success: true };
        } catch (error) {
          if (error instanceof PaperTradingError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              cause: error,
              message: error.message,
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to cancel order",
          });
        }
      }),

    resetAccount: protectedProcedure
      .input(z.object({ confirmation: z.boolean().default(true) }).optional())
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        try {
          return await service.resetAccount({
            userId,
            confirmation: input?.confirmation ?? true,
          });
        } catch (error) {
          if (error instanceof PaperTradingError) {
            throw new TRPCError({
              code: "BAD_REQUEST",
              cause: error,
              message: error.message,
            });
          }
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: "Failed to reset account",
          });
        }
      }),

    listOrders: protectedProcedure
      .input(
        z.object({
          generation: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(100).default(50),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return service.listOrders({
          userId,
          generation: input.generation,
          limit: input.limit,
          cursor: input.cursor,
        });
      }),

    listFills: protectedProcedure
      .input(
        z.object({
          generation: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(100).default(50),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return service.listFills({
          userId,
          generation: input.generation,
          limit: input.limit,
          cursor: input.cursor,
        });
      }),

    listLedger: protectedProcedure
      .input(
        z.object({
          generation: z.number().int().positive().optional(),
          limit: z.number().int().positive().max(200).default(100),
          cursor: z.string().optional(),
        })
      )
      .query(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        return service.listLedger({
          userId,
          generation: input.generation,
          limit: input.limit,
          cursor: input.cursor,
        });
      }),
  });
}

export const paperTradingRouter = createPaperTradingRouter();
