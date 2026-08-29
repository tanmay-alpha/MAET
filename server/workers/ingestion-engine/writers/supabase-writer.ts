/**
 * Supabase Writer — Batched upserts for operational data
 * Handles: price_daily, companies, financial_statements, fundamentals, calculation_results
 */

import { db } from "../../../data/drizzle/client";
import { eq, sql } from "drizzle-orm";
import { ingestionRuns } from "../../../db/schema";
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

interface StartIngestionRunOptions {
  runId: string;
  source: string;
  pipeline: string;
  metadata?: Record<string, unknown>;
}

interface CompleteIngestionRunOptions {
  runId: string;
  status: "success" | "failed" | "partial";
  symbolsAttempted?: number;
  symbolsSucceeded?: number;
  symbolsFailed?: number;
  recordsInserted?: number;
  recordsUpdated?: number;
  errorMessage?: string;
  startedAt: Date;
}

export function getIngestionRunStartValues(
  opts: StartIngestionRunOptions,
): typeof ingestionRuns.$inferInsert {
  return {
    batchId: opts.runId,
    source: opts.source,
    dataType: opts.pipeline,
    operation: "ingest",
    status: "running",
    metadata: opts.metadata ?? {},
  };
}

export function getIngestionRunCompletionValues(
  opts: CompleteIngestionRunOptions,
  completedAt: Date,
) {
  return {
    status: opts.status === "success" ? "succeeded" : opts.status,
    attempted: opts.symbolsAttempted ?? 0,
    failed: opts.symbolsFailed ?? 0,
    inserted: opts.recordsInserted ?? 0,
    updated: opts.recordsUpdated ?? 0,
    errorSummary: opts.errorMessage ?? null,
    completedAt,
    durationMs: completedAt.getTime() - opts.startedAt.getTime(),
  };
}

export async function startIngestionRun(opts: StartIngestionRunOptions): Promise<void> {
  await db.insert(ingestionRuns).values(getIngestionRunStartValues(opts));
}

export async function completeIngestionRun(opts: CompleteIngestionRunOptions): Promise<void> {
  const completedAt = new Date();
  await db
    .update(ingestionRuns)
    .set(getIngestionRunCompletionValues(opts, completedAt))
    .where(eq(ingestionRuns.batchId, opts.runId));
}
