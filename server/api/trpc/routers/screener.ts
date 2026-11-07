/**
 * Screener tRPC Router
 * Enhanced stock screening with fundamental and technical indicators
 * Audited: Verified fail-closed error propagation and strict ctx.userId usage.
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { candles, companies, screenerRuns, technicalSnapshots, users } from "../../../db/schema";
import { desc, sql, and, or, gte, lte, eq, gt, lt, ilike, like, inArray, type SQL } from "drizzle-orm";

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

/**
 * Rows satisfying every candle filter: the in-memory counterpart of the candle-only SQL
 * conditions, applied to the latest candle of each symbol the technical screen matched.
 */
export function applyCandleFilters<T extends Record<CandleQueryableField, unknown>>(
  rows: T[],
  filters: Array<{ field: CandleQueryableField; operator: string; value: number | number[] }>,
): T[] {
  return rows.filter((row) =>
    filters.every((f) => {
      const v = Number(row[f.field]);
      if (f.operator === "between") {
        // Matches the SQL path, which adds no condition for a malformed range.
        if (!Array.isArray(f.value) || f.value.length !== 2) return true;
        return v >= f.value[0] && v <= f.value[1];
      }
      if (typeof f.value !== "number") return false;
      switch (f.operator) {
        case "gt": return v > f.value;
        case "gte": return v >= f.value;
        case "lt": return v < f.value;
        case "lte": return v <= f.value;
        case "eq": return v === f.value;
        default: return false;
      }
    }),
  );
}

// FIX 2: Removed hardcoded NSE_SYMBOLS whitelist (was 60 symbols).
// The screener now queries the companies table for the full NSE universe.

/**
 * Get all active NSE-listed symbols from the companies table.
 * Falls back to an empty array if the table is unreachable.
 */
async function getNSESymbols(): Promise<string[]> {
  try {
    const rows = await db
      .select({ symbol: companies.symbol })
      .from(companies)
      .where(and(eq(companies.exchange, "NSE"), eq(companies.isActive, true)))
      .orderBy(companies.symbol);
    return rows.map((r) => r.symbol);
  } catch (err) {
    console.error("[screener] Failed to load NSE symbols from companies table:", err);
    return [];
  }
}

// Screener filter field → calculation_results row written by the calculation engine
// (server/domain/calculations/calculators/indicators). `value` is the SQL expression
// filtered on; `columns` are the stored columns it reads.
// Keys match ALLOWED_FILTER_FIELDS technical indicator entries.
export interface CalculationResultsFilterSource {
  indicatorName: string;
  columns: ("value" | "signal" | "hist")[];
  value: SQL;
}
const storedValue = (indicatorName: string): CalculationResultsFilterSource => ({
  indicatorName,
  columns: ["value"],
  value: sql`indicator_value`,
});
export const CALCULATION_RESULTS_FILTERS: Record<string, CalculationResultsFilterSource> = {
  sma_20: storedValue("SMA_20"),
  ema_20: storedValue("EMA_20"),
  rsi_14: storedValue("RSI_14"),
  macd_value: storedValue("MACD"),
  // BB_20 stores value = middle, signal = upper, hist = lower; width matches the
  // canonical (upper - lower) / middle used by technical_snapshots.bb_width.
  bollinger_width: {
    indicatorName: "BB_20",
    columns: ["value", "signal", "hist"],
    value: sql`((indicator_signal - indicator_hist) / NULLIF(indicator_value, 0))`,
  },
  atr_14: storedValue("ATR_14"),
  stoch_k: storedValue("STOCH_14_3"),
  williams_r: storedValue("WILLIAMS_R_14"),
  adx_14: storedValue("ADX_14"),
  cci_20: storedValue("CCI_20"),
  mfi_14: storedValue("MFI_14"),
};

