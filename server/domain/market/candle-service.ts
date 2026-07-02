import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { Candle } from "@shared/types";
import { db } from "../../data/drizzle/client";
import { candles as candleTable } from "../../db/schema";
import { getCandles } from "../../data/sources/yahoo";
import { resolveMarketSymbol } from "./symbol";

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

/** Read stored history first; refresh from Yahoo only when absent or stale. */
export async function loadMarketCandles(
  symbolInput: string,
  timeframe: Candle["tf"],
  from: Date,
  to: Date
): Promise<CandleLoadResult> {
  const resolved = resolveMarketSymbol(symbolInput);
  let stored: Candle[] = [];
  try {
    const rows = await db.select().from(candleTable).where(and(
      eq(candleTable.symbol, resolved.symbol),
      eq(candleTable.timeframe, timeframe),
      gte(candleTable.ts, from),
      lte(candleTable.ts, to)
    )).orderBy(asc(candleTable.ts));
    stored = rows.map(mapStored);
    const latest = stored.at(-1);
    if (stored.length >= 2 && latest && to.getTime() - new Date(latest.ts).getTime() <= FRESHNESS_MS[timeframe]) {
      return { candles: stored, source: "database", persisted: true };
    }
  } catch {
    // Database is optional for the public fallback path.
  }

  try {
    const fetched = (await getCandles(resolved.ticker, from, to, timeframe)).map((candle) => ({
      ...candle,
      symbol: resolved.symbol,
    }));
    let persisted = false;
    if (fetched.length > 0) {
      try {
        await db.insert(candleTable).values(fetched.map((candle) => ({
          symbol: resolved.symbol,
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
        persisted = true;
      } catch {
        // Returning verified Yahoo history is preferable to failing when DB is offline.
      }
    }
    return { candles: fetched, source: "yahoo", persisted };
  } catch (error) {
    if (stored.length > 0) return { candles: stored, source: "database", persisted: true };
    throw error;
  }
}
