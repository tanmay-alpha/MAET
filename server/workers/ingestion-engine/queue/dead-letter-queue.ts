/**
 * Dead Letter Queue
 * Captures failed ingestion records for manual review and retry.
 * Writes to Supabase dead_letter_queue table.
 */

import { db } from "../../../data/drizzle/client";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { deadLetterQueue } from "../../../db/schema";
import { getLogger } from "../../../infra/logger";

const logger = getLogger("dead-letter-queue");

export interface DLQEntry {
  source: string;
  pipeline: string;
  batchId?: string;
  symbol?: string;
  errorCode?: string;
  errorMessage: string;
  rawPayload?: unknown;
}

export interface DLQRecord {
  id: string;
  source: string;
  pipeline: string;
  batchId: string | null;
  symbol?: string;
  errorCode?: string;
  errorMessage: string;
  rawPayload?: unknown;
  retryCount: number;
  lastAttemptedAt: Date;
  resolvedAt: Date | null;
  resolvedBy: string | null;
  resolutionNote: string | null;
  createdAt: Date;
}

export function getDLQInsertValues(entry: DLQEntry): typeof deadLetterQueue.$inferInsert {
  const payload: Record<string, unknown> = {};
  if (entry.symbol !== undefined) payload.symbol = entry.symbol;
  if (entry.errorCode !== undefined) payload.errorCode = entry.errorCode;
  if (entry.rawPayload !== undefined) payload.rawPayload = entry.rawPayload;

  return {
    source: entry.source,
    dataType: entry.pipeline,
    ...(entry.batchId !== undefined ? { batchId: entry.batchId } : {}),
    payload,
    errorMessage: entry.errorMessage,
  };
}

export async function pushToDLQ(entry: DLQEntry): Promise<void> {
  try {
    await db.insert(deadLetterQueue).values(getDLQInsertValues(entry));
  } catch (err) {
    // DLQ push failure must never throw — log and continue
    logger.error({ err, entry }, "Failed to push to DLQ");
  }
}

export function getDLQRecord(row: typeof deadLetterQueue.$inferSelect): DLQRecord {
  const payload = row.payload !== null && typeof row.payload === "object" && !Array.isArray(row.payload)
    ? row.payload as Record<string, unknown>
    : {};
  const hasPayloadField = (field: string) => Object.prototype.hasOwnProperty.call(payload, field);
  const isStructuredPayload = hasPayloadField("symbol")
    || hasPayloadField("errorCode")
    || hasPayloadField("rawPayload");
  const rawPayload = hasPayloadField("rawPayload")
    ? payload.rawPayload
    : isStructuredPayload
      ? undefined
      : row.payload;

  return {
    id: row.id,
    source: row.source,
    pipeline: row.dataType,
    batchId: row.batchId,
    symbol: typeof payload.symbol === "string" ? payload.symbol : undefined,
    errorCode: typeof payload.errorCode === "string" ? payload.errorCode : undefined,
    errorMessage: row.errorMessage,
    rawPayload,
    retryCount: row.retryCount,
    lastAttemptedAt: row.lastAttemptedAt,
    resolvedAt: row.resolvedAt,
    resolvedBy: row.resolvedBy,
    resolutionNote: row.resolutionNote,
    createdAt: row.createdAt,
  };
}

export async function getPendingRetries(source?: string): Promise<DLQRecord[]> {
  const unresolved = isNull(deadLetterQueue.resolvedAt);
  const rows = await db
    .select()
    .from(deadLetterQueue)
    .where(source ? and(unresolved, eq(deadLetterQueue.source, source)) : unresolved)
    .orderBy(asc(deadLetterQueue.createdAt))
    .limit(100);

  return rows.map(getDLQRecord);
}

export function getRetryAttemptValues(
  success: boolean,
  errorMessage: string | undefined,
  attemptedAt: Date,
) {
  if (success) {
    return {
      lastAttemptedAt: attemptedAt,
      resolvedAt: attemptedAt,
    };
  }

  return {
    retryCount: sql`${deadLetterQueue.retryCount} + 1`,
    lastAttemptedAt: attemptedAt,
    ...(errorMessage !== undefined ? { errorMessage } : {}),
  };
}

export async function markRetryAttempt(id: string, success: boolean, errorMessage?: string): Promise<void> {
  const attemptedAt = new Date();
  await db
    .update(deadLetterQueue)
    .set(getRetryAttemptValues(success, errorMessage, attemptedAt))
    .where(eq(deadLetterQueue.id, id));
}

export function getDLQStatsFromRows(rows: Array<{
  source: string;
  total: number;
  pending: number;
  resolved: number;
}>): {
  total: number;
  pending: number;
  resolved: number;
  bySource: Record<string, number>;
} {
  const stats = { total: 0, pending: 0, resolved: 0, bySource: {} as Record<string, number> };
  for (const row of rows) {
    stats.total += row.total;
    stats.pending += row.pending;
    stats.resolved += row.resolved;
    stats.bySource[row.source] = row.total;
  }
  return stats;
}

export async function getDLQStats(): Promise<{
  total: number;
  pending: number;
  resolved: number;
  bySource: Record<string, number>;
}> {
  const rows = await db
    .select({
      source: deadLetterQueue.source,
      total: sql<number>`count(*)::int`,
      pending: sql<number>`count(*) filter (where ${deadLetterQueue.resolvedAt} is null)::int`,
      resolved: sql<number>`count(*) filter (where ${deadLetterQueue.resolvedAt} is not null)::int`,
    })
    .from(deadLetterQueue)
    .groupBy(deadLetterQueue.source);

  return getDLQStatsFromRows(rows.map((row) => ({
    source: row.source,
    total: Number(row.total),
    pending: Number(row.pending),
    resolved: Number(row.resolved),
  })));
}