// Fields whose latest value lives on the companies (fundamentals) table
const FUNDAMENTAL_COMPANY_FIELDS: Record<string, keyof typeof companies> = {
  pe_ratio: "peRatio",
  pb_ratio: "pbRatio",
  roe: "roe",
  market_cap: "marketCap",
  dividend_yield: "dividendYield",
  eps: "eps",
  debt_to_equity: "debtToEquity",
};

/**
 * FIX 1: Implemented technical screener using calculation_results table.
 * Queries pre-computed indicator values, applies filter conditions,
 * and returns matching symbols with their indicator data.
 */
const TECHNICAL_SNAPSHOT_COL_MAP: Record<string, any> = {
  sma_20: technicalSnapshots.sma20,
  ema_20: technicalSnapshots.ema20,
  rsi_14: technicalSnapshots.rsi14,
  macd_value: technicalSnapshots.macd,
  bollinger_width: technicalSnapshots.bbWidth,
  atr_14: technicalSnapshots.atr14,
  adx_14: technicalSnapshots.adx14,
};

/** Symbols in `symbols` whose latest stored indicator value satisfies the filter. */
export function calculationResultsFilterQuery(params: {
  symbols: string[];
  source: CalculationResultsFilterSource;
  latestDate: unknown;
  operator: string;
  value: number;
}): SQL {
  const v = params.source.value;
  const comparison =
    params.operator === "gt" ? sql`AND ${v} > ${params.value}::numeric`
    : params.operator === "gte" ? sql`AND ${v} >= ${params.value}::numeric`
    : params.operator === "lt" ? sql`AND ${v} < ${params.value}::numeric`
    : params.operator === "lte" ? sql`AND ${v} <= ${params.value}::numeric`
    : params.operator === "eq" ? sql`AND ABS(${v} - ${params.value}::numeric) < 0.01`
    : sql.empty();
  return sql`
    SELECT DISTINCT symbol
    FROM calculation_results
    WHERE ${inArray(sql`symbol`, params.symbols)}
      AND indicator_name = ${params.source.indicatorName}
      AND date = ${params.latestDate}::date
      AND ${v} IS NOT NULL
      ${comparison}
  `;
}

