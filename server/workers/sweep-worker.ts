/**
 * Strategy parameter sweep job: backtests every parameter combination of one claimed
 * strategy_parameter_sweeps row (on the strategy's latest version) and stores one result per
 * combination.
 *
 * The job runner (server/modules/strategy-jobs/runner.ts) claims the row, heartbeats it and owns
 * shutdown / time-budget handling; `ctx.checkpoint()` after each backtest lets it interrupt the sweep
 * and keeps the event loop responsive. Results and the COMPLETED status are written in one
 * transaction, so an interrupted sweep leaves no partial results behind.
 */

import { and, desc, eq } from "drizzle-orm";
import { db } from "../data/drizzle/client";
import { strategyParameterSweeps, strategySweepResults, strategyVersions } from "../db/schema";
import { runBacktestV3 } from "../domain/strategy/runner-v3";
import {
  applyParameters,
  generateCombinations,
  MAX_SWEEP_COMBINATIONS,
  parseStoredSweepParameters,
} from "../domain/strategy/parameter-sweep";
import type { StrategyDefinition } from "../../shared/strategy/ast";
import { loadJobCandles } from "../modules/strategy-jobs/candles";
import { JobInterruptedError, type JobContext } from "../modules/strategy-jobs/job-context";
import { failSweep } from "../modules/strategy-optimisation/repository";

const PROGRESS_EVERY = 10;

const finite = (value: number, digits: number) => (Number.isFinite(value) ? value : 0).toFixed(digits);

export async function runSweepJob(sweepId: string, ctx: JobContext): Promise<void> {
  const [sweep] = await db.select().from(strategyParameterSweeps).where(eq(strategyParameterSweeps.id, sweepId)).limit(1);
  if (!sweep) return;

  try {
    const [version] = await db
      .select()
      .from(strategyVersions)
      .where(eq(strategyVersions.strategyId, sweep.strategyId))
      .orderBy(desc(strategyVersions.versionNumber))
      .limit(1);
    if (!version) throw new Error("Strategy has no saved version to sweep");
    if (version.userId !== sweep.userId) throw new Error("Strategy version does not belong to the sweep's owner");

    const parameters = parseStoredSweepParameters(sweep.parameters);
    const baseDef = version.definition as StrategyDefinition;
    const combinations = generateCombinations(parameters, MAX_SWEEP_COMBINATIONS);
    // Invalid parameter paths throw here, before any backtest runs.
    const definitions = combinations.map((combo) => applyParameters(baseDef, parameters, combo));

    const candleData = await loadJobCandles(sweep.symbolOrUniverse, sweep.timeframe, sweep.fromDate, sweep.toDate);
    if (candleData.length < 50) throw new Error(`Insufficient candle history: ${candleData.length} bars, need at least 50`);

    const results: Array<typeof strategySweepResults.$inferInsert> = [];
    for (let i = 0; i < combinations.length; i++) {
      const backtest = runBacktestV3({
        strategyVersionId: version.id,
        definition: definitions[i],
        symbol: sweep.symbolOrUniverse,
        candles: candleData,
        timeframe: sweep.timeframe,
      });
      const m = backtest.metrics;
      results.push({
        sweepId,
        userId: sweep.userId,
        parameterValues: combinations[i],
        combinationIndex: i,
        resultSummary: {
          sharpe: finite(m.sharpe, 4),
          sortino: finite(m.sortino, 4),
          totalReturn: finite(m.totalReturn, 6),
          maxDrawdown: finite(m.maxDrawdown, 6),
          winRate: finite(m.winRate, 6),
          profitFactor: m.profitFactor == null ? null : m.profitFactor.toFixed(4),
          tradeCount: backtest.tradeCount,
          costDragPercent: finite(backtest.costDragPercent ?? 0, 4),
        },
      });

      await ctx.checkpoint();
      if ((i + 1) % PROGRESS_EVERY === 0) {
        await db
          .update(strategyParameterSweeps)
          .set({ completedCount: i + 1, updatedAt: new Date() })
          .where(eq(strategyParameterSweeps.id, sweepId));
      }
    }

    await db.transaction(async (tx) => {
      const [owned] = await tx
        .update(strategyParameterSweeps)
        .set({ status: "COMPLETED", completedCount: combinations.length, updatedAt: new Date() })
        .where(and(eq(strategyParameterSweeps.id, sweepId), eq(strategyParameterSweeps.status, "RUNNING")))
        .returning({ id: strategyParameterSweeps.id });
      if (!owned) throw new JobInterruptedError("LEASE_LOST");
      if (results.length > 0) await tx.insert(strategySweepResults).values(results);
    });
    console.log(`[strategy-jobs] Completed sweep ${sweepId} (${combinations.length} combinations)`);
  } catch (err) {
    if (err instanceof JobInterruptedError) throw err;
    console.error(`[strategy-jobs] Sweep ${sweepId} failed:`, err);
    await failSweep(sweepId);
  }
}
