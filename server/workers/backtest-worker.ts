/**
 * Strategy backtest job: runs one claimed strategy_backtest_jobs row through backtest engine V3 and
 * persists its trades, downsampled equity curve and performance snapshot.
 *
 * The job runner (server/modules/strategy-jobs/runner.ts) claims the row, heartbeats it and owns
 * shutdown / time-budget handling. This function checks for user cancellation between phases and
 * calls `ctx.checkpoint()` there so the runner can interrupt it. Results and the COMPLETED status are
 * written in one transaction that only commits while this worker still holds the job.
 */

import { randomUUID } from "crypto";
import { db } from "../data/drizzle/client";
import { strategyBacktestTrades, strategyEquityPoints, strategyPerformanceSnapshots } from "../db/schema";
import * as jobs from "../modules/strategy-jobs/repository";
import { JobCandleLimitError, loadJobCandles } from "../modules/strategy-jobs/candles";
import { downsample } from "../modules/strategy-jobs/downsample";
import { JobInterruptedError, type JobContext } from "../modules/strategy-jobs/job-context";
import { runBacktestV3, InsufficientHistoryV3Error } from "../domain/strategy/runner-v3";

const MAX_EQUITY_POINTS = 1000;

export async function runBacktestJob(job: jobs.BacktestJobRow, workerId: string, ctx: JobContext): Promise<void> {
  try {
    const jobWithDef = await jobs.getJobWithVersion(job.id);
    if (!jobWithDef) {
      await jobs.markFailed(job.id, "DEFINITION_NOT_FOUND", "Strategy version definition not found");
      return;
    }
    const { definition } = jobWithDef;

    if (await jobs.isCancellationRequested(job.id)) {
      await jobs.markCancelled(job.id);
      return;
    }
    await jobs.updateProgress(job.id, 10);

    const symbol = job.symbolOrUniverse.includes("|") ? job.symbolOrUniverse.split("|")[0] : job.symbolOrUniverse;
    const candleData = await loadJobCandles(symbol, job.timeframe, job.fromDate, job.toDate);
    if (candleData.length < 50) {
      await jobs.markFailed(
        job.id,
        "INSUFFICIENT_HISTORY",
        `Insufficient candle history for ${symbol} (${job.timeframe}): found ${candleData.length} bars, need at least 50`,
      );
      return;
    }
    await jobs.updateProgress(job.id, 30);

    await ctx.checkpoint();
    if (await jobs.isCancellationRequested(job.id)) {
      await jobs.markCancelled(job.id);
      return;
    }

    const result = runBacktestV3({
      strategyVersionId: job.strategyVersionId,
      definition,
      symbol,
      candles: candleData,
      overrideCapital: job.initialCapital ? Number(job.initialCapital) : undefined,
      timeframe: job.timeframe,
    });
    await ctx.checkpoint();
    await jobs.updateProgress(job.id, 70);

    const m = result.metrics;
    const equitySample = downsample(result.equityCurve, MAX_EQUITY_POINTS);
    const runId = randomUUID();

    await db.transaction(async (tx) => {
      if (!(await jobs.completeJob(tx, job.id, workerId, runId))) throw new JobInterruptedError("LEASE_LOST");

      if (result.trades.length > 0) {
        await tx.insert(strategyBacktestTrades).values(
          result.trades.map((t) => ({
            jobId: job.id,
            userId: job.userId,
            strategyVersionId: job.strategyVersionId,
            symbol,
            direction: t.direction === "long" ? "LONG" : "SHORT",
            entrySignalTimestamp: t.entrySignalTimestamp ? new Date(t.entrySignalTimestamp) : null,
            entryFillTimestamp: new Date(t.entryTimestamp),
            entryPrice: t.entryPrice.toFixed(4),
            entryQuantity: String(t.quantity),
            exitFillTimestamp: new Date(t.exitTimestamp),
            exitPrice: t.exitPrice.toFixed(4),
            exitQuantity: String(t.quantity),
            grossPnl: t.grossPnl.toFixed(4),
            fees: t.fees.toFixed(4),
            slippage: t.slippage.toFixed(4),
            netPnl: t.netPnl.toFixed(4),
            returnPercent: (t.return * 100).toFixed(6),
            holdingBars: t.holdingBars,
            holdingSeconds: Math.round((t.exitTimestamp - t.entryTimestamp) / 1000),
            mfe: t.mfe.toFixed(4),
            mae: t.mae.toFixed(4),
            entryReason: t.entryReason,
            exitReason: t.exitReason,
          })),
        );
      }

      if (equitySample.length > 0) {
        await tx.insert(strategyEquityPoints).values(
          equitySample.map((p) => ({
            jobId: job.id,
            userId: job.userId,
            timestamp: new Date(p.timestamp),
            equity: p.equity.toFixed(4),
            benchmark: p.benchmark?.toFixed(4) ?? null,
            drawdown: null,
          })),
        );
      }

      await tx.insert(strategyPerformanceSnapshots).values({
        jobId: job.id,
        userId: job.userId,
        strategyVersionId: job.strategyVersionId,
        symbolOrUniverse: job.symbolOrUniverse,
        timeframe: job.timeframe,
        fromDate: job.fromDate,
        toDate: job.toDate,
        totalReturn: m.totalReturn.toFixed(6),
        annualizedReturn: m.annualisedReturn.toFixed(6),
        maxDrawdown: m.maxDrawdown.toFixed(6),
        sharpe: m.sharpe.toFixed(4),
        sortino: m.sortino.toFixed(4),
        calmar: m.calmar.toFixed(4),
        winRate: m.winRate.toFixed(6),
        profitFactor: m.profitFactor == null ? null : m.profitFactor.toFixed(4),
        expectancy: m.expectancy.toFixed(6),
        tradeCount: result.tradeCount,
        longTradeCount: result.longTradeCount,
        shortTradeCount: result.shortTradeCount,
        feesPaid: result.feesPaid.toFixed(4),
        slippageCost: result.slippageCost.toFixed(4),
        // Signed: a losing backtest must persist its loss. The curve starts at the run's capital.
        netProfit: (result.equityCurve[result.equityCurve.length - 1].equity - result.equityCurve[0].equity).toFixed(4),
        // The column is a percentage (0-100); the engine reports exposure as a fraction of the run.
        exposurePercent: (m.exposure * 100).toFixed(6),
        benchmarkReturn: m.benchmarkReturn.toFixed(6),
        alpha: m.alpha.toFixed(6),
        dataHash: result.dataHash,
        engineVersion: result.engineVersion,
        executionPolicy: result.executionPolicy,
        intrabarPolicy: result.intrabarPolicy,
        feeModel: result.feeModelVersion,
        warnings: result.warnings,
      });
    });
    console.log(`[strategy-jobs:${workerId}] Completed backtest ${job.id} — ${result.tradeCount} trades`);
  } catch (err: unknown) {
    if (err instanceof JobInterruptedError) throw err;
    const message = err instanceof Error ? err.message : "Unknown error";
    const code =
      err instanceof InsufficientHistoryV3Error ? "INSUFFICIENT_HISTORY" : err instanceof JobCandleLimitError ? "TOO_MANY_CANDLES" : "BACKTEST_ERROR";
    // Redact raw SQL errors before storing
    const safeMessage = message.replace(/column|table|index|constraint|syntax/gi, "[db]");
    await jobs.markFailed(job.id, code, safeMessage);
    console.error(`[strategy-jobs:${workerId}] Backtest ${job.id} failed: ${safeMessage}`);
  }
}