async function runTechnicalScreen(params: {
  symbols: string[];
  filters: Array<{
    field: string;
    operator: string;
    value: number;
  }>;
  sortBy?: string;
  sortOrder?: "asc" | "desc";
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
  if (params.symbols.length === 0) return [];
  if (params.filters.length === 0) return [];

  try {
    // 1. Check technical_snapshots first (precomputed canonical indicators)
    const techConditions: any[] = [
      inArray(technicalSnapshots.symbol, params.symbols),
      eq(technicalSnapshots.timeframe, "1d"),
    ];

    // Snapshots hold only some indicators: use them only when they cover every filter, otherwise
    // the uncovered filters would be ignored. calculation_results covers all of them.
    const snapshotCoversFilters = params.filters.every((f) => TECHNICAL_SNAPSHOT_COL_MAP[f.field]);
    for (const f of params.filters) {
      const col = TECHNICAL_SNAPSHOT_COL_MAP[f.field];
      if (!col) continue;
      if (f.operator === "gt") techConditions.push(gt(col, String(f.value)));
      else if (f.operator === "gte") techConditions.push(gte(col, String(f.value)));
      else if (f.operator === "lt") techConditions.push(lt(col, String(f.value)));
      else if (f.operator === "lte") techConditions.push(lte(col, String(f.value)));
      else if (f.operator === "eq") techConditions.push(eq(col, String(f.value)));
    }

    let matchingSymbols: string[] = [];
    if (snapshotCoversFilters) {
      const matchingTechRows = await db
        .select({ symbol: technicalSnapshots.symbol })
        .from(technicalSnapshots)
        .where(and(...techConditions));

      if (matchingTechRows.length > 0) {
        matchingSymbols = matchingTechRows.map((r) => r.symbol);
      }
    }

    // 2. Fallback to calculation_results if no snapshots matched or table empty
    if (matchingSymbols.length === 0) {
      const indicatorFilters: Array<{
        source: CalculationResultsFilterSource;
        operator: string;
        value: number;
      }> = [];

      for (const f of params.filters) {
        const source = CALCULATION_RESULTS_FILTERS[f.field];
        if (!source) continue;
        indicatorFilters.push({
          source,
          operator: f.operator,
          value: f.value,
        });
      }

      if (indicatorFilters.length === 0) return [];

      const latestDateRow = await db.execute(sql`
        SELECT MAX(date) as max_date
        FROM calculation_results
        WHERE ${inArray(sql`symbol`, params.symbols)}
      `);
      const latestDate = (latestDateRow as any[])[0]?.max_date;
      if (!latestDate) return [];

      matchingSymbols = params.symbols;
      for (const f of indicatorFilters) {
        const symbolRows = await db.execute(calculationResultsFilterQuery({
          symbols: params.symbols,
          source: f.source,
          latestDate,
          operator: f.operator,
          value: f.value,
        }));

        const filteredSymbols = (symbolRows as any[]).map((r) => r.symbol);
        matchingSymbols = matchingSymbols.filter((s) => filteredSymbols.includes(s));
        if (matchingSymbols.length === 0) return [];
      }
    }

    if (matchingSymbols.length === 0) return [];

    // Fetch candle data for matching symbols (most recent candle per symbol)
    const candleRows = await db.execute(sql`
      SELECT DISTINCT ON (symbol) symbol, timeframe, ts, open, high, low, close, volume, source
      FROM candles
      WHERE ${inArray(candles.symbol, matchingSymbols)}
      ORDER BY symbol, ts DESC
    `);

    return (candleRows as any[]).map((row) => ({
      symbol: row.symbol,
      timeframe: row.timeframe,
      ts: new Date(row.ts),
      open: Number(row.open),
      high: Number(row.high),
      low: Number(row.low),
      close: Number(row.close),
      volume: Number(row.volume),
      source: row.source,
    }));
  } catch (error) {
    console.error("[runTechnicalScreen] Error during technical screening:", error);
    return [];
  }
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

      // Filters the technical screen cannot evaluate (fundamentals, malformed ranges)
      const unevaluable: string[] = [];

      for (const filter of input.filters) {
        if (CANDLE_QUERYABLE_FIELDS.includes(filter.field as CandleQueryableField)) {
          candleFilters.push({
            field: filter.field as CandleQueryableField,
            operator: filter.operator,
            value: filter.value,
          });
        } else if (!CALCULATION_RESULTS_FILTERS[filter.field]) {
          unevaluable.push(filter.field);
        } else if (filter.operator === "between") {
          // runTechnicalScreen compares scalars; a range is its two inclusive bounds.
          if (Array.isArray(filter.value) && filter.value.length === 2) {
            technicalFilters.push(
              { field: filter.field, operator: "gte", value: filter.value[0] },
              { field: filter.field, operator: "lte", value: filter.value[1] },
            );
          } else {
            unevaluable.push(filter.field);
          }
        } else if (typeof filter.value === "number") {
          technicalFilters.push({
            field: filter.field,
            operator: filter.operator,
            value: filter.value,
          });
        } else {
          unevaluable.push(filter.field);
        }
      }

      // Fail closed: returning rows that were never checked against a filter would ignore it.
      if (unevaluable.length > 0) {
        warnings.push(
          `Filter(s) ${[...new Set(unevaluable)].join(", ")} cannot be evaluated by the screener; no symbols can be confirmed to match.`
        );
        return { results: [], warnings };
      }

      if (technicalFilters.length > 0) {
        const nseSymbols = await getNSESymbols();
        const technicalMatches = await runTechnicalScreen({
          symbols: nseSymbols,
          filters: technicalFilters,
          sortBy: input.sortBy,
          sortOrder: input.sortOrder,
          limit: input.limit,
        });
        // No candle-only fallback: it would drop the technical filters. Candle filters apply to
        // each matched symbol's latest candle.
        return { results: applyCandleFilters(technicalMatches, candleFilters), warnings };
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
