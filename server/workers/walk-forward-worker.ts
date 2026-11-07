/**
 * Strategy walk-forward job: runs one claimed strategy_walk_forward_runs row through the walk-forward
 * engine (server/domain/strategy/walk-forward.ts) on the strategy's latest version, and persists each
 * window's training, validation and out-of-sample test results plus the run summary.
 *
 * The job runner (server/modules/strategy-jobs/runner.ts) claims the row, heartbeats it and owns
 * shutdown / time-budget handling; the engine awaits `ctx.checkpoint()` after every backtest so the
 * runner can interrupt it and the event loop stays responsive.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../data/drizzle/client";
import { strategyWalkForwardRuns, strategyWalkForwardWindows, strategyVersions } from "../db/schema";
import { runWalkForwardAnalysis, type WalkForwardAnalysisResult } from "../domain/strategy/walk-forward";
import { parseStoredSweepParameters } from "../domain/strategy/parameter-sweep";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import { loadJobCandles } from "../modules/strategy-jobs/candles";
import { downsample } from "../modules/strategy-jobs/downsample";
import { JobInterruptedError, type JobContext } from "../modules/strategy-jobs/job-context";
import { failWalkForward } from "../modules/strategy-optimisation/repository";

/** Share of each window's training segment held out for the engine's validation phase. */
const VALIDATION_SHARE_OF_TRAINING = 0.25;
/** Points of the aggregate out-of-sample equity curve kept in the run summary for charting. */
const MAX_OOS_CURVE_POINTS = 500;

export interface WalkForwardRunSettings {
  mode: "ANCHORED" | "ROLLING";
  windowCount: number;
  trainingDays: number;
  validationDays: number;
}

/**
 * Maps a run's settings onto the 3-phase engine. The API's "validation" days are the
 * out-of-sample test segment; the last quarter of the training days becomes the engine's
 * validation (overfit rejection) phase, so the train : validation : test proportions follow the
 * requested training and validation lengths.
 */
export function walkForwardEngineConfig(run: WalkForwardRunSettings) {
  const span = run.trainingDays + run.validationDays;
  return {
    windowType: run.mode,
    numWindows: run.windowCount,
    trainRatio: (run.trainingDays * (1 - VALIDATION_SHARE_OF_TRAINING)) / span,
    valRatio: (run.trainingDays * VALIDATION_SHARE_OF_TRAINING) / span,
  };
}

export function walkForwardWindowRows(runId: string, userId: string, result: WalkForwardAnalysisResult) {
  return result.windows.map((w) => ({
    runId,
    userId,
    windowIndex: w.windowNumber,
    trainingFrom: new Date(w.trainDates.from),
    trainingTo: new Date(w.trainDates.to),
    validationFrom: new Date(w.valDates.from),
    validationTo: new Date(w.valDates.to),
    testFrom: new Date(w.testDates.from),
    testTo: new Date(w.testDates.to),
    selectedParameters: w.selectedParameters,
    trainingMetrics: w.isMetrics,
    validationMetrics: { metrics: w.valMetrics, accepted: w.validationAccepted, rejectionReason: w.rejectionReason },
    testMetrics: w.oosMetrics,
  }));
}

/** The run's stored `oos_summary`: engine summary, warnings and a chartable aggregate OOS curve. */
export function walkForwardRunSummary(result: WalkForwardAnalysisResult) {
  return {
    ...result.summary,
    warnings: result.warnings,
    oosEquityCurve: downsample(result.aggregateOosEquityCurve, MAX_OOS_CURVE_POINTS).map((p) => ({
      timestamp: p.timestamp,
      equity: p.equity,
    })),
  };
}

export async function runWalkForwardJob(runId: string, ctx: JobContext): Promise<void> {
  const [run] = await db.select().from(strategyWalkForwardRuns).where(eq(strategyWalkForwardRuns.id, runId)).limit(1);
  if (!run) return;

  try {
    const [version] = await db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, run.strategyId))
      .orderBy(desc(strategyVersions.versionNumber))
      .limit(1);
    if (!version) throw new Error("Strategy has no saved version to walk forward");
    if (version.userId !== run.userId) throw new Error("Strategy version does not belong to the run's owner");
    const parameters = parseStoredSweepParameters(run.parameters);

    const candleData = await loadJobCandles(run.symbol, run.timeframe, run.fromDate, run.toDate);
    const result = await runWalkForwardAnalysis(
      {
        strategyVersionId: version.id,
        definition: version.definition as StrategyDefinition,
        symbol: run.symbol,
        candles: candleData,
        parameters,
        timeframe: run.timeframe,
        ...walkForwardEngineConfig({
          mode: run.mode as WalkForwardRunSettings["mode"],
          windowCount: run.windowCount,
          trainingDays: run.trainingDays,
          validationDays: run.validationDays,
        }),
      },
      { yieldControl: () => ctx.checkpoint() },
    );

    const windowRows = walkForwardWindowRows(run.id, run.userId, result);
    await db.transaction(async (tx) => {
      const [owned] = await tx
        .update(strategyWalkForwardRuns)
        .set({ status: "COMPLETED", oosSummary: walkForwardRunSummary(result), updatedAt: new Date() })
        .where(and(eq(strategyWalkForwardRuns.id, run.id), eq(strategyWalkForwardRuns.status, "RUNNING")))
        .returning({ id: strategyWalkForwardRuns.id });
      if (!owned) throw new JobInterruptedError("LEASE_LOST");
      if (windowRows.length > 0) await tx.insert(strategyWalkForwardWindows).values(windowRows);
    });

    console.log(`[strategy-jobs] Completed walk-forward run ${run.id} (${result.windows.length} windows)`);
  } catch (err) {
    if (err instanceof JobInterruptedError) throw err;
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[strategy-jobs] Walk-forward run ${run.id} failed:`, err);
    await failWalkForward(run.id, message);
  }
}
