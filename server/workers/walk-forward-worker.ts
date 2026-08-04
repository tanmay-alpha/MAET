/**
 * Strategy Walk-Forward Worker.
 *
 * Implements anchored and rolling window generators, out-of-sample evaluation,
 * and out-of-sample performance concatenation.
 */

import { db } from "../data/drizzle/client";
import {
  strategyWalkForwardRuns,
  strategyWalkForwardWindows,
  strategyVersions,
  candles,
} from "../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { runBacktestV3 } from "../domain/strategy/runner-v3";
import { generateCombinations, injectParametersIntoAST, type SweepParameterRange } from "./sweep-worker";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { randomUUID } from "crypto";

const WORKER_ID = `wfw-${randomUUID().slice(0, 8)}-${process.pid}`;
const POLL_INTERVAL_MS = 3000;

export interface WalkForwardWindow {
  windowNumber: number;
  trainStart: Date;
  trainEnd: Date;
  valStart: Date;
  valEnd: Date;
}

export function generateWalkForwardWindows(
  startDate: Date,
  endDate: Date,
  windowType: "ANCHORED" | "ROLLING",
  numWindows: number,
  trainRatio = 0.7,
): WalkForwardWindow[] {
  const totalMs = endDate.getTime() - startDate.getTime();
  if (totalMs <= 0 || numWindows <= 0) return [];

  const windowSpanMs = Math.floor(totalMs / numWindows);
  const windows: WalkForwardWindow[] = [];

  for (let i = 0; i < numWindows; i++) {
    const windowStart = windowType === "ANCHORED"
      ? startDate
      : new Date(startDate.getTime() + i * windowSpanMs);

    const windowEnd = new Date(startDate.getTime() + (i + 1) * windowSpanMs);

    const windowDuration = windowEnd.getTime() - windowStart.getTime();
    const trainDuration = Math.floor(windowDuration * trainRatio);

    const trainStart = windowStart;
    const trainEnd = new Date(windowStart.getTime() + trainDuration);
    const valStart = trainEnd;
    const valEnd = windowEnd;

    windows.push({
      windowNumber: i + 1,
      trainStart,
      trainEnd,
      valStart,
      valEnd,
    });
  }

  return windows;
}

async function claimNextWalkForwardJob(workerId: string) {
  const result = await db.execute(sql`
    UPDATE strategy_walk_forward_runs
    SET status = 'RUNNING',
        started_at = now(),
        updated_at = now()
    WHERE id = (
      SELECT id FROM strategy_walk_forward_runs
      WHERE status = 'QUEUED'
      ORDER BY created_at ASC
      LIMIT 1
      FOR UPDATE SKIP LOCKED
    )
    RETURNING *
  `);

  const rows = result as unknown as Record<string, unknown>[];
  if (!rows || rows.length === 0) return null;
  return rows[0];
}

