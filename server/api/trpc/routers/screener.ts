/**
 * Screener tRPC Router
 * Enhanced stock screening with fundamental and technical indicators
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { candles, screenerRuns, users } from "../../../db/schema";
import { desc, sql, and, or, gte, lte, eq, gt, lt, ilike, like } from "drizzle-orm";
import { calculateAllIndicators } from "../../../domain/technical/indicators";
import type { AllIndicators } from "../../../domain/technical/indicators";
import { getCandles } from "../../../data/sources/yahoo";
import { resolveMarketSymbol } from "../../../domain/market/symbol";

// Extended filter fields including fundamentals and technical indicators
const ALLOWED_FILTER_FIELDS = [
  // Basic candle data
  'volume', 'symbol', 'timeframe', 'source',
  // Fundamental fields
  'pe_ratio', 'pb_ratio', 'roe', 'market_cap', 'dividend_yield', 'eps', 'debt_to_equity',
  // Technical indicators
  'sma_20', 'ema_20', 'rsi_14', 'macd_value', 'bollinger_width', 'atr_14',
  'stoch_k', 'williams_r', 'adx_14', 'cci_20', 'mfi_14'
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
  // Fundamental fields - these come from external sources, not the candles table
  pe_ratio: null,
  pb_ratio: null,
  roe: null,
  market_cap: null,
  dividend_yield: null,
  eps: null,
  debt_to_equity: null,
  // Technical indicator fields - calculated on the fly
  sma_20: null,
  ema_20: null,
  rsi_14: null,
  macd_value: null,
  bollinger_width: null,
  atr_14: null,
  stoch_k: null,
  williams_r: null,
  adx_14: null,
  cci_20: null,
  mfi_14: null,
} as const;

// Fields that are directly queryable in the candles table
const CANDLE_QUERYABLE_FIELDS = ['volume', 'symbol', 'timeframe', 'source'] as const;
type CandleQueryableField = typeof CANDLE_QUERYABLE_FIELDS[number];

// NSE symbols list for screening
const NSE_SYMBOLS = [
  'RELIANCE', 'TCS', 'HDFCBANK', 'ICICIBANK', 'INFY', 'HINDUNILVR', 'ITC', 'KOTAKBANK',
  'LT', 'SBIN', 'AXISBANK', 'ASIANPAINT', 'MARUTI', 'BAJFINANCE', 'TITAN', 'NESTLEIND',
  'M&M', 'SUNPHARMA', 'ULTRACEMCO', 'TATASTEEL', 'WIPRO', 'ADANIPORTS', 'POWERGRID',
  'NTPC', 'ONGC', 'COALINDIA', 'JSWSTEEL', 'ADANIENT', 'BRITANNIA', 'CIPLA', 'DRREDDY',
  'EICHERMOT', 'GRASIM', 'HCLTECH', 'HEROMOTOCO', 'HDFCLIFE', 'DIVISLAB', 'SBILIFE',
  'TECHM', 'BAJAJ-AUTO', 'ADANIPOWER', 'SHRIRAMFIN', 'INDUSINDBK', 'APOLLOHOSP',
  'BPCL', 'CAIRN', 'CONCOR', 'GAIL', 'IOC', 'LICI', 'NHPC', 'OFSS', 'PFC', 'RECLTD',
  'RVNL', 'SAIL', 'TVSMOTOR', 'ZOMATO', 'PAYTM', 'DELHIVERY', 'LODHA', 'PRINCEPIP'
];

/**
 * Apply technical indicator filters to candle data
 */
