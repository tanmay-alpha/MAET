/**
 * Strategy Backtest Jobs Repository — durable job queue with PostgreSQL.
 *
 * Atomic claim: FOR UPDATE SKIP LOCKED ensures only one worker claims each job.
 * Heartbeat: workers update heartbeat_at to signal liveness.
 * Recovery: abandoned jobs (heartbeat timeout) are returned to QUEUED.
 * Cancellation: cancel_requested_at is checked by worker loop.
 */

import { db } from "../../data/drizzle/client";
import { strategyBacktestJobs, strategyVersions } from "../../db/schema";
import { eq, and, lt, sql, isNull } from "drizzle-orm";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

const HEARTBEAT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface BacktestJobRow {
  id: string;
  userId: string;
  strategyVersionId: string;
  status: string;
  symbolOrUniverse: string;
  timeframe: string;
  fromDate: Date;
  toDate: Date;
  initialCapital: string | null;
  benchmarkSymbol: string | null;
  progress: number;
  errorCode: string | null;
  errorSummary: string | null;
  requestedAt: Date;
  startedAt: Date | null;
  completedAt: Date | null;
  cancelRequestedAt: Date | null;
  workerId: string | null;
  heartbeatAt: Date | null;
  runId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

// ============================================================
// Create job
// ============================================================

export async function createJob(
  userId: string,
  strategyVersionId: string,
  symbolOrUniverse: string,
  timeframe: string,
  fromDate: Date,
  toDate: Date,
  initialCapital?: number,
  benchmarkSymbol?: string,
): Promise<BacktestJobRow> {
  const [row] = await db
    .insert(strategyBacktestJobs)
    .values({
      userId,
      strategyVersionId,
      status: "QUEUED",
      symbolOrUniverse,
      timeframe,
      fromDate,
      toDate,
      initialCapital: initialCapital?.toString(),
      benchmarkSymbol: benchmarkSymbol ?? null,
      progress: 0,
    })
    .returning();
  return row as unknown as BacktestJobRow;
}

// ============================================================
// Atomic claim (FOR UPDATE SKIP LOCKED)
// ============================================================

export async function claimNextJob(workerId: string): Promise<BacktestJobRow | null> {
  const result = await db.execute(sql`
    UPDATE strategy_backtest_jobs
    SET status = 'RUNNING',
        worker_id = ${workerId},
        started_at = now(),
        heartbeat_at = now(),
        updated_at = now()
    WHERE id = (
      SELECT id FROM strategy_backtest_jobs
      WHERE status = 'QUEUED'
        AND cancel_requested_at IS NULL
      ORDER BY requested_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const rows = result as unknown as Record<string, unknown>[];
  if (!rows || rows.length === 0) return null;
  const row = rows[0];
  return {
    id: row.id as string,
    userId: row.user_id as string,
    strategyVersionId: row.strategy_version_id as string,
    status: row.status as string,
    symbolOrUniverse: row.symbol_or_universe as string,
    timeframe: row.timeframe as string,
    fromDate: new Date(row.from_date as string | Date),
    toDate: new Date(row.to_date as string | Date),
    initialCapital: row.initial_capital ? String(row.initial_capital) : null,
    benchmarkSymbol: (row.benchmark_symbol as string) ?? null,
    progress: Number(row.progress ?? 0),
    errorCode: (row.error_code as string) ?? null,
    errorSummary: (row.error_summary as string) ?? null,
    requestedAt: new Date(row.requested_at as string | Date),
    startedAt: row.started_at ? new Date(row.started_at as string | Date) : null,
    completedAt: row.completed_at ? new Date(row.completed_at as string | Date) : null,
    cancelRequestedAt: row.cancel_requested_at ? new Date(row.cancel_requested_at as string | Date) : null,
    workerId: (row.worker_id as string) ?? null,
    heartbeatAt: row.heartbeat_at ? new Date(row.heartbeat_at as string | Date) : null,
    runId: (row.run_id as string) ?? null,
    createdAt: new Date(row.created_at as string | Date),
    updatedAt: new Date(row.updated_at as string | Date),
  };
}

// ============================================================
// Heartbeat
// ============================================================

export async function updateHeartbeat(jobId: string): Promise<void> {
  await db
    .update(strategyBacktestJobs)
    .set({ heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(strategyBacktestJobs.id, jobId));
}

// ============================================================
// Progress update
// ============================================================

export async function updateProgress(jobId: string, progress: number): Promise<void> {
  await db
    .update(strategyBacktestJobs)
    .set({ progress: Math.min(99, Math.max(0, progress)), heartbeatAt: new Date(), updatedAt: new Date() })
    .where(eq(strategyBacktestJobs.id, jobId));
}

// ============================================================
// Complete
// ============================================================

export async function completeJob(jobId: string, runId: string): Promise<void> {
  await db
    .update(strategyBacktestJobs)
    .set({
      status: "COMPLETED",
      progress: 100,
      completedAt: new Date(),
      runId,
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(strategyBacktestJobs.id, jobId));
}

// ============================================================
// Fail
// ============================================================

export function redactSqlKeywords(text: string): string {
  const redacted = text.replace(/SELECT|INSERT|UPDATE|DELETE|FROM|WHERE|DROP|TRUNCATE|ALTER/gi, "[REDACTED]");
  return redacted.length > 500 ? `${redacted.slice(0, 497)}...` : redacted;
}

export async function markFailed(
  jobId: string,
  errorCode: string,
  errorSummary: string,
): Promise<void> {
  await db
    .update(strategyBacktestJobs)
    .set({
      status: "FAILED",
      errorCode,
      errorSummary: redactSqlKeywords(errorSummary),
      completedAt: new Date(),
      heartbeatAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(strategyBacktestJobs.id, jobId));
}

// ============================================================
// Cancel
// ============================================================

export async function requestCancellation(userId: string, jobId: string): Promise<boolean> {
  const result = await db
    .update(strategyBacktestJobs)
    .set({ cancelRequestedAt: new Date(), updatedAt: new Date() })
    .where(and(
      eq(strategyBacktestJobs.id, jobId),
      eq(strategyBacktestJobs.userId, userId),
    ))
    .returning();
  return result.length > 0;
}

export async function isCancellationRequested(jobId: string): Promise<boolean> {
  const [row] = await db
    .select({ cancelRequestedAt: strategyBacktestJobs.cancelRequestedAt })
    .from(strategyBacktestJobs)
    .where(eq(strategyBacktestJobs.id, jobId))
    .limit(1);
  return row?.cancelRequestedAt != null;
}

export async function markCancelled(jobId: string): Promise<void> {
  await db
    .update(strategyBacktestJobs)
    .set({ status: "CANCELLED", completedAt: new Date(), updatedAt: new Date() })
    .where(eq(strategyBacktestJobs.id, jobId));
}

// ============================================================
// Abandoned job recovery
// ============================================================

export async function recoverAbandonedJobs(maxStaleMs: number = HEARTBEAT_TIMEOUT_MS): Promise<number> {
  const cutoff = new Date(Date.now() - maxStaleMs);
  const result = await db
    .update(strategyBacktestJobs)
    .set({
      status: "QUEUED",
      workerId: null,
      startedAt: null,
      heartbeatAt: null,
      updatedAt: new Date(),
    })
    .where(and(
      eq(strategyBacktestJobs.status, "RUNNING"),
      lt(strategyBacktestJobs.heartbeatAt, cutoff),
    ))
    .returning();
  return result.length;
}

// ============================================================
// Get job with version definition
// ============================================================

export async function getJobWithVersion(jobId: string): Promise<{
  job: BacktestJobRow;
  definition: StrategyDefinition;
} | null> {
  const result = await db
    .select({
      job: strategyBacktestJobs,
      definition: strategyVersions.definition,
    })
    .from(strategyBacktestJobs)
    .innerJoin(strategyVersions, eq(strategyBacktestJobs.strategyVersionId, strategyVersions.id))
    .where(eq(strategyBacktestJobs.id, jobId))
    .limit(1);

  if (!result[0]) return null;
  return {
    job: result[0].job as unknown as BacktestJobRow,
    definition: result[0].definition as unknown as StrategyDefinition,
  };
}
