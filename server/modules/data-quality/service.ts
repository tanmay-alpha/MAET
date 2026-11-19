import { desc, eq, and, notInArray, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { db } from "../../data/drizzle/client";
import { ingestionRuns } from "../../db/schema";
import { SYMBOLS } from "../../domain/market/symbol";
import { configuredHolidays } from "../../domain/market/quote-quality";
import { healthChecker } from "../../infra/health";
import { keyExists } from "../../data/redis/client";
import { RedisKeys } from "../../data/redis/keys";
import { getDLQStats } from "../../workers/ingestion-engine/queue/dead-letter-queue";
import type {
  DataQualityReport,
  DataQualityUniverse,
  IngestionBatchView,
  ReliabilityReport,
  StrategyQueueStats,
  SymbolQualityRow,
  Unavailable,
} from "./contracts";
import {
  DEFAULT_WINDOW_SESSIONS,
  barIssues,
  detectPipelineGaps,
  evaluateCoverage,
  isDelayedQuoteSource,
  latestCompletedSession,
  recentSessions,
  summarize,
} from "./evaluator";
import {
  ACTIVE_UNIVERSE_CAP,
  loadActiveUniverse,
  loadCandleAggregates,
  loadCorporateActionAggregates,
  loadDeadLetterBacklog,
  loadFundamentalsAggregates,
  loadIngestionWorkerRows,
  loadQuoteAggregates,
  loadStrategyQueueRows,
  type StrategyQueueRow,
  loadTableProbe,
} from "./repository";

// ---------------------------------------------------------------------------
// Market-data quality report (public)
// ---------------------------------------------------------------------------

export interface ResolvedUniverse {
  id: DataQualityUniverse;
  label: string;
  cap: number;
  members: Array<{ symbol: string; name: string | null }>;
}

const NIFTY50_CAP = 50;

export async function resolveUniverse(id: DataQualityUniverse): Promise<ResolvedUniverse> {
  if (id === "active") {
    const members = await loadActiveUniverse(ACTIVE_UNIVERSE_CAP);
    return { id, label: `Top ${ACTIVE_UNIVERSE_CAP} active NSE companies by market cap`, cap: ACTIVE_UNIVERSE_CAP, members };
  }
  return {
    id,
    label: "Nifty 50 (bundled constituent list)",
    cap: NIFTY50_CAP,
    members: SYMBOLS.slice(0, NIFTY50_CAP).map((quote) => ({ symbol: quote.symbol, name: quote.name ?? null })),
  };
}

export interface ReportOptions {
  now?: Date;
  holidays?: Date[];
  windowSessions?: number;
}

export async function buildDataQualityReport(universe: ResolvedUniverse, options: ReportOptions = {}): Promise<DataQualityReport> {
  const now = options.now ?? new Date();
  const holidays = options.holidays ?? configuredHolidays();
  const latestSession = latestCompletedSession(now, holidays);
  const windowSessions = recentSessions(latestSession, options.windowSessions ?? DEFAULT_WINDOW_SESSIONS, holidays);
  const symbols = universe.members.map((member) => member.symbol);

  const [candleRows, quoteRows, fundamentalsRows, actionRows, tableProbe] = await Promise.all([
    loadCandleAggregates(symbols, windowSessions),
    loadQuoteAggregates(symbols),
    loadFundamentalsAggregates(symbols),
    loadCorporateActionAggregates(symbols),
    loadTableProbe(),
  ]);
  const candlesBySymbol = new Map(candleRows.map((row) => [row.symbol, row]));
  const quotesBySymbol = new Map(quoteRows.map((row) => [row.symbol, row]));
  const fundamentalsBySymbol = new Map(fundamentalsRows.map((row) => [row.symbol, row]));
  const actionsBySymbol = new Map(actionRows.map((row) => [row.symbol, row]));
  const calendar = { latestCompletedSession: latestSession, windowSessions, holidays };

  const rows: SymbolQualityRow[] = universe.members.map((member) => {
    const candles = candlesBySymbol.get(member.symbol);
    const quote = quotesBySymbol.get(member.symbol);
    const fundamentals = fundamentalsBySymbol.get(member.symbol);
    const actions = actionsBySymbol.get(member.symbol);
    const coverage = evaluateCoverage(
      { firstDate: candles?.firstDate ?? null, latestDate: candles?.latestDate ?? null, presentSessions: candles?.presentSessions ?? 0 },
      calendar,
    );
    return {
      symbol: member.symbol,
      name: quote?.name ?? member.name,
      ...coverage,
      latestCandleDate: candles?.latestDate ?? null,
      invalidBars: candles?.invalidBars ?? 0,
      zeroVolumeBars: candles?.zeroVolumeBars ?? 0,
      invalidSamples: (candles?.invalidSamples ?? []).map((bar) => ({ date: bar.date, issues: barIssues(bar) })),
      candleSource: candles?.latestSource ?? null,
      lastQuoteAt: quote?.lastQuoteAt ?? null,
      quoteSource: quote?.quoteSource ?? null,
      quoteDelayed: quote?.quoteSource ? isDelayedQuoteSource(quote.quoteSource) : null,
      fundamentals: {
        latestPeriod: fundamentals?.latestPeriod ?? null,
        latestPeriodType: fundamentals?.latestPeriodType ?? null,
        financialRows: fundamentals?.financialRows ?? 0,
        rowsMissingAvailability: fundamentals?.rowsMissingAvailability ?? 0,
      },
      corporateActions: { count: actions?.count ?? 0, latestExDate: actions?.latestExDate ?? null },
    };
  });

  const latestCandle = candleRows.reduce<string | null>(
    (latest, row) => (row.latestDate !== null && (latest === null || row.latestDate > latest) ? row.latestDate : latest),
    null,
  );
  const pipelineGaps = detectPipelineGaps({
    ...tableProbe,
    dailyCandles: { hasRows: latestCandle !== null, latestDate: latestCandle },
    fundamentals: {
      financialRows: fundamentalsRows.reduce((sum, row) => sum + row.financialRows, 0),
      missingFilingDate: fundamentalsRows.reduce((sum, row) => sum + row.missingFilingDate, 0),
      missingAvailableFrom: fundamentalsRows.reduce((sum, row) => sum + row.missingAvailableFrom, 0),
    },
  });

  return {
    asOf: now.toISOString(),
    source: "database",
    universe: { id: universe.id, label: universe.label, symbolCount: rows.length, cap: universe.cap },
    calendar: {
      timezone: "Asia/Kolkata",
      latestCompletedSession: latestSession,
      windowStart: windowSessions[0] ?? null,
      windowSessions: windowSessions.length,
      holidaysConfigured: holidays.length,
    },
    summary: summarize(rows),
    symbols: rows,
    pipelineGaps,
  };
}

/** Reports are reused this long so a public page cannot turn into a database load generator. */
const REPORT_CACHE_TTL_MS = 60_000;
const reportCache = new Map<DataQualityUniverse, { expiresAt: number; report: Promise<DataQualityReport> }>();

export function getDataQualityReport(universe: DataQualityUniverse): Promise<DataQualityReport> {
  const cached = reportCache.get(universe);
  if (cached && cached.expiresAt > Date.now()) return cached.report;
  const report = resolveUniverse(universe).then((resolved) => buildDataQualityReport(resolved));
  reportCache.set(universe, { expiresAt: Date.now() + REPORT_CACHE_TTL_MS, report });
  // A failed build must not be served from cache.
  report.catch(() => {
    if (reportCache.get(universe)?.report === report) reportCache.delete(universe);
  });
  return report;
}

// ---------------------------------------------------------------------------
// Reliability report (admin)
// ---------------------------------------------------------------------------

const STRATEGY_RETRY_NOTE =
  "Strategy jobs keep no retry counter: abandoned RUNNING jobs are requeued in place, or failed with error code ABANDONED once older than six hours.";

function unavailable(error: unknown): Unavailable {
  return { available: false, reason: error instanceof Error ? error.message : "Query failed" };
}

export async function getReliabilityReport(now: Date = new Date()): Promise<ReliabilityReport> {
  const [health, queues, workers, dlqStats, dlqBacklog] = await Promise.allSettled([
    healthChecker.check(),
    loadStrategyQueueRows(),
    loadIngestionWorkerRows(),
    getDLQStats(),
    loadDeadLetterBacklog(),
  ]);

  const report: ReliabilityReport = {
    asOf: now.toISOString(),
    health: health.status === "fulfilled"
      ? { available: true, status: health.value.status, checks: health.value.checks, databaseCircuit: health.value.databaseCircuit ?? null }
      : unavailable(health.reason),
    strategyJobs: queues.status === "fulfilled"
      ? { available: true, queues: groupQueues(queues.value), retryNote: STRATEGY_RETRY_NOTE }
      : unavailable(queues.reason),
    ingestion: workers.status === "fulfilled" ? { available: true, workers: workers.value } : unavailable(workers.reason),
    deadLetterQueue: dlqStats.status === "fulfilled" && dlqBacklog.status === "fulfilled"
      ? { available: true, ...dlqStats.value, ...dlqBacklog.value }
      : unavailable(dlqStats.status === "rejected" ? dlqStats.reason : (dlqBacklog as PromiseRejectedResult).reason),
    dailyProcessor: { available: false, reason: "Redis unavailable: the daily processor records completion only in Redis" },
  };

  // The orchestrator marks each IST date's daily-processor run done in Redis (with a TTL);
  // without Redis keyExists would only see this process's in-memory fallback.
  if (report.health.available && report.health.checks.redis) {
    const session = latestCompletedSession(now, configuredHolidays());
    try {
      report.dailyProcessor = { available: true, session, completed: await keyExists(RedisKeys.dailyProcessorDoneKey(session)) };
    } catch (error) {
      report.dailyProcessor = unavailable(error);
    }
  }
  return report;
}

function groupQueues(rows: readonly StrategyQueueRow[]): StrategyQueueStats[] {
  const kinds: StrategyQueueStats["kind"][] = ["backtest", "sweep", "walk-forward"];
  return kinds.map((kind) => {
    const stats: StrategyQueueStats = { kind, byStatus: {}, oldestQueuedAt: null, lastCompletedAt: null, abandoned: kind === "backtest" ? 0 : null };
    for (const row of rows) {
      if (row.kind !== kind) continue;
      stats.byStatus[row.status] = row.count;
      if (row.oldestQueuedAt) stats.oldestQueuedAt = row.oldestQueuedAt;
      if (row.lastCompletedAt) stats.lastCompletedAt = row.lastCompletedAt;
      if (row.abandoned !== null && stats.abandoned !== null) stats.abandoned += row.abandoned;
    }
    return stats;
  });
}

// ---------------------------------------------------------------------------
// Ingestion batches (admin)
// ---------------------------------------------------------------------------

export async function getRecentIngestionBatches(limit = 10): Promise<{ recentBatches: IngestionBatchView[] }> {
  const rows = await db
    .select({
      id: ingestionRuns.id,
      batchId: ingestionRuns.batchId,
      source: ingestionRuns.source,
      dataType: ingestionRuns.dataType,
      status: ingestionRuns.status,
      startedAt: ingestionRuns.startedAt,
      completedAt: ingestionRuns.completedAt,
      retryCount: ingestionRuns.retryCount,
      errorSummary: ingestionRuns.errorSummary,
    })
    .from(ingestionRuns)
    .orderBy(desc(ingestionRuns.startedAt))
    .limit(limit);
  return {
    recentBatches: rows.map((row) => ({
      ...row,
      startedAt: row.startedAt.toISOString(),
      completedAt: row.completedAt?.toISOString() ?? null,
    })),
  };
}

export async function retryBatch(batchId: string) {
  const [batch] = await db
    .select()
    .from(ingestionRuns)
    .where(eq(ingestionRuns.batchId, batchId))
    .limit(1);

  if (!batch) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Batch run not found" });
  }

  const jobId = crypto.randomUUID();
  const retryTimestamp = new Date();

  // Atomic state claim: only claim if not already running or retry_pending
  const [claimed] = await db
    .update(ingestionRuns)
    .set({
      status: "retry_pending",
      metadata: sql`jsonb_set(
        coalesce(${ingestionRuns.metadata}, '{}'::jsonb),
        '{lastRetryJobId}',
        to_jsonb(${jobId}::text)
      )`,
    })
    .where(
      and(
        eq(ingestionRuns.id, batch.id),
        notInArray(ingestionRuns.status, ["running", "retry_pending"])
      )
    )
    .returning();

  if (!claimed) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `Retry job already active for batch ${batchId} (status: ${batch.status})`,
    });
  }

  await db
    .update(ingestionRuns)
    .set({
      status: "running",
      retryCount: sql`${ingestionRuns.retryCount} + 1`,
    })
    .where(eq(ingestionRuns.id, batch.id));

  let finalStatus: "succeeded" | "partial" | "failed" = "succeeded";
  let errorSummary: string | null = null;

  try {
    // Synchronous bounded retry: execute ingestion pipeline step preserving target scope if specified
    const { runDailyProcessor } = await import("../../workers/daily-processor");
    const targetSymbols = (batch.metadata as any)?.symbols as string[] | undefined;
    const stats = await runDailyProcessor(targetSymbols ? { symbols: targetSymbols } : undefined);
    if (stats.errors && stats.errors.length > 0) {
      if (stats.symbolsProcessed === 0 && stats.candlesWritten === 0 && stats.fundamentalsSynced === 0) {
        finalStatus = "failed";
        errorSummary = stats.errors.join("; ").slice(0, 500);
      } else {
        finalStatus = "partial";
        errorSummary = `Completed with ${stats.errors.length} error(s): ${stats.errors.slice(0, 3).join("; ")}`.slice(0, 500);
      }
    }
  } catch (err: any) {
    finalStatus = "failed";
    errorSummary = err?.message ?? "Ingestion pipeline retry failed";
  }

  // State Transition 2: running -> succeeded | partial | failed
  const [updated] = await db
    .update(ingestionRuns)
    .set({
      status: finalStatus,
      completedAt: new Date(),
      errorSummary,
      metadata: {
        ...((batch.metadata as object) ?? {}),
        lastRetryJobId: jobId,
        retryCompletedAt: new Date().toISOString(),
      },
    })
    .where(eq(ingestionRuns.id, batch.id))
    .returning();

  return {
    success: finalStatus === "succeeded",
    jobId,
    batchId,
    status: finalStatus,
    attemptCount: updated ? updated.retryCount : batch.retryCount + 1,
    retryTimestamp: retryTimestamp.toISOString(),
    errorSummary,
  };
}