function applyTechnicalFilters(
  candleData: Array<{
    symbol: string;
    close: number;
    volume: number;
    indicators: AllIndicators;
  }>,
  filters: Array<{
    field: string;
    operator: string;
    value: number;
  }>
): typeof candleData {
  return candleData.filter(item => {
    for (const filter of filters) {
      const { field, operator, value } = filter;

      // Skip non-indicator fields
      if (!FIELD_MAP[field as keyof typeof FIELD_MAP]) continue;

      let indicatorValue: number | undefined;

      switch (field) {
        case 'rsi_14':
          indicatorValue = item.indicators.rsi.values[item.indicators.rsi.values.length - 1];
          break;
        case 'macd_value':
          indicatorValue = item.indicators.macd.macd[item.indicators.macd.macd.length - 1];
          break;
        case 'bollinger_width':
          const lastBB = item.indicators.bollinger;
          if (lastBB.upper.length > 0 && lastBB.middle.length > 0) {
            const lastIdx = lastBB.upper.length - 1;
            indicatorValue = (lastBB.upper[lastIdx] - lastBB.lower[lastIdx]) / lastBB.middle[lastIdx];
          }
          break;
        case 'atr_14':
          indicatorValue = item.indicators.atr.values[item.indicators.atr.values.length - 1];
          break;
        case 'stoch_k':
          indicatorValue = item.indicators.stochastic.k[item.indicators.stochastic.k.length - 1];
          break;
        case 'williams_r':
          indicatorValue = item.indicators.williamsR.values[item.indicators.williamsR.values.length - 1];
          break;
        case 'adx_14':
          indicatorValue = item.indicators.adx.adx[item.indicators.adx.adx.length - 1];
          break;
        case 'cci_20':
          indicatorValue = item.indicators.cci.values[item.indicators.cci.values.length - 1];
          break;
        case 'mfi_14':
          indicatorValue = item.indicators.mfi.values[item.indicators.mfi.values.length - 1];
          break;
      }

      if (indicatorValue === undefined) continue;

      switch (operator) {
        case 'gt': if (!(indicatorValue > value)) return false; break;
        case 'gte': if (!(indicatorValue >= value)) return false; break;
        case 'lt': if (!(indicatorValue < value)) return false; break;
        case 'lte': if (!(indicatorValue <= value)) return false; break;
        case 'eq': if (Math.abs(indicatorValue - value) > 0.01) return false; break;
      }
    }
    return true;
  });
}

/**
 * Stub for enhanced technical screening.
 * Fetches candles from Yahoo, computes indicators, and applies filters.
 * TODO: Implement with actual data fetching and indicator calculation.
 */
async function runTechnicalScreen(params: {
  symbols: string[];
  filters: Array<{
    field: string;
    operator: string;
    value: number;
  }>;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  limit: number;
}): Promise<Array<{
  symbol: string;
  timeframe: string;
  ts: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  source: string;
}>> {
  // TODO: Implement enhanced screening:
  // 1. Fetch candles for each symbol from Yahoo
  // 2. Calculate all technical indicators using calculateAllIndicators
  // 3. Apply technical filters using applyTechnicalFilters
  // 4. Sort and limit results

  console.warn(
    `[runTechnicalScreen] Technical indicator screening not yet implemented. ` +
    `Requested ${params.filters.length} technical filter(s) across ${params.symbols.length} symbols.`
  );

  return [];
}

// Filter input type reused across procedures
const filterSchema = z.array(z.object({
  field: z.enum(ALLOWED_FILTER_FIELDS),
  operator: z.enum(["gt", "gte", "lt", "lte", "eq", "between"]),
  value: z.union([z.number(), z.array(z.number())]),
}));

