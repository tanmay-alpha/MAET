import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { protectedProcedure, createRouter } from "../core";
import {
  getLatestPersistedOptionChain,
  listPersistedOptionExpiries,
  normalizePersistedOptionExpiryDate,
  normalizePersistedOptionUnderlying,
} from "../../../modules/options/read-model";

function normalizeUnderlyingInput(underlying: string): string {
  try {
    return normalizePersistedOptionUnderlying(underlying);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Option-chain underlying is invalid";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

function normalizeChainInput(input: { underlying: string; expiryDate: string }) {
  const underlying = normalizeUnderlyingInput(input.underlying);
  try {
    return {
      underlying,
      expiryDate: normalizePersistedOptionExpiryDate(input.expiryDate),
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Option-chain expiryDate is invalid";
    throw new TRPCError({ code: "BAD_REQUEST", message });
  }
}

export const optionsRouter = createRouter({
  listExpiries: protectedProcedure
    .input(z.object({ underlying: z.string().max(32) }))
    .query(async ({ input }) => listPersistedOptionExpiries({
      underlying: normalizeUnderlyingInput(input.underlying),
    })),

  getLatestChain: protectedProcedure
    .input(z.object({
      underlying: z.string().max(32),
      expiryDate: z.string().max(10),
    }))
    .query(async ({ input }) => getLatestPersistedOptionChain(normalizeChainInput(input))),
});