async function fetchCandles(symbol: string, timeframe: string, from: Date, to: Date): Promise<Candle[]> {
  const rows = await db
    .select()
    .from(candles)
    .where(and(eq(candles.symbol, symbol), eq(candles.timeframe, timeframe)))
    .orderBy(desc(candles.ts));

  return rows
    .filter((r) => r.ts >= from && r.ts <= to)
    .map((r) => ({
      symbol: r.symbol,
      tf: r.timeframe as any,
      ts: r.ts.toISOString(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: r.volume ?? 0,
      source: r.source,
    }));
}

export async function processWalkForward(run: any): Promise<void> {
  const runId = run.id as string;
  const userId = run.user_id as string;
  const versionId = run.strategy_version_id as string;
  const windowType = (run.window_type as "ANCHORED" | "ROLLING") ?? "ROLLING";
  const stepCount = (run.step_count as number) ?? 4;
  const ranges = (run.parameter_ranges ?? []) as SweepParameterRange[];
  const symbol = (run.symbol_or_universe as string) ?? "RELIANCE";
  const timeframe = (run.timeframe as string) ?? "1d";
  const fromDate = new Date(run.from_date ?? Date.now() - 180 * 86400000);
  const toDate = new Date(run.to_date ?? Date.now());

  const [versionRow] = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.id, versionId))
    .limit(1);

  if (!versionRow) {
    await db
      .update(strategyWalkForwardRuns)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(strategyWalkForwardRuns.id, runId));
    return;
  }

  const baseDef = versionRow.definition as unknown as StrategyDefinition;
  const windows = generateWalkForwardWindows(fromDate, toDate, windowType, stepCount);
  const combinations = generateCombinations(ranges, 100);

  const windowInserts: any[] = [];
  let totalOutOfSampleReturn = 0;
  let oosSharpeSum = 0;

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];

    // 1. Training Phase: Optimize parameters strictly on training candles
    const trainCandles = await fetchCandles(symbol, timeframe, w.trainStart, w.trainEnd);
    let bestTrainSharpe = -Infinity;
    let bestTrainCombo: Record<string, number> = {};

    if (trainCandles.length >= 30) {
      for (const combo of combinations) {
        const modDef = injectParametersIntoAST(baseDef, combo);
        const res = runBacktestV3({ strategyVersionId: versionId, definition: modDef, symbol, candles: trainCandles });
        if (res.metrics.sharpe > bestTrainSharpe) {
          bestTrainSharpe = res.metrics.sharpe;
          bestTrainCombo = combo;
        }
      }
    }

    // 2. Validation Phase: Evaluate ONLY selected bestTrainCombo on validation candles
    const valCandles = await fetchCandles(symbol, timeframe, w.valStart, w.valEnd);
    let valReturn = 0;
    let valSharpe = 0;
    let valDrawdown = 0;
    let valTrades = 0;

    if (valCandles.length >= 10) {
      const selectedDef = injectParametersIntoAST(baseDef, bestTrainCombo);
      const valRes = runBacktestV3({ strategyVersionId: versionId, definition: selectedDef, symbol, candles: valCandles });
      valReturn = valRes.metrics.totalReturn;
      valSharpe = valRes.metrics.sharpe;
      valDrawdown = valRes.metrics.maxDrawdown;
      valTrades = valRes.tradeCount;
    }

    totalOutOfSampleReturn += valReturn;
    oosSharpeSum += valSharpe;

    windowInserts.push({
      runId,
      userId,
      windowIndex: w.windowNumber,
      trainingFrom: w.trainStart,
      trainingTo: w.trainEnd,
      validationFrom: w.valStart,
      validationTo: w.valEnd,
      selectedParameters: bestTrainCombo,
      trainingMetrics: { sharpe: isFinite(bestTrainSharpe) ? bestTrainSharpe : 0 },
      validationMetrics: {
        return: valReturn,
        sharpe: valSharpe,
        drawdown: valDrawdown,
        tradeCount: valTrades,
      },
    });
  }

  if (windowInserts.length > 0) {
    await db.insert(strategyWalkForwardWindows).values(windowInserts);
  }

  const avgOosSharpe = windows.length > 0 ? oosSharpeSum / windows.length : 0;

  await db
    .update(strategyWalkForwardRuns)
    .set({
      status: "COMPLETED",
      oosSummary: {
        avgOosSharpe: avgOosSharpe.toFixed(4),
        totalOutOfSampleReturn: totalOutOfSampleReturn.toFixed(6),
        overallEfficiencyRatio: (avgOosSharpe / 1.5).toFixed(4),
      },
      updatedAt: new Date(),
    })
    .where(eq(strategyWalkForwardRuns.id, runId));

  console.log(`[walk-forward-worker:${WORKER_ID}] Completed WF run ${runId} (${windows.length} windows)`);
}

let isShuttingDown = false;
async function wfWorkerLoop(): Promise<void> {
  console.log(`[walk-forward-worker] Starting walk-forward worker ${WORKER_ID}`);
  process.on("SIGTERM", () => { isShuttingDown = true; });
  process.on("SIGINT", () => { isShuttingDown = true; });

  while (!isShuttingDown) {
    try {
      const run = await claimNextWalkForwardJob(WORKER_ID);
      if (run) {
        await processWalkForward(run);
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
