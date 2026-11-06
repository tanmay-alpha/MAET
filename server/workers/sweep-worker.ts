/**
 * Strategy Parameter Sweep Worker.
 *
 * Processes queued parameter sweeps by generating parameter combinations,
 * running real backtest V3 executions for each combination, and storing results.
 */

import { db } from "../data/drizzle/client";
import {
  strategyParameterSweeps,
  strategySweepResults,
  strategyVersions,
  candles,
} from "../db/schema";
import { eq, and, desc, asc, gte, lte, sql } from "drizzle-orm";
import { runBacktestV3 } from "../domain/strategy/runner-v3";
import { applyParameters, generateCombinations, type SweepParameter } from "../domain/strategy/parameter-sweep";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { randomUUID } from "crypto";

const WORKER_ID = `sw-${randomUUID().slice(0, 8)}-${process.pid}`;
const POLL_INTERVAL_MS = 3000;

async function claimNextSweepJob(workerId: string) {
  const result = await db.execute(sql`
    UPDATE strategy_parameter_sweeps
    SET status = 'RUNNING',
        updated_at = now()
    WHERE id = (
      SELECT id FROM strategy_parameter_sweeps
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

export async function processSweep(sweep: any): Promise<void> {
  const sweepId = (sweep.id ?? sweep.id) as string;
  const userId = (sweep.userId ?? sweep.user_id) as string;
  const strategyId = (sweep.strategyId ?? sweep.strategy_id) as string;
  // Validated against SweepParameterSchema ({ name, path, values }) when the sweep was created.
  const parameters = (sweep.parameters ?? []) as SweepParameter[];
  const symbol = (sweep.symbolOrUniverse ?? sweep.symbol_or_universe ?? "RELIANCE") as string;
  const timeframe = (sweep.timeframe ?? "1d") as string;
  const fromDate = new Date(sweep.fromDate ?? sweep.from_date ?? Date.now() - 90 * 86400000);
  const toDate = new Date(sweep.toDate ?? sweep.to_date ?? Date.now());

  // Fetch latest version for strategy
  const versionRows = await db
    .select()
    .from(strategyVersions)
    .where(eq(strategyVersions.strategyId, strategyId))
    .orderBy(desc(strategyVersions.versionNumber))
    .limit(1);

  if (versionRows.length === 0) {
    await db
      .update(strategyParameterSweeps)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(strategyParameterSweeps.id, sweepId));
    return;
  }

  const versionRow = versionRows[0];
  const versionId = versionRow.id;
  const baseDef = versionRow.definition as unknown as StrategyDefinition;
  const combinations = generateCombinations(parameters, 500);
  let definitions: StrategyDefinition[];
  try {
    definitions = combinations.map((combo) => applyParameters(baseDef, parameters, combo));
  } catch (err) {
    console.error(`[sweep-worker:${WORKER_ID}] Sweep ${sweepId} has an invalid parameter:`, err);
    await db
      .update(strategyParameterSweeps)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(strategyParameterSweeps.id, sweepId));
    return;
  }

  // Fetch candles
  const candleData = await fetchCandles(symbol, timeframe, fromDate, toDate);
  if (candleData.length < 50) {
    await db
      .update(strategyParameterSweeps)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(strategyParameterSweeps.id, sweepId));
    return;
  }

  const resultsToInsert: any[] = [];

  for (let i = 0; i < combinations.length; i++) {
    const combo = combinations[i];
    const modifiedDef = definitions[i];

    const backtestRes = runBacktestV3({
      strategyVersionId: versionId,
      definition: modifiedDef,
      symbol,
      candles: candleData,
      timeframe,
    });

    const m = backtestRes.metrics;

    resultsToInsert.push({
      sweepId,
      userId,
      parameterValues: combo,
      combinationIndex: i,
      resultSummary: {
        sharpe: isFinite(m.sharpe) ? m.sharpe.toFixed(4) : "0.0000",
        sortino: isFinite(m.sortino) ? m.sortino.toFixed(4) : "0.0000",
        totalReturn: isFinite(m.totalReturn) ? m.totalReturn.toFixed(6) : "0.000000",
        maxDrawdown: isFinite(m.maxDrawdown) ? m.maxDrawdown.toFixed(6) : "0.000000",
        winRate: isFinite(m.winRate) ? m.winRate.toFixed(6) : "0.000000",
        profitFactor: m.profitFactor == null ? null : m.profitFactor.toFixed(4),
        tradeCount: backtestRes.tradeCount,
      },
    });

    if ((i + 1) % 10 === 0 || i === combinations.length - 1) {
      await db
        .update(strategyParameterSweeps)
        .set({ completedCount: i + 1, updatedAt: new Date() })
        .where(eq(strategyParameterSweeps.id, sweepId));
    }
  }

  if (resultsToInsert.length > 0) {
    await db.insert(strategySweepResults).values(resultsToInsert);
  }

  await db
    .update(strategyParameterSweeps)
    .set({
      status: "COMPLETED",
      completedCount: combinations.length,
      updatedAt: new Date(),
    })
    .where(eq(strategyParameterSweeps.id, sweepId));

  console.log(`[sweep-worker:${WORKER_ID}] Completed sweep ${sweepId} (${combinations.length} combinations)`);
}

let isShuttingDown = false;
async function sweepWorkerLoop(): Promise<void> {
  console.log(`[sweep-worker] Starting sweep worker ${WORKER_ID}`);
  process.on("SIGTERM", () => { isShuttingDown = true; });
  process.on("SIGINT", () => { isShuttingDown = true; });

  while (!isShuttingDown) {
    try {
      const sweep = await claimNextSweepJob(WORKER_ID);
      if (sweep) {
        await processSweep(sweep);
      } else {
        await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      }
    } catch (err) {
      console.error(`[sweep-worker] Error in sweep worker loop:`, err);
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
    }
  }

  console.log(`[sweep-worker:${WORKER_ID}] Shutdown complete.`);
  process.exit(0);
}

if (import.meta.main || process.argv[1]?.endsWith("sweep-worker.ts")) {
  sweepWorkerLoop().catch((err) => {
    console.error("[sweep-worker] Fatal error:", err);
    process.exit(1);
  });
}
