/**
 * Yahoo History Source — Historical OHLCV via Yahoo Finance
 * Wraps existing server/data/sources/yahoo.ts with ingestion engine interface
 */

import { getCandles } from "../../../data/sources/yahoo";
import { getLogger } from "../../../infra/logger";
import { withRetry } from "../queue/retry-policy";
import type { OHLCVRow } from "../validators/schema-validator";

const logger = getLogger("source:yahoo-history");
const SOURCE_TAG = "yahoo";

export interface YahooHistoryOptions {
  symbols: string[];
  timeframes?: string[];
  backfillDays?: number;
}

export interface SourceFetchResult {
  symbol: string;
  rows: OHLCVRow[];
  error?: string;
}

let lastSyncTimestamp: Date | null = null;

export function getLastSyncTimestamp(): Date | null {
  return lastSyncTimestamp;
}

export async function fetch(opts: YahooHistoryOptions): Promise<SourceFetchResult[]> {
  const results: SourceFetchResult[] = [];
  const timeframes = opts.timeframes ?? ["1d"];

  for (const symbol of opts.symbols) {
    for (const tf of timeframes) {
      try {
        const candles = await withRetry(
          () => getCandles(symbol, tf as any, opts.backfillDays ?? 365),
          "yahoo-history",
          `getCandles:${symbol}:${tf}`
        );

        const rows: OHLCVRow[] = candles
          .filter((c) => c.open && c.high && c.low && c.close)
          .map((c) => ({
            symbol: c.symbol ?? symbol,
            date: typeof c.ts === "string"
              ? c.ts.split("T")[0]
              : new Date(c.ts).toISOString().split("T")[0],
            open: Number(c.open),
            high: Number(c.high),
            low: Number(c.low),
            close: Number(c.close),
            volume: Number(c.volume ?? 0),
            source_tag: SOURCE_TAG,
          }));

        results.push({ symbol, rows });
        logger.debug({ symbol, tf, rows: rows.length }, "Yahoo history fetched");
      } catch (err) {
        const errorMsg = (err as Error).message;
        logger.error({ err, symbol, tf }, "Yahoo history fetch failed");
        results.push({ symbol, rows: [], error: errorMsg });
      }
    }
  }

  lastSyncTimestamp = new Date();
  return results;
}
