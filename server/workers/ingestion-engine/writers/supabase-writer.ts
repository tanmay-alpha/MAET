/**
 * Supabase Writer — Batched upserts for operational data
 * Handles: daily bars into `candles`, ingestion run tracking
 */

import { db } from "../../../data/drizzle/client";
import { eq, sql } from "drizzle-orm";
import { candles, ingestionRuns } from "../../../db/schema";
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
// Candles
// ============================================================================

/** Validated rows → `candles` values, shaped exactly like the candle service's write. */
export function getCandleInsertValues(rows: OHLCVRow[], timeframe: string): Array<typeof candles.$inferInsert> {
  return rows.map((r) => ({
    symbol: r.symbol,
    timeframe,
    ts: new Date(r.ts),
    open: r.open.toString(),
    high: r.high.toString(),
    low: r.low.toString(),
    close: r.close.toString(),
    volume: r.volume,
    source: r.source_tag,
  }));
}

/**
 * Upsert validated bars into `candles`, the table every chart, screener,
 * breadth and backtest reader uses. Re-running a day overwrites the same
 * (symbol, timeframe, ts) key instead of adding rows.
 */
export async function writeCandlesBatch(rows: OHLCVRow[], timeframe: string): Promise<WriteResult> {
  if (rows.length === 0) return { inserted: 0, updated: 0, failed: 0, durationMs: 0 };
  const start = Date.now();
  let inserted = 0;
  let failed = 0;

  const BATCH_SIZE = 500;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    try {
      await db.insert(candles).values(getCandleInsertValues(batch, timeframe)).onConflictDoUpdate({
        target: [candles.symbol, candles.timeframe, candles.ts],
        set: {
          open: sql`excluded.open`, high: sql`excluded.high`, low: sql`excluded.low`, close: sql`excluded.close`,
          volume: sql`excluded.volume`, source: sql`excluded.source`,
        },
      });
      inserted += batch.length;
    } catch (err) {
      logger.error({ err, batchStart: i }, "candles batch write failed");
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
  /** Source records refused by validation; kept in `metadata.recordsRejected`. */
  recordsRejected?: number;
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

/** Completion facts without a column of their own, merged into the start metadata. */
export function getIngestionRunCompletionMetadata(opts: CompleteIngestionRunOptions): Record<string, unknown> {
  return opts.recordsRejected === undefined ? {} : { recordsRejected: opts.recordsRejected };
}

export async function startIngestionRun(opts: StartIngestionRunOptions): Promise<void> {
  await db.insert(ingestionRuns).values(getIngestionRunStartValues(opts));
}

export async function completeIngestionRun(opts: CompleteIngestionRunOptions): Promise<void> {
  const completedAt = new Date();
  const metadata = getIngestionRunCompletionMetadata(opts);
  await db
    .update(ingestionRuns)
    .set({
      ...getIngestionRunCompletionValues(opts, completedAt),
      ...(Object.keys(metadata).length > 0
        ? { metadata: sql`${ingestionRuns.metadata} || ${JSON.stringify(metadata)}::jsonb` }
        : {}),
    })
    .where(eq(ingestionRuns.batchId, opts.runId));
}
