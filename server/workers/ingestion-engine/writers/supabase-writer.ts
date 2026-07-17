/**
 * Supabase Writer — Batched upserts for operational data
 * Handles: price_daily, companies, financial_statements, fundamentals, calculation_results
 */

import { db } from "../../../data/drizzle/client";
import { sql } from "drizzle-orm";
import { getLogger } from "../../../infra/logger";
import type { OHLCVRow } from "../validators/schema-validator";

const logger = getLogger("supabase-writer");

export interface WriteResult {
  inserted: number;
  updated: number;
  failed: number;
  durationMs: number;
}

// ============================================================================
// Price Daily
// ============================================================================

export async function writePriceDailyBatch(rows: OHLCVRow[]): Promise<WriteResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0, failed: 0, durationMs: 0 };
  const start = Date.now();
  let inserted = 0;
  let failed = 0;

  // Batch in groups of 500
  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const values = batch.map((r) =>
        sql`(${r.symbol}, ${r.date}::date, ${r.open}, ${r.high}, ${r.low}, ${r.close}, ${r.volume}, ${r.source_tag}, NOW())`
      );
      await db.execute(sql`
        INSERT INTO price_daily (symbol, date, open, high, low, close, volume, source_tag, ingested_at)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (symbol, date) DO UPDATE SET
          open = EXCLUDED.open,
          high = EXCLUDED.high,
          low = EXCLUDED.low,
          close = EXCLUDED.close,
          volume = EXCLUDED.volume,
          source_tag = EXCLUDED.source_tag,
          ingested_at = NOW()
      `);
      inserted += batch.length;
    } catch (err) {
      logger.error({ err, batchStart: i }, "Supabase price_daily batch write failed");
      failed += batch.length;
    }
  }

  return { inserted, updated: 0, failed, durationMs: Date.now() - start };
}

// ============================================================================
// Calculation Results (indicator cache)
// ============================================================================

export interface IndicatorCacheRow {
  symbol: string;
  date: string; // YYYY-MM-DD
  indicatorName: string;
  indicatorValue: number | null;
  indicatorSignal?: number | null;
  indicatorHist?: number | null;
  timeframe?: string;
  parameters?: Record<string, unknown>;
}

export async function writeCalculationResultsBatch(rows: IndicatorCacheRow[]): Promise<WriteResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0, failed: 0, durationMs: 0 };
  const start = Date.now();
  let inserted = 0;
  let failed = 0;

  const BATCH_SIZE = 1000;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      const values = batch.map((r) =>
        sql`(${r.symbol}, ${r.date}::date, ${r.indicatorName}, ${r.indicatorValue ?? null},
             ${r.indicatorSignal ?? null}, ${r.indicatorHist ?? null},
             ${r.timeframe ?? "1d"}, ${r.parameters ? JSON.stringify(r.parameters) : null}::jsonb, NOW())`
      );
      await db.execute(sql`
        INSERT INTO calculation_results
          (symbol, date, indicator_name, indicator_value, indicator_signal, indicator_hist, timeframe, parameters, calculated_at)
        VALUES ${sql.join(values, sql`, `)}
        ON CONFLICT (symbol, date, indicator_name, timeframe) DO UPDATE SET
          indicator_value = EXCLUDED.indicator_value,
          indicator_signal = EXCLUDED.indicator_signal,
          indicator_hist = EXCLUDED.indicator_hist,
          parameters = EXCLUDED.parameters,
          calculated_at = NOW()
      `);
      inserted += batch.length;
    } catch (err) {
      logger.error({ err, batchStart: i }, "Supabase calculation_results batch write failed");
      failed += batch.length;
    }
  }

  return { inserted, updated: 0, failed, durationMs: Date.now() - start };
}

// ============================================================================
// Ingestion Run Tracking
// ============================================================================

export async function startIngestionRun(opts: {
  runId: string;
  source: string;
  pipeline: string;
  metadata?: Record<string, unknown>;
}): Promise<void> {
  await db.execute(sql`
    INSERT INTO ingestion_runs (run_id, source, pipeline, status, metadata)
    VALUES (${opts.runId}, ${opts.source}, ${opts.pipeline}, 'running',
            ${opts.metadata ? JSON.stringify(opts.metadata) : null}::jsonb)
    ON CONFLICT DO NOTHING
  `);
}

export async function completeIngestionRun(opts: {
  runId: string;
  status: "success" | "failed" | "partial";
  symbolsAttempted?: number;
  symbolsSucceeded?: number;
  symbolsFailed?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  errorMessage?: string;
  startedAt: Date;
}): Promise<void> {
  const durationMs = Date.now() - opts.startedAt.getTime();
  await db.execute(sql`
    UPDATE ingestion_runs SET
      status = ${opts.status},
      symbols_attempted = ${opts.symbolsAttempted ?? 0},
      symbols_succeeded = ${opts.symbolsSucceeded ?? 0},
      symbols_failed = ${opts.symbolsFailed ?? 0},
      records_inserted = ${opts.recordsInserted ?? 0},
      records_updated = ${opts.recordsUpdated ?? 0},
      error_message = ${opts.errorMessage ?? null},
      completed_at = NOW(),
      duration_ms = ${durationMs}
    WHERE run_id = ${opts.runId}
  `);
}
