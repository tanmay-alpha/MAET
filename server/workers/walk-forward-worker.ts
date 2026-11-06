/**
 * Strategy Walk-Forward Worker.
 *
 * Claims queued strategy_walk_forward_runs, runs them through the walk-forward engine
 * (server/domain/strategy/walk-forward.ts) on the strategy's latest version, and persists each
 * window's training, validation and out-of-sample test results.
 */

import { db } from "../data/drizzle/client";
import {
  strategyWalkForwardRuns,
  strategyWalkForwardWindows,
  strategyVersions,
  candles,
} from "../db/schema";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import { runWalkForwardAnalysis, type WalkForwardAnalysisResult } from "../domain/strategy/walk-forward";
import type { SweepParameter } from "../domain/strategy/parameter-sweep";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { randomUUID } from "crypto";

const WORKER_ID = `wfw-${randomUUID().slice(0, 8)}-${process.pid}`;
const POLL_INTERVAL_MS = 3000;

/** Share of each window's training segment held out for the engine's validation phase. */
const VALIDATION_SHARE_OF_TRAINING = 0.25;

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

export async function claimNextWalkForwardJob() {
  const result = await db.execute(sql`
    UPDATE strategy_walk_forward_runs
    SET status = 'RUNNING',
        updated_at = now()
    WHERE id = (
      SELECT id FROM strategy_walk_forward_runs
      WHERE status = 'QUEUED'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id
  `);

  const rows = result as unknown as Array<{ id: string }>;
  return rows[0]?.id ?? null;
}

async function fetchCandles(symbol: string, timeframe: string, from: Date, to: Date): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(candles)
    .where(
      and(
        eq(candles.symbol, symbol),
        eq(candles.timeframe, timeframe),
        gte(candles.ts, from),
        lte(candles.ts, to),
      ),
    )
    .orderBy(asc(candles.ts));

  return rows.map((r) => ({
    symbol: r.symbol,
    tf: r.timeframe as Candle["tf"],
    ts: r.ts.toISOString(),
    open: Number(r.open),
    high: Number(r.high),
    low: Number(r.low),
    close: Number(r.close),
    volume: r.volume ?? 0,
    source: r.source,
  }));
}

export async function processWalkForward(runId: string): Promise<void> {
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

    const candleData = await fetchCandles(run.symbol, run.timeframe, run.fromDate, run.toDate);
    const result = runWalkForwardAnalysis({
      strategyVersionId: version.id,
      definition: version.definition as StrategyDefinition,
      symbol: run.symbol,
      candles: candleData,
      // Validated against SweepParameterSchema when the run was created.
      parameters: run.parameters as SweepParameter[],
      timeframe: run.timeframe,
      ...walkForwardEngineConfig({
        mode: run.mode as WalkForwardRunSettings["mode"],
        windowCount: run.windowCount,
        trainingDays: run.trainingDays,
        validationDays: run.validationDays,
      }),
    });

    const windowRows = walkForwardWindowRows(run.id, run.userId, result);
    if (windowRows.length > 0) {
      await db.insert(strategyWalkForwardWindows).values(windowRows);
    }
    await db
      .update(strategyWalkForwardRuns)
      .set({ status: "COMPLETED", oosSummary: { ...result.summary, warnings: result.warnings }, updatedAt: new Date() })
      .where(eq(strategyWalkForwardRuns.id, run.id));

    console.log(`[walk-forward-worker:${WORKER_ID}] Completed WF run ${run.id} (${result.windows.length} windows)`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[walk-forward-worker:${WORKER_ID}] WF run ${run.id} failed:`, err);
    await db
      .update(strategyWalkForwardRuns)
      .set({ status: "FAILED", oosSummary: { error: message }, updatedAt: new Date() })
      .where(eq(strategyWalkForwardRuns.id, run.id));
  }
}

let isShuttingDown = false;
async function wfWorkerLoop(): Promise<void> {
  console.log(`[walk-forward-worker] Starting walk-forward worker ${WORKER_ID}`);
  process.on("SIGTERM", () => { isShuttingDown = true; });
  process.on("SIGINT", () => { isShuttingDown = true; });

  while (!isShuttingDown) {
    try {
      const runId = await claimNextWalkForwardJob();
      if (runId) {
        await processWalkForward(runId);
      } else {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    } catch (err) {
      console.error(`[walk-forward-worker] Error in walk-forward worker loop:`, err);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  console.log(`[walk-forward-worker:${WORKER_ID}] Shutdown complete.`);
  process.exit(0);
}

if (import.meta.main || process.argv[1]?.endsWith("walk-forward-worker.ts")) {
  wfWorkerLoop().catch((err) => {
    console.error("[walk-forward-worker] Fatal error:", err);
    process.exit(1);
  });
}
