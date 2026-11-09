/**
 * BigQuery Writer — Batched inserts to analytical tables
 * Uses streaming insert API for real-time data, load jobs for bulk
 */

import { streamToBigQuery } from "../../../data/bigquery/client";
import { getLogger } from "../../../infra/logger";
import type { OHLCVRow } from "../validators/schema-validator";

const logger = getLogger("bigquery-writer");

export interface BQWriteResult {
  rowsStreamed: number;
  failed: number;
  durationMs: number;
}

// ============================================================================
// Market Ticks
// ============================================================================

export async function writeMarketTicksBQ(rows: OHLCVRow[], timeframe = "1d"): Promise<BQWriteResult> {
  if (rows.length === 0) return { rowsStreamed: 0, failed: 0, durationMs: 0 };
  const start = Date.now();

  const bqRows = rows.map((r) => ({
    symbol: r.symbol,
    timestamp: new Date(`${r.date}T03:45:00Z`).toISOString(), // 09:15 IST
    timeframe,
    open: r.open,
    high: r.high,
    low: r.low,
    close: r.close,
    volume: r.volume,
    turnover: null,
    adjusted_close: null,
    source_tag: r.source_tag,
    ingested_at: new Date().toISOString(),
  }));

  try {
    // Stream in batches of 500 (BQ streaming limit per request)
    const BATCH_SIZE = 500;
    let totalStreamed = 0;
    for (let i = 0; i < bqRows.length; i += BATCH_SIZE) {
      const batch = bqRows.slice(i, i + BATCH_SIZE);
      await streamToBigQuery("market_ticks", batch);
      totalStreamed += batch.length;
    }
    return { rowsStreamed: totalStreamed, failed: 0, durationMs: Date.now() - start };
  } catch (err) {
    logger.error({ err }, "BigQuery market_ticks write failed");
    return { rowsStreamed: 0, failed: rows.length, durationMs: Date.now() - start };
  }
}
