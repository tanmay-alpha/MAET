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
import { eq, and, desc, sql } from "drizzle-orm";
import { runBacktestV3 } from "../domain/strategy/runner-v3";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import type { Candle } from "@shared/types";
import { randomUUID } from "crypto";

const WORKER_ID = `sw-${randomUUID().slice(0, 8)}-${process.pid}`;
const POLL_INTERVAL_MS = 3000;

export interface SweepParameterRange {
  name: string; // e.g. "rsiPeriod" or "fastMa"
  min: number;
  max: number;
  step: number;
}

export function generateCombinations(ranges: SweepParameterRange[], maxCombinations = 500): Record<string, number>[] {
  if (!ranges || ranges.length === 0) return [{}];

  function getValues(r: SweepParameterRange): number[] {
    const vals: number[] = [];
    const step = r.step > 0 ? r.step : 1;
    for (let v = r.min; v <= r.max; v += step) {
      vals.push(Number(v.toFixed(4)));
    }
    return vals.length > 0 ? vals : [r.min];
  }

  const rangeValues = ranges.map((r) => ({ name: r.name, values: getValues(r) }));

  let combinations: Record<string, number>[] = [{}];
  for (const range of rangeValues) {
    const nextCombinations: Record<string, number>[] = [];
    for (const combo of combinations) {
      for (const val of range.values) {
        nextCombinations.push({ ...combo, [range.name]: val });
        if (nextCombinations.length >= maxCombinations) break;
      }
      if (nextCombinations.length >= maxCombinations) break;
    }
    combinations = nextCombinations;
    if (combinations.length >= maxCombinations) break;
  }

  return combinations.slice(0, maxCombinations);
}

export function injectParametersIntoAST(definition: StrategyDefinition, params: Record<string, number>): StrategyDefinition {
  const cloned: StrategyDefinition = JSON.parse(JSON.stringify(definition));

  function applyParamsToRuleGroup(group: any) {
    if (!group || !Array.isArray(group.rules)) return;
    for (const rule of group.rules) {
      if (!rule) continue;
      // Target rule parameters directly if specified by path or parameter name
      for (const [paramName, paramVal] of Object.entries(params)) {
        if (rule.indicator && typeof rule.indicator === "object") {
          rule.indicator.params = rule.indicator.params || {};
          rule.indicator.params[paramName] = paramVal;
        }
        if (rule.params && typeof rule.params === "object") {
          rule.params[paramName] = paramVal;
        }
        if (rule.left && typeof rule.left === "object" && rule.left.params) {
          rule.left.params[paramName] = paramVal;
        }
        if (rule.right && typeof rule.right === "object" && rule.right.params) {
          rule.right.params[paramName] = paramVal;
        }
      }
    }
  }

  const entry = cloned.entry ?? (cloned as any).entryRules;
  const exit = cloned.exit ?? (cloned as any).exitRules;
  applyParamsToRuleGroup(entry);
  applyParamsToRuleGroup(exit);
  return cloned;
}

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

export async function processSweep(sweep: any): Promise<void> {
  const sweepId = (sweep.id ?? sweep.id) as string;
  const userId = (sweep.userId ?? sweep.user_id) as string;
  const strategyId = (sweep.strategyId ?? sweep.strategy_id) as string;
  const rawParams = sweep.parameters ?? sweep.parameter_ranges ?? [];
  const ranges = (Array.isArray(rawParams) ? rawParams : rawParams.ranges ?? []) as SweepParameterRange[];
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
  const combinations = generateCombinations(ranges, 500);

  // Fetch candles
  const candleData = await fetchCandles(symbol, timeframe, fromDate, toDate);
  if (candleData.length < 50) {
    await db
      .update(strategyParameterSweeps)
      .set({ status: "FAILED", updatedAt: new Date() })
      .where(eq(strategyParameterSweeps.id, sweepId));
    return;
  }

  let bestSharpe = -Infinity;
  let bestParams: Record<string, number> | null = null;
  const resultsToInsert: any[] = [];

  for (let i = 0; i < combinations.length; i++) {
    const combo = combinations[i];
    const modifiedDef = injectParametersIntoAST(baseDef, combo);

    const backtestRes = runBacktestV3({
      strategyVersionId: versionId,
      definition: modifiedDef,
      symbol,
      candles: candleData,
    });

    const m = backtestRes.metrics;
    const sharpeVal = isFinite(m.sharpe) ? m.sharpe : 0;
    if (sharpeVal > bestSharpe) {
      bestSharpe = sharpeVal;
      bestParams = combo;
    }

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
        profitFactor: isFinite(m.profitFactor) ? m.profitFactor.toFixed(4) : "0.0000",
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
