/**
 * Queue operations for parameter sweeps and walk-forward runs.
 *
 * Claims use FOR UPDATE SKIP LOCKED so concurrent workers never take the same row. These tables have
 * no worker/heartbeat columns: a running job's `updated_at` is its heartbeat, so a RUNNING row whose
 * `updated_at` stops moving is treated as abandoned and requeued (or failed once it is older than
 * ACTIVE_JOB_STALE_AFTER_MS, so a job that keeps killing its worker is not retried forever).
 */

import { and, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import { strategyParameterSweeps, strategyWalkForwardRuns } from "../../db/schema";
import { ACTIVE_JOB_STALE_AFTER_MS, HEARTBEAT_TIMEOUT_MS } from "../strategy-jobs/repository";

function claimedId(result: unknown): string | null {
  const rows = result as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

export async function claimNextSweep(): Promise<string | null> {
  return claimedId(await db.execute(sql`
    UPDATE strategy_parameter_sweeps
    SET status = 'RUNNING', completed_count = 0, updated_at = now()
    WHERE id = (
      SELECT id FROM strategy_parameter_sweeps
      WHERE status = 'QUEUED'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `));
}

export async function claimNextWalkForward(): Promise<string | null> {
  return claimedId(await db.execute(sql`
    UPDATE strategy_walk_forward_runs
    SET status = 'RUNNING', updated_at = now()
    WHERE id = (
      SELECT id FROM strategy_walk_forward_runs
      WHERE status = 'QUEUED'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `));
}

export async function touchSweep(sweepId: string): Promise<void> {
  await db
    .update(strategyParameterSweeps)
    .set({ updatedAt: new Date() })
    .where(and(eq(strategyParameterSweeps.id, sweepId), eq(strategyParameterSweeps.status, "RUNNING")));
}

export async function touchWalkForward(runId: string): Promise<void> {
  await db
    .update(strategyWalkForwardRuns)
    .set({ updatedAt: new Date() })
    .where(and(eq(strategyWalkForwardRuns.id, runId), eq(strategyWalkForwardRuns.status, "RUNNING")));
}

export async function releaseSweep(sweepId: string): Promise<void> {
  await db
    .update(strategyParameterSweeps)
    .set({ status: "QUEUED", completedCount: 0, updatedAt: new Date() })
    .where(and(eq(strategyParameterSweeps.id, sweepId), eq(strategyParameterSweeps.status, "RUNNING")));
}

export async function releaseWalkForward(runId: string): Promise<void> {
  await db
    .update(strategyWalkForwardRuns)
    .set({ status: "QUEUED", updatedAt: new Date() })
    .where(and(eq(strategyWalkForwardRuns.id, runId), eq(strategyWalkForwardRuns.status, "RUNNING")));
}

/** Sweeps have no error column: the status is the only record of a failure. */
export async function failSweep(sweepId: string): Promise<void> {
  await db
    .update(strategyParameterSweeps)
    .set({ status: "FAILED", updatedAt: new Date() })
    .where(eq(strategyParameterSweeps.id, sweepId));
}

export async function failWalkForward(runId: string, error: string): Promise<void> {
  await db
    .update(strategyWalkForwardRuns)
    .set({ status: "FAILED", oosSummary: { error }, updatedAt: new Date() })
    .where(eq(strategyWalkForwardRuns.id, runId));
}

/** Cut-offs shared by the stale-run recovery of both tables. */
function staleWindow(maxStaleMs: number) {
  const now = new Date();
  return { now, heartbeatBefore: new Date(now.getTime() - maxStaleMs), retryableSince: new Date(now.getTime() - ACTIVE_JOB_STALE_AFTER_MS) };
}

export async function recoverStaleSweeps(maxStaleMs: number = HEARTBEAT_TIMEOUT_MS): Promise<number> {
  const { now, heartbeatBefore, retryableSince } = staleWindow(maxStaleMs);
  const t = strategyParameterSweeps;
  const abandoned = and(eq(t.status, "RUNNING"), lt(t.updatedAt, heartbeatBefore));
  await db.update(t).set({ status: "FAILED", updatedAt: now }).where(and(abandoned, lt(t.createdAt, retryableSince)));
  const requeued = await db
    .update(t)
    .set({ status: "QUEUED", completedCount: 0, updatedAt: now })
    .where(and(abandoned, gte(t.createdAt, retryableSince)))
    .returning({ id: t.id });
  return requeued.length;
}

export async function recoverStaleWalkForwards(maxStaleMs: number = HEARTBEAT_TIMEOUT_MS): Promise<number> {
  const { now, heartbeatBefore, retryableSince } = staleWindow(maxStaleMs);
  const t = strategyWalkForwardRuns;
  const abandoned = and(eq(t.status, "RUNNING"), lt(t.updatedAt, heartbeatBefore));
  await db
    .update(t)
    .set({ status: "FAILED", oosSummary: { error: "The run's worker stopped responding and the run is too old to retry." }, updatedAt: now })
    .where(and(abandoned, lt(t.createdAt, retryableSince)));
  const requeued = await db
    .update(t)
    .set({ status: "QUEUED", updatedAt: now })
    .where(and(abandoned, gte(t.createdAt, retryableSince)))
    .returning({ id: t.id });
  return requeued.length;
}
