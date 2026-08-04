/**
 * Strategy Backtest Worker — durable background job processor.
 *
 * Loop:
 * 1. Poll for QUEUED jobs (FOR UPDATE SKIP LOCKED)
 * 2. Claim → RUNNING with worker_id
 * 3. Execute backtest engine V3
 * 4. Emit progress, check cancellation
 * 5. Persist trades + equity points + performance snapshot
 * 6. Mark COMPLETED / FAILED
 * 7. Heartbeat on each symbol boundary
 *
 * This worker runs as a long-lived Node/Bun process, not as a serverless function.
 */

import { db } from "../data/drizzle/client";
import {
  strategyBacktestTrades,
  strategyEquityPoints,
  strategyPerformanceSnapshots,
  candles,
} from "../db/schema";
import { eq, and, desc } from "drizzle-orm";
import * as jobs from "../modules/strategy-jobs/repository";
import { runBacktestV3, InsufficientHistoryV3Error } from "../domain/strategy/runner-v3";
import type { Candle } from "@shared/types";
import { randomUUID } from "crypto";

const WORKER_ID = `bw-${randomUUID().slice(0, 8)}-${process.pid}`;
const POLL_INTERVAL_MS = 3000;
const HEARTBEAT_INTERVAL_MS = 30_000;

// ============================================================
// Fetch candles from DB
// ============================================================

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

// ============================================================
// Process a single job
// ============================================================

async function processJob(job: Awaited<ReturnType<typeof jobs.claimNextJob>>): Promise<void> {
  if (!job) return;

  let heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  try {
    // Setup heartbeat
    heartbeatTimer = setInterval(async () => {
      await jobs.updateHeartbeat(job.id);
    }, HEARTBEAT_INTERVAL_MS);

    // Fetch definition
    const jobWithDef = await jobs.getJobWithVersion(job.id);
    if (!jobWithDef) {
      await jobs.failJob(job.id, "DEFINITION_NOT_FOUND", "Strategy version definition not found");
      return;
    }
    const { definition } = jobWithDef;

    // Cancellation check
    if (await jobs.isCancellationRequested(job.id)) {
      await jobs.markCancelled(job.id);
      return;
    }

    await jobs.updateProgress(job.id, 10);

    // Fetch candle data
    const symbol = job.symbolOrUniverse.includes("|")
      ? job.symbolOrUniverse.split("|")[0]
      : job.symbolOrUniverse;

    const candleData = await fetchCandles(symbol, job.timeframe, job.fromDate, job.toDate);

    if (candleData.length < 50) {
      await jobs.failJob(
        job.id,
        "INSUFFICIENT_HISTORY",
        `Insufficient candle history for ${symbol} (${job.timeframe}): found ${candleData.length} bars, need at least 50`,
      );
      return;
    }

    await jobs.updateProgress(job.id, 30);

    // Cancellation check
    if (await jobs.isCancellationRequested(job.id)) {
      await jobs.markCancelled(job.id);
      return;
    }

    // Run backtest engine V3
    const result = runBacktestV3({
      strategyVersionId: job.strategyVersionId,
      definition,
      symbol,
      candles: candleData,
      overrideCapital: job.initialCapital ? Number(job.initialCapital) : undefined,
    });

    await jobs.updateProgress(job.id, 70);

    const runId = randomUUID();

    // Persist trades
    if (result.trades.length > 0) {
      await db.insert(strategyBacktestTrades).values(
        result.trades.map((t) => ({
          jobId: job.id,
          userId: job.userId,
          strategyVersionId: job.strategyVersionId,
          symbol,
          direction: t.direction === "long" ? "LONG" : "SHORT",
          entrySignalTimestamp: t.entrySignalTimestamp ? new Date(t.entrySignalTimestamp) : null,
          entryFillTimestamp: new Date(t.entryTimestamp),
          entryPrice: t.entryPrice.toFixed(4),
          entryQuantity: "1",
          exitFillTimestamp: new Date(t.exitTimestamp),
          exitPrice: t.exitPrice.toFixed(4),
          exitQuantity: "1",
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

    // Persist downsampled equity curve (max 1000 points)
    const equitySample = downsample(result.equityCurve, 1000);
    if (equitySample.length > 0) {
      await db.insert(strategyEquityPoints).values(
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

    await jobs.updateProgress(job.id, 90);

    // Persist performance snapshot
    const m = result.metrics;
    await db.insert(strategyPerformanceSnapshots).values({
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
      profitFactor: isFinite(m.profitFactor) ? m.profitFactor.toFixed(4) : "0",
      expectancy: m.expectancy.toFixed(6),
      tradeCount: result.tradeCount,
      longTradeCount: result.longTradeCount,
      shortTradeCount: result.shortTradeCount,
      feesPaid: result.feesPaid.toFixed(4),
      slippageCost: result.slippageCost.toFixed(4),
      netProfit: (result.equityCurve[result.equityCurve.length - 1]?.equity ?? definition.execution.initialCapital) - definition.execution.initialCapital
        <= 0 ? "0" : ((result.equityCurve[result.equityCurve.length - 1]?.equity ?? 0) - definition.execution.initialCapital).toFixed(4),
      exposurePercent: m.exposure.toFixed(6),
      benchmarkReturn: m.benchmarkReturn.toFixed(6),
      alpha: m.alpha.toFixed(6),
      dataHash: result.dataHash,
      engineVersion: result.engineVersion,
      executionPolicy: result.executionPolicy,
      intrabarPolicy: result.intrabarPolicy,
      feeModel: result.feeModelVersion,
      warnings: result.warnings as any,
    });

    await jobs.completeJob(job.id, runId);
    console.log(`[backtest-worker:${WORKER_ID}] Completed job ${job.id} — ${result.tradeCount} trades`);

  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error";
    const code = err instanceof InsufficientHistoryV3Error ? "INSUFFICIENT_HISTORY" : "BACKTEST_ERROR";
    // Redact raw SQL errors before storing
    const safeMessage = message.replace(/column|table|index|constraint|syntax/gi, "[db]");
    await jobs.failJob(job.id, code, safeMessage);
    console.error(`[backtest-worker:${WORKER_ID}] Job ${job.id} failed: ${safeMessage}`);
  } finally {
    if (heartbeatTimer) clearInterval(heartbeatTimer);
  }
}

// ============================================================
// Equity curve downsampler
// ============================================================

function downsample<T>(arr: T[], maxPoints: number): T[] {
  if (arr.length <= maxPoints) return arr;
  const step = Math.ceil(arr.length / maxPoints);
  return arr.filter((_, i) => i % step === 0 || i === arr.length - 1);
}

// ============================================================
// Worker main loop
// ============================================================

async function workerLoop(): Promise<never> {
  console.log(`[backtest-worker] Starting worker ${WORKER_ID}`);

  // Attempt to recover abandoned jobs on startup
  try {
    const recovered = await jobs.recoverAbandonedJobs();
    if (recovered > 0) console.log(`[backtest-worker] Recovered ${recovered} abandoned jobs`);
  } catch (err) {
    console.warn(`[backtest-worker] Recovery scan failed: ${err}`);
  }

  while (true) {
    try {
      const job = await jobs.claimNextJob(WORKER_ID);
      if (job) {
        await processJob(job);
      } else {
        await sleep(POLL_INTERVAL_MS);
      }
    } catch (err) {
      console.error(`[backtest-worker] Unhandled error in loop: ${err}`);
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Start if run directly
workerLoop().catch((err) => {
  console.error("[backtest-worker] Fatal error:", err);
  process.exit(1);
});
