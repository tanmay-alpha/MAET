/**
 * Screener tRPC Router
 * Stock screening and filtering operations
 */

import { router, protectedProcedure } from "../index";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../data/drizzle/client";
import { candles } from "../../data/drizzle/schema";
import { desc, sql, and, or, gte, lte, eq, gt, lt } from "drizzle-orm";

// Whitelist of allowed filter fields to prevent SQL injection
const ALLOWED_FILTER_FIELDS = [
  'volume',
  'symbol',
  'timeframe',
  'source'
] as const;

type AllowedFilterField = typeof ALLOWED_FILTER_FIELDS[number];

// Validate filter field against whitelist
function validateFilterField(field: string): AllowedFilterField {
  if (!ALLOWED_FILTER_FIELDS.includes(field as AllowedFilterField)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Invalid filter field: ${field}. Allowed fields: ${ALLOWED_FILTER_FIELDS.join(', ')}`,
    });
  }
  return field as AllowedFilterField;
}

// Map field names to column references (safe, not raw SQL)
const FIELD_MAP = {
  volume: candles.volume,
  symbol: candles.symbol,
  timeframe: candles.timeframe,
  source: candles.source,
} as const;

export const screenerRouter = router({
  // Run a stock screen with filters
  runScreen: protectedProcedure
    .input(z.object({
      filters: z.array(z.object({
        field: z.enum(ALLOWED_FILTER_FIELDS),
        operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between"]),
        value: z.union([z.number(), z.array(z.number())]),
      })),
      sortBy: z.enum(ALLOWED_FILTER_FIELDS).optional(),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().int().positive().max(500).default(50),
    }))
    .query(async ({ input }) => {
      try {
        // Start with base query
        let query = db.select().from(candles);

        // Apply filters safely using whitelisted fields
        for (const filter of input.filters) {
          const field = validateFilterField(filter.field);
          const column = FIELD_MAP[field];

          switch (filter.operator) {
            case "gt":
              query = query.where(gt(column, filter.value as number));
              break;
            case "gte":
              query = query.where(gte(column, filter.value as number));
              break;
            case "lt":
              query = query.where(lt(column, filter.value as number));
              break;
            case "lte":
              query = query.where(lte(column, filter.value as number));
              break;
            case "eq":
              query = query.where(eq(column, filter.value as number));
              break;
            case "between":
              if (Array.isArray(filter.value) && filter.value.length === 2) {
                query = query.where(
                  and(
                    gte(column, filter.value[0]),
                    lte(column, filter.value[1])
                  )
                );
              }
              break;
          }
        }

        // Apply sorting
        if (input.sortBy) {
          const sortField = validateFilterField(input.sortBy);
          const sortColumn = FIELD_MAP[sortField];
          query = input.sortOrder === "desc"
            ? query.orderBy(desc(sortColumn))
            : query.orderBy(sortColumn);
        }

        // Apply limit
        query = query.limit(input.limit);

        const results = await query;

        return results.map(row => ({
          symbol: row.symbol,
          timeframe: row.timeframe,
          ts: row.ts,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          source: row.source,
        }));
      } catch (error) {
        console.error("Error running screener:", error);
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to run screener",
        });
      }
    }),

  // Get saved screeners
  getScreeners: protectedProcedure
    .query(async ({ ctx }) => {
      // TODO: Create screeners table in schema and wire here
      // For now, return empty array
      return [];
    }),

  // Save a screener
  saveScreener: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      filters: z.array(z.object({
        field: z.enum(ALLOWED_FILTER_FIELDS),
        operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between"]),
        value: z.union([z.number(), z.array(z.number())]),
      })),
    }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Create screeners table in schema and wire here
      // For now, return success response
      return {
        id: crypto.randomUUID(),
        userId: ctx.userId,
        name: input.name,
        filters: input.filters,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }),

  // Delete a screener
  deleteScreener: protectedProcedure
    .input(z.object({
      screenerId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      // TODO: Create screeners table and wire deletion with ownership check
      return { success: true, screenerId: input.screenerId };
    }),
});