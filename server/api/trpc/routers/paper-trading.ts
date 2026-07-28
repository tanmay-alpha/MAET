import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createRouter, protectedProcedure } from "../core";
import {
  createPaperTradingService,
  PaperTradingService,
} from "../../../modules/paper-trading/service";
import { PaperTradingError } from "../../../modules/paper-trading/errors";
import {
  PaperOrderCommandSchema,
  PaperOrderCommand,
} from "../../../modules/paper-trading/contracts";

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
      .input(PaperOrderCommandSchema)
      .mutation(async ({ ctx, input }) => {
        const userId = ctx.userId;
        if (!userId) {
          throw new TRPCError({ code: "UNAUTHORIZED" });
        }
        try {
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
