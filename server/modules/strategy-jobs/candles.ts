import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Candle } from "@shared/types";
import { db } from "../../data/drizzle/client";
import { candles } from "../../db/schema";

/** Stored candles for `symbol` / `timeframe` in [from, to], oldest first, as the engine consumes them. */
export async function loadJobCandles(symbol: string, timeframe: string, from: Date, to: Date): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe), gte(candles.ts, from), lte(candles.ts, to)))
    .orderBy(asc(candles.ts));

  return rows.map((r) => ({
    symbol: r.symbol,
    tf: r.timeframe as Candle["tf"],
    ts: r.ts.toISOString(),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume ?? 0,
    source: r.source,
  }));
}