export const screenerRouter = createRouter({
  // Run a stock screen with filters
  runScreen: protectedProcedure
    .input(z.object({
      filters: filterSchema,
      sortBy: z.enum(ALLOWED_FILTER_FIELDS).optional(),
      sortOrder: z.enum(["asc", "desc"]).default("desc"),
      limit: z.number().int().positive().max(500).default(50),
    }))
    .query(async ({ input }) => {
      const warnings: string[] = [];

      // Separate candle-queryable filters from technical/fundamental filters
      const candleFilters: Array<{
        field: CandleQueryableField;
        operator: string;
        value: number | number[];
      }> = [];

      const technicalFilters: Array<{
        field: string;
        operator: string;
        value: number;
      }> = [];

      for (const filter of input.filters) {
        if (CANDLE_QUERYABLE_FIELDS.includes(filter.field as CandleQueryableField)) {
          candleFilters.push({
            field: filter.field as CandleQueryableField,
            operator: filter.operator,
            value: filter.value,
          });
        } else {
          if (typeof filter.value === 'number') {
            technicalFilters.push({
              field: filter.field,
              operator: filter.operator,
              value: filter.value,
            });
          }
        }
      }

      // If technical filters are present, delegate to the enhanced path (stub)
      if (technicalFilters.length > 0) {
        warnings.push(
          `${technicalFilters.length} technical/fundamental filter(s) require enhanced screening. ` +
          `Results are limited to candle-only filters.`
        );
        const enhancedResults = await runTechnicalScreen({
          symbols: NSE_SYMBOLS,
          filters: technicalFilters,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
          limit: input.limit,
        });
        if (enhancedResults.length > 0) {
          return { results: enhancedResults, warnings };
        }
        // Fall through to candle-only query and return what we can
      }

      // Build candle-only query
      try {
        let query = db.select().from(candles).$dynamic();
        const conditions: any[] = [];

        for (const filter of candleFilters) {
          const column = FIELD_MAP[filter.field];
          if (!column) continue; // Should not happen for candle fields

          switch (filter.operator) {
            case "gt":
              conditions.push(gt(column, filter.value as number));
              break;
            case "gte":
              conditions.push(gte(column, filter.value as number));
              break;
            case "lt":
              conditions.push(lt(column, filter.value as number));
              break;
            case "lte":
              conditions.push(lte(column, filter.value as number));
              break;
            case "eq":
              conditions.push(eq(column, filter.value as number));
              break;
            case "between":
              if (Array.isArray(filter.value) && filter.value.length === 2) {
                conditions.push(
                  and(
                    gte(column, filter.value[0]),
                    lte(column, filter.value[1])
                  )
                );
              }
              break;
          }
        }

        if (conditions.length > 0) {
          query = query.where(and(...conditions));
        }

        // Apply sorting (only for candle-queryable fields)
        if (input.sortBy && CANDLE_QUERYABLE_FIELDS.includes(input.sortBy as CandleQueryableField)) {
          const sortColumn = FIELD_MAP[input.sortBy as CandleQueryableField];
          query = input.sortOrder === "desc"
            ? query.orderBy(desc(sortColumn))
            : query.orderBy(sortColumn);
        }

        // Apply limit
        query = query.limit(input.limit);

        const results = await query;

        return {
          results: results.map((row: any) => ({
            symbol: row.symbol,
            timeframe: row.timeframe,
            ts: row.ts,
            open: row.open,
            high: row.high,
            low: row.low,
            close: row.close,
            volume: row.volume,
            source: row.source,
          })),
          warnings,
        };
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

  // Get saved screeners for the current user
  getScreeners: protectedProcedure
    .query(async ({ ctx }) => {
      const userId = ctx.userId;

      const runs = await db
        .select({
          id: screenerRuns.id,
          name: screenerRuns.name,
          criteria: screenerRuns.criteria,
          matches: screenerRuns.matches,
          startedAt: screenerRuns.startedAt,
          completedAt: screenerRuns.completedAt,
        })
        .from(screenerRuns)
        .where(eq(screenerRuns.userId, userId))
        .orderBy(desc(screenerRuns.startedAt))
        .limit(50);

      return runs.map((run) => ({
        id: run.id,
        name: run.name,
        criteria: run.criteria as any,
        matches: run.matches as any[],
        startedAt: run.startedAt.toISOString(),
        completedAt: run.completedAt?.toISOString() ?? null,
      }));
    }),

  // Save a screener (creates a new screener run entry)
  saveScreener: protectedProcedure
    .input(z.object({
      name: z.string().min(1).max(100),
      filters: filterSchema,
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId;

      const criteria = {
        filters: input.filters,
      };

      const [created] = await db
        .insert(screenerRuns)
        .values({
          userId,
          name: input.name,
          criteria,
          matches: [],
          startedAt: new Date(),
        })
        .returning({
          id: screenerRuns.id,
          name: screenerRuns.name,
          startedAt: screenerRuns.startedAt,
        });

      return {
        id: created.id,
        userId,
        name: created.name,
        criteria,
        matches: [],
        startedAt: created.startedAt.toISOString(),
        completedAt: null,
      };
    }),

  // Delete a screener (only if owned by the current user)
  deleteScreener: protectedProcedure
    .input(z.object({
      screenerId: z.string().uuid(),
    }))
    .mutation(async ({ input, ctx }) => {
      const userId = ctx.userId;

      // Attempt deletion only if the screener belongs to the current user
      const [deleted] = await db
        .delete(screenerRuns)
        .where(
          and(
            eq(screenerRuns.id, input.screenerId),
            eq(screenerRuns.userId, userId)
          )
        )
        .returning({ id: screenerRuns.id });

      if (!deleted) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Screener not found or you do not have permission to delete it.",
        });
      }

      return { success: true, screenerId: deleted.id };
    }),
});
