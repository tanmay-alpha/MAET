/**
 * BigQuery Writer — Batched inserts to analytical tables
 * Uses streaming insert API for real-time data, load jobs for bulk
 */

import { streamToBigQuery } from "../../../data/bigquery/client";
import { getLogger } from "../../../infra/logger";
import type { OHLCVRow } from "../validators/schema-validator";
import type { IndicatorCacheRow } from "./supabase-writer";

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

// ============================================================================
// Indicator Values
// ============================================================================

export async function writeIndicatorValuesBQ(rows: IndicatorCacheRow[]): Promise<BQWriteResult> {
  if (rows.length === 0) return { rowsStreamed: 0, failed: 0, durationMs: 0 };
  const start = Date.now();

  const bqRows = rows.map((r) => ({
    symbol: r.symbol,
    date: r.date,
    indicator_name: r.indicatorName,
    indicator_value: r.indicatorValue ?? null,
    indicator_signal: r.indicatorSignal ?? null,
    indicator_hist: r.indicatorHist ?? null,
    parameters: r.parameters ? JSON.stringify(r.parameters) : null,
    timeframe: r.timeframe ?? "1d",
    calculated_at: new Date().toISOString(),
    source_tag: "calculation-engine",
  }));

  try {
    const BATCH_SIZE = 500;
    let totalStreamed = 0;
    for (let i = 0; i < bqRows.length; i += BATCH_SIZE) {
      const batch = bqRows.slice(i, i + BATCH_SIZE);
      await streamToBigQuery("indicator_values", batch);
      totalStreamed += batch.length;
    }
    return { rowsStreamed: totalStreamed, failed: 0, durationMs: Date.now() - start };
  } catch (err) {
    logger.error({ err }, "BigQuery indicator_values write failed");
    return { rowsStreamed: 0, failed: rows.length, durationMs: Date.now() - start };
  }
}

// ============================================================================
// Fundamental Scores
// ============================================================================

export interface FundamentalScoreBQRow {
  symbol: string;
  period: string; // YYYY-MM-DD
  periodType: string;
  scoreType: string;
  scoreValue: number | null;
  components?: Record<string, unknown>;
}

export async function writeFundamentalScoresBQ(rows: FundamentalScoreBQRow[]): Promise<BQWriteResult> {
  if (rows.length === 0) return { rowsStreamed: 0, failed: 0, durationMs: 0 };
  const start = Date.now();

  const bqRows = rows.map((r) => ({
    symbol: r.symbol,
    period: r.period,
    period_type: r.periodType,
    score_type: r.scoreType,
    score_value: r.scoreValue ?? null,
    components: r.components ? JSON.stringify(r.components) : null,
    calculated_at: new Date().toISOString(),
    source_tag: "calculation-engine",
  }));

  try {
    await streamToBigQuery("fundamental_scores", bqRows);
    return { rowsStreamed: bqRows.length, failed: 0, durationMs: Date.now() - start };
  } catch (err) {
    logger.error({ err }, "BigQuery fundamental_scores write failed");
    return { rowsStreamed: 0, failed: rows.length, durationMs: Date.now() - start };
  }
}

// ============================================================================
// Price Scans
// ============================================================================

export interface PriceScanBQRow {
  scanDate: string;
  scanType: string;
  symbol: string;
  signal: string;
  strength: number;
  price: number;
  volume: number;
  metadata?: Record<string, unknown>;
}

export async function writePriceScansBQ(rows: PriceScanBQRow[]): Promise<BQWriteResult> {
  if (rows.length === 0) return { rowsStreamed: 0, failed: 0, durationMs: 0 };
  const start = Date.now();

  const bqRows = rows.map((r) => ({
    scan_date: r.scanDate,
    scan_type: r.scanType,
    symbol: r.symbol,
    signal: r.signal,
    strength: r.strength,
    price: r.price,
    volume: r.volume,
    metadata: r.metadata ? JSON.stringify(r.metadata) : null,
    calculated_at: new Date().toISOString(),
    source_tag: "scanner-engine",
  }));

  try {
    await streamToBigQuery("price_scans", bqRows);
    return { rowsStreamed: bqRows.length, failed: 0, durationMs: Date.now() - start };
  } catch (err) {
    logger.error({ err }, "BigQuery price_scans write failed");
    return { rowsStreamed: 0, failed: rows.length, durationMs: Date.now() - start };
  }
}
