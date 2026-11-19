/**
 * Yahoo History Source — Historical OHLCV via Yahoo Finance
 * Wraps existing server/data/sources/yahoo.ts with ingestion engine interface
 */

import type { Candle } from "@shared/types";
import { getCandles } from "../../../data/sources/yahoo";
import { resolveMarketSymbol } from "../../../domain/market/symbol";
import { getLogger } from "../../../infra/logger";
import { withRetry } from "../queue/retry-policy";
import type { OHLCVRow } from "../validators/schema-validator";

const logger = getLogger("source:yahoo-history");
/** Same `candles.source` tag the candle service and daily processor write. */
export const SOURCE_TAG = "yahoo";

export interface YahooHistoryOptions {
  symbols: string[];
  timeframes?: Candle["tf"][];
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

/**
 * Provider candles → ingestion rows, keyed exactly as the candle service
 * stores them: canonical symbol and the provider's bar timestamp unchanged
 * (for NSE daily bars Yahoo reports the 09:15 IST session open, 03:45 UTC).
 * Values are passed through untouched; validation decides what is stored.
 */
export function toOHLCVRows(symbol: string, candles: Candle[]): OHLCVRow[] {
  return candles.map((c) => ({
    symbol,
    ts: new Date(c.ts).toISOString(),
    open: c.open,
    high: c.high,
    low: c.low,
    close: c.close,
    volume: c.volume,
    source_tag: SOURCE_TAG,
  }));
}

export async function fetch(opts: YahooHistoryOptions): Promise<SourceFetchResult[]> {
  const results: SourceFetchResult[] = [];
  const timeframes = opts.timeframes ?? ["1d"];

  for (const input of opts.symbols) {
    const resolved = resolveMarketSymbol(input);
    for (const tf of timeframes) {
      try {
        const to = new Date();
        const from = new Date(to.getTime() - (opts.backfillDays ?? 365) * 86_400_000);
        const candles = await withRetry(
          () => getCandles(resolved.ticker, from, to, tf),
          "yahoo-history",
          `getCandles:${resolved.symbol}:${tf}`
        );

        const rows = toOHLCVRows(resolved.symbol, candles);
        results.push({ symbol: resolved.symbol, rows });
        logger.debug({ symbol: resolved.symbol, tf, rows: rows.length }, "Yahoo history fetched");
      } catch (err) {
        const errorMsg = (err as Error).message;
        logger.error({ err, symbol: resolved.symbol, tf }, "Yahoo history fetch failed");
        results.push({ symbol: resolved.symbol, rows: [], error: errorMsg });
      }
    }
  }

  lastSyncTimestamp = new Date();
  return results;
}
