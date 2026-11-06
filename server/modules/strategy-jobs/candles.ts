import { and, asc, eq, gte, lte } from "drizzle-orm";
import type { Candle } from "@shared/types";
import { db } from "../../data/drizzle/client";
import { candles } from "../../db/schema";

/**
 * Most bars one strategy job may load. Jobs run inside the single web process, so an unbounded
 * range (e.g. years of 1-minute bars) would hold millions of rows in memory and block the event
 * loop inside one synchronous backtest. Same default as the synchronous backtestV2 endpoint.
 */
export const MAX_JOB_CANDLES = Number.parseInt(process.env.MAX_JOB_CANDLES ?? "50000", 10);

export class JobCandleLimitError extends Error {
  constructor(readonly limit: number) {
    super(`The range holds more than ${limit} bars; narrow the date range or use a larger timeframe.`);
    this.name = "JobCandleLimitError";
  }
}

/**
 * Stored candles for `symbol` / `timeframe` in [from, to], oldest first, as the engine consumes them.
 * Throws JobCandleLimitError when the range holds more than `maxCandles` bars.
 */
export async function loadJobCandles(
  symbol: string,
  timeframe: string,
  from: Date,
  to: Date,
  maxCandles = MAX_JOB_CANDLES,
): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe), gte(candles.ts, from), lte(candles.ts, to)))
    .orderBy(asc(candles.ts))
    .limit(maxCandles + 1);
  if (rows.length > maxCandles) throw new JobCandleLimitError(maxCandles);

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
