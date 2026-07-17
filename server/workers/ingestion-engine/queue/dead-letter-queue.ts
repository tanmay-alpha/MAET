/**
 * Dead Letter Queue
 * Captures failed ingestion records for manual review and retry.
 * Writes to Supabase dead_letter_queue table.
 */

import { db } from "../../../data/drizzle/client";
import { sql } from "drizzle-orm";
import { getLogger } from "../../../infra/logger";

const logger = getLogger("dead-letter-queue");

export interface DLQEntry {
  source: string;
  pipeline: string;
  symbol?: string;
  errorCode: string;
  errorMessage: string;
  rawPayload?: unknown;
  maxRetries?: number;
}

export interface DLQRecord extends DLQEntry {
  id: string;
  retryCount: number;
  nextRetryAt: Date | null;
  resolved: boolean;
  createdAt: Date;
}

export async function pushToDLQ(entry: DLQEntry): Promise<void> {
  try {
    const nextRetryAt = new Date(Date.now() + 60_000); // 1 min initial backoff
    await db.execute(sql`
      INSERT INTO dead_letter_queue
        (source, pipeline, symbol, error_code, error_message, raw_payload, max_retries, next_retry_at)
      VALUES
        (${entry.source}, ${entry.pipeline}, ${entry.symbol ?? null},
         ${entry.errorCode}, ${entry.errorMessage},
         ${entry.rawPayload ? JSON.stringify(entry.rawPayload) : null}::jsonb,
         ${entry.maxRetries ?? 3}, ${nextRetryAt.toISOString()})
    `);
  } catch (err) {
    // DLQ push failure must never throw — log and continue
    logger.error({ err, entry }, "Failed to push to DLQ");
  }
}

export async function getPendingRetries(source?: string): Promise<DLQRecord[]> {
  const now = new Date().toISOString();
  const rows = await db.execute(sql`
    SELECT id, source, pipeline, symbol, error_code, error_message,
           raw_payload, retry_count, max_retries, next_retry_at, resolved, created_at
    FROM dead_letter_queue
    WHERE resolved = false
      AND retry_count < max_retries
      AND (next_retry_at IS NULL OR next_retry_at <= ${now}::timestamptz)
      ${source ? sql`AND source = ${source}` : sql``}
    ORDER BY created_at ASC
    LIMIT 100
  `);

  return (rows as any[]).map((r) => ({
    id: r.id,
    source: r.source,
    pipeline: r.pipeline,
    symbol: r.symbol,
    errorCode: r.error_code,
    errorMessage: r.error_message,
    rawPayload: r.raw_payload,
    retryCount: r.retry_count,
    maxRetries: r.max_retries,
    nextRetryAt: r.next_retry_at ? new Date(r.next_retry_at) : null,
    resolved: r.resolved,
    createdAt: new Date(r.created_at),
  }));
}

export async function markRetryAttempt(id: string, success: boolean, errorMessage?: string): Promise<void> {
  if (success) {
    await db.execute(sql`
      UPDATE dead_letter_queue
      SET resolved = true, resolved_at = NOW()
      WHERE id = ${id}::uuid
    `);
  } else {
    // Exponential backoff: 1min, 5min, 15min
    const retryResult = await db.execute(sql`
      SELECT retry_count FROM dead_letter_queue WHERE id = ${id}::uuid
    `);
    const retryCount = ((retryResult as any[])[0]?.retry_count ?? 0) + 1;
    const backoffMs = Math.min(60_000 * Math.pow(5, retryCount), 15 * 60_000);
    const nextRetryAt = new Date(Date.now() + backoffMs);
    await db.execute(sql`
      UPDATE dead_letter_queue
      SET retry_count = retry_count + 1,
          next_retry_at = ${nextRetryAt.toISOString()}::timestamptz,
          error_message = COALESCE(${errorMessage ?? null}, error_message)
      WHERE id = ${id}::uuid
    `);
  }
}

export async function getDLQStats(): Promise<{
  total: number;
  pending: number;
  resolved: number;
  bySource: Record<string, number>;
}> {
  const rows = await db.execute(sql`
    SELECT source, resolved, COUNT(*)::int as count
    FROM dead_letter_queue
    GROUP BY source, resolved
  `);

  const stats = { total: 0, pending: 0, resolved: 0, bySource: {} as Record<string, number> };
  for (const r of rows as any[]) {
    stats.total += r.count;
    if (r.resolved) stats.resolved += r.count;
    else stats.pending += r.count;
    stats.bySource[r.source] = (stats.bySource[r.source] ?? 0) + r.count;
  }
  return stats;
}
