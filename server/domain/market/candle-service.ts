import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Candle } from "@shared/types";
import { db } from "../../data/drizzle/client";
import { DatabaseUnavailableError, withOptionalDatabase } from "../../data/drizzle/availability";
import { candles as candleTable } from "../../db/schema";
import { getCandles } from "../../data/sources/yahoo";
import { resolveMarketSymbol } from "./symbol";
import { getLogger } from "../../infra/logger";

function logDatabaseFallback(operation: string, symbol: string, error: unknown): void {
  // An open circuit is already logged by whatever opened it.
  if (error instanceof DatabaseUnavailableError) return;
  getLogger().warn(
    { symbol, operation, err: error instanceof Error ? error.message : String(error) },
    "candle store unavailable; continuing without it"
  );
}

const FRESHNESS_MS: Record<Candle["tf"], number> = {
  "1m": 3 * 60_000,
  "5m": 15 * 60_000,
  "15m": 45 * 60_000,
  "1h": 3 * 3_600_000,
  "1d": 3 * 86_400_000,
  "1wk": 10 * 86_400_000,
};

function mapStored(row: typeof candleTable.$inferSelect): Candle {
  return {
    symbol: row.symbol,
    tf: row.timeframe as Candle["tf"],
    ts: row.ts.toISOString(),
    open: Number(row.open),
    high: Number(row.high),
    low: Number(row.low),
    close: Number(row.close),
    volume: row.volume,
  };
}

export type CandleLoadResult = {
  candles: Candle[];
  source: "database" | "yahoo";
  persisted: boolean;
};

/** Persistent candle history. Both operations are optional for this read path. */
export type CandleStore = {
  read(symbol: string, timeframe: Candle["tf"], from: Date, to: Date): Promise<Candle[]>;
  write(symbol: string, timeframe: Candle["tf"], candles: Candle[]): Promise<void>;
};

export type CandleServiceDeps = {
  store: CandleStore;
  fetchCandles: (ticker: string, from: Date, to: Date, timeframe: Candle["tf"]) => Promise<Candle[]>;
};

const databaseCandleStore: CandleStore = {
  async read(symbol, timeframe, from, to) {
    const rows = await db.select().from(candleTable).where(and(
      eq(candleTable.symbol, symbol),
      eq(candleTable.timeframe, timeframe),
      gte(candleTable.ts, from),
      lte(candleTable.ts, to)
    )).orderBy(asc(candleTable.ts));
    return rows.map(mapStored);
  },
  async write(symbol, timeframe, fetched) {
    await db.insert(candleTable).values(fetched.map((candle) => ({
      symbol,
      timeframe,
      ts: new Date(candle.ts),
      open: candle.open.toString(), high: candle.high.toString(), low: candle.low.toString(), close: candle.close.toString(),
      volume: Math.floor(candle.volume), source: "yahoo",
    }))).onConflictDoUpdate({
      target: [candleTable.symbol, candleTable.timeframe, candleTable.ts],
      set: {
        open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`,
        volume: sql`excluded.volume`, source: sql`excluded.source`,
      },
    });
  },
};

const defaultDeps: CandleServiceDeps = { store: databaseCandleStore, fetchCandles: getCandles };

/**
 * Read stored history first; refresh from Yahoo only when absent or stale.
 * The database is skipped while the availability circuit is open, so an
 * unreachable database costs nothing instead of a 10s connect timeout.
 */
export async function loadMarketCandles(
  symbolInput: string,
  timeframe: Candle["tf"],
  from: Date,
  to: Date,
  deps: CandleServiceDeps = defaultDeps
): Promise<CandleLoadResult> {
  const resolved = resolveMarketSymbol(symbolInput);
  let stored: Candle[] = [];
  try {
    stored = await withOptionalDatabase(() => deps.store.read(resolved.symbol, timeframe, from, to));
    const latest = stored.at(-1);
    if (stored.length >= 2 && latest && to.getTime() - new Date(latest.ts).getTime() <= FRESHNESS_MS[timeframe]) {
      return { candles: stored, source: "database", persisted: true };
    }
  } catch (error) {
    // Database is optional for the public fallback path.
    logDatabaseFallback("read", resolved.symbol, error);
  }

  try {
    const fetched = (await deps.fetchCandles(resolved.ticker, from, to, timeframe)).map((candle) => ({
      ...candle,
      symbol: resolved.symbol,
    }));
    let persisted = false;
    if (fetched.length > 0) {
      try {
        await withOptionalDatabase(() => deps.store.write(resolved.symbol, timeframe, fetched));
        persisted = true;
      } catch (error) {
        // Returning verified Yahoo history is preferable to failing when DB is offline.
        logDatabaseFallback("write", resolved.symbol, error);
      }
    }
    return { candles: fetched, source: "yahoo", persisted };
  } catch (error) {
    if (stored.length > 0) return { candles: stored, source: "database", persisted: true };
    throw error;
  }
}
