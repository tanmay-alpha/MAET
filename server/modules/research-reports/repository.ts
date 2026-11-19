/**
 * Loads completed strategy backtest jobs for research reports and comparisons. Every read is scoped
 * to the requesting user: another user's job, or a job that has not completed, is indistinguishable
 * from one that does not exist (null), so ids cannot be probed.
 */

import { and, asc, desc, eq } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import {
  strategyBacktestJobs,
  strategyBacktestTrades,
  strategyDefinitions,
  strategyEquityPoints,
  strategyPerformanceSnapshots,
  strategyVersions,
} from "../../db/schema";
import type { CompletedRunSummary, RunComparison } from "./contracts";
import { compareRuns, type ComparisonInput } from "./comparison";
import { effectiveCostAssumptions, executionOf, requestedBenchmark, type StoredRun } from "./report";
import { parseRunMetadata } from "./run-metadata";

const COMPLETED = "COMPLETED";

function num(value: string | null): number | null {
  if (value === null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

export async function listCompletedRuns(userId: string, limit = 100): Promise<CompletedRunSummary[]> {
  const rows = await db
    .select({
      job: strategyBacktestJobs,
      versionNumber: strategyVersions.versionNumber,
      strategyId: strategyVersions.strategyId,
      strategyName: strategyDefinitions.name,
      totalReturn: strategyPerformanceSnapshots.totalReturn,
      maxDrawdown: strategyPerformanceSnapshots.maxDrawdown,
      sharpe: strategyPerformanceSnapshots.sharpe,
      tradeCount: strategyPerformanceSnapshots.tradeCount,
    })
    .from(strategyBacktestJobs)
    .innerJoin(strategyVersions, eq(strategyVersions.id, strategyBacktestJobs.strategyVersionId))
    .innerJoin(strategyDefinitions, eq(strategyDefinitions.id, strategyVersions.strategyId))
    .leftJoin(strategyPerformanceSnapshots, eq(strategyPerformanceSnapshots.jobId, strategyBacktestJobs.id))
    .where(and(eq(strategyBacktestJobs.userId, userId), eq(strategyBacktestJobs.status, COMPLETED)))
    .orderBy(desc(strategyBacktestJobs.completedAt), desc(strategyBacktestJobs.id))
    .limit(limit);
  return rows.map((r) => ({
    jobId: r.job.id,
    strategyId: r.strategyId,
    strategyName: r.strategyName,
    versionNumber: r.versionNumber,
    symbolOrUniverse: r.job.symbolOrUniverse,
    timeframe: r.job.timeframe,
    fromDate: r.job.fromDate.toISOString(),
    toDate: r.job.toDate.toISOString(),
    completedAt: r.job.completedAt?.toISOString() ?? null,
    totalReturn: num(r.totalReturn),
    maxDrawdown: num(r.maxDrawdown),
    sharpe: num(r.sharpe),
    tradeCount: r.tradeCount,
  }));
}

/** The user's completed job with everything its report needs, or null. */
export async function loadOwnedRun(userId: string, jobId: string): Promise<StoredRun | null> {
  const [row] = await db
    .select({ job: strategyBacktestJobs, version: strategyVersions, strategyName: strategyDefinitions.name })
    .from(strategyBacktestJobs)
    .innerJoin(strategyVersions, eq(strategyVersions.id, strategyBacktestJobs.strategyVersionId))
    .innerJoin(strategyDefinitions, eq(strategyDefinitions.id, strategyVersions.strategyId))
    .where(and(
      eq(strategyBacktestJobs.id, jobId),
      eq(strategyBacktestJobs.userId, userId),
      eq(strategyBacktestJobs.status, COMPLETED),
      eq(strategyVersions.userId, userId),
    ))
    .limit(1);
  if (!row) return null;

  const [snapshots, trades, equity] = await Promise.all([
    db.select().from(strategyPerformanceSnapshots)
      .where(and(eq(strategyPerformanceSnapshots.jobId, jobId), eq(strategyPerformanceSnapshots.userId, userId)))
      .limit(1),
    db.select().from(strategyBacktestTrades)
      .where(and(eq(strategyBacktestTrades.jobId, jobId), eq(strategyBacktestTrades.userId, userId)))
      .orderBy(asc(strategyBacktestTrades.entryFillTimestamp)),
    db.select().from(strategyEquityPoints)
      .where(and(eq(strategyEquityPoints.jobId, jobId), eq(strategyEquityPoints.userId, userId)))
      .orderBy(asc(strategyEquityPoints.timestamp)),
  ]);

  const { job, version } = row;
  return {
    job: {
      id: job.id,
      runId: job.runId,
      symbolOrUniverse: job.symbolOrUniverse,
      timeframe: job.timeframe,
      fromDate: job.fromDate,
      toDate: job.toDate,
      initialCapital: job.initialCapital,
      benchmarkSymbol: job.benchmarkSymbol,
      requestedAt: job.requestedAt,
      completedAt: job.completedAt,
      reproducibilityMetadata: parseRunMetadata(job.reproducibilityMetadata),
      warnings: job.warnings,
    },
    version: {
      id: version.id,
      strategyId: version.strategyId,
      strategyName: row.strategyName,
      versionNumber: version.versionNumber,
      definition: version.definition,
      definitionHash: version.definitionHash,
      engineVersion: version.engineVersion,
      indicatorVersion: version.indicatorVersion,
      schemaVersion: version.schemaVersion,
    },
    snapshot: snapshots[0] ?? null,
    trades,
    equity,
  };
}

function comparisonInputOf(run: StoredRun): ComparisonInput {
  return {
    jobId: run.job.id,
    label: `${run.version.strategyName} v${run.version.versionNumber} · ${run.job.symbolOrUniverse} ${run.job.timeframe}`,
    symbolOrUniverse: run.job.symbolOrUniverse,
    timeframe: run.job.timeframe,
    engineVersion: run.job.reproducibilityMetadata?.engineVersion ?? run.snapshot?.engineVersion ?? null,
    benchmarkSymbol: requestedBenchmark(run.job, run.version.definition),
    costAssumptions: effectiveCostAssumptions(executionOf(run.version.definition)),
    equity: run.equity.map((p) => ({ timestamp: p.timestamp.toISOString(), equity: Number(p.equity) })),
    trades: run.trades.map((t) => ({
      entryFillTs: t.entryFillTimestamp?.toISOString() ?? null,
      entryPrice: Number(t.entryPrice),
      entryQuantity: Number(t.entryQuantity),
      exitPrice: num(t.exitPrice),
      exitQuantity: num(t.exitQuantity),
      fees: Number(t.fees),
      slippage: Number(t.slippage),
    })),
  };
}

/**
 * Compares the user's completed runs, in the order given. Null when any id is not one of them,
 * without saying which.
 */
export async function compareOwnedRuns(userId: string, jobIds: readonly string[]): Promise<RunComparison | null> {
  const runs = await Promise.all(jobIds.map((id) => loadOwnedRun(userId, id)));
  if (runs.some((r) => r === null)) return null;
  return compareRuns((runs as StoredRun[]).map(comparisonInputOf));
}
