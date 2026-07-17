/**
 * Write Coordinator — Fan-out: one validated record → Supabase + BigQuery in parallel
 */

import { getLogger } from "../../../infra/logger";
import { writePriceDailyBatch, writeCalculationResultsBatch } from "./supabase-writer";
import { writeMarketTicksBQ, writeIndicatorValuesBQ } from "./bigquery-writer";
import { pushToDLQ } from "../queue/dead-letter-queue";
import type { OHLCVRow } from "../validators/schema-validator";
import type { IndicatorCacheRow } from "./supabase-writer";

const logger = getLogger("write-coordinator");

export interface CoordinatorResult {
  supabase: { inserted: number; failed: number; durationMs: number };
  bigquery: { rowsStreamed: number; failed: number; durationMs: number };
  totalDurationMs: number;
}

/**
 * Fan-out validated OHLCV rows to both Supabase and BigQuery simultaneously.
 * Failures in one store do not block the other.
 */
export async function coordinateOHLCVWrite(
  rows: OHLCVRow[],
  source: string,
  pipeline: string,
  timeframe = "1d"
): Promise<CoordinatorResult> {
  if (rows.length === 0) {
    return {
      supabase: { inserted: 0, failed: 0, durationMs: 0 },
      bigquery: { rowsStreamed: 0, failed: 0, durationMs: 0 },
      totalDurationMs: 0,
    };
  }

  const start = Date.now();
  const [sbResult, bqResult] = await Promise.allSettled([
    writePriceDailyBatch(rows),
    writeMarketTicksBQ(rows, timeframe),
  ]);

  const supabase = sbResult.status === "fulfilled"
    ? { inserted: sbResult.value.inserted, failed: sbResult.value.failed, durationMs: sbResult.value.durationMs }
    : { inserted: 0, failed: rows.length, durationMs: 0 };

  const bigquery = bqResult.status === "fulfilled"
    ? { rowsStreamed: bqResult.value.rowsStreamed, failed: bqResult.value.failed, durationMs: bqResult.value.durationMs }
    : { rowsStreamed: 0, failed: rows.length, durationMs: 0 };

  if (sbResult.status === "rejected") {
    logger.error({ err: sbResult.reason }, "Supabase fan-out failed");
    await pushToDLQ({
      source,
      pipeline,
      errorCode: "SUPABASE_WRITE_FAILED",
      errorMessage: (sbResult.reason as Error).message,
      rawPayload: { rowCount: rows.length },
    });
  }

  if (bqResult.status === "rejected") {
    logger.warn({ err: bqResult.reason }, "BigQuery fan-out failed (non-critical)");
    // BigQuery failures are logged but don't go to DLQ (it's analytics, not operational)
  }

  return {
    supabase,
    bigquery,
    totalDurationMs: Date.now() - start,
  };
}

/**
 * Fan-out indicator results to Supabase cache and BigQuery analytics.
 */
export async function coordinateIndicatorWrite(
  rows: IndicatorCacheRow[],
  source: string,
  pipeline: string
): Promise<CoordinatorResult> {
  if (rows.length === 0) {
    return {
      supabase: { inserted: 0, failed: 0, durationMs: 0 },
      bigquery: { rowsStreamed: 0, failed: 0, durationMs: 0 },
      totalDurationMs: 0,
    };
  }

  const start = Date.now();
  const [sbResult, bqResult] = await Promise.allSettled([
    writeCalculationResultsBatch(rows),
    writeIndicatorValuesBQ(rows),
  ]);

  const supabase = sbResult.status === "fulfilled"
    ? { inserted: sbResult.value.inserted, failed: sbResult.value.failed, durationMs: sbResult.value.durationMs }
    : { inserted: 0, failed: rows.length, durationMs: 0 };

  const bigquery = bqResult.status === "fulfilled"
    ? { rowsStreamed: bqResult.value.rowsStreamed, failed: bqResult.value.failed, durationMs: bqResult.value.durationMs }
    : { rowsStreamed: 0, failed: rows.length, durationMs: 0 };

  if (sbResult.status === "rejected") {
    logger.error({ err: sbResult.reason }, "Supabase indicator write failed");
    await pushToDLQ({
      source,
      pipeline,
      errorCode: "INDICATOR_WRITE_FAILED",
      errorMessage: (sbResult.reason as Error).message,
      rawPayload: { rowCount: rows.length },
    });
  }

  return {
    supabase,
    bigquery,
    totalDurationMs: Date.now() - start,
  };
}
