/**
 * Detailed Health Endpoint — /health/detailed
 * Returns comprehensive system status including ingestion lag, row counts,
 * calculation queue depth, and DLQ statistics.
 */

import { defineEventHandler } from "h3";
import { db } from "../../data/drizzle/client";
import { sql } from "drizzle-orm";
import { getDLQStats } from "../../workers/ingestion-engine/queue/dead-letter-queue";
import * as YahooHistory from "../../workers/ingestion-engine/sources/yahoo-history";
import * as NSEEquities from "../../workers/ingestion-engine/sources/nse-equities";

interface SourceStatus {
  status: "OK" | "STALE" | "DOWN" | "UNKNOWN";
  lastSyncAt: string | null;
  lagMinutes: number | null;
  message?: string;
}

function assessSource(lastSync: Date | null, staleThresholdMinutes = 60): SourceStatus {
  if (!lastSync) return { status: "UNKNOWN", lastSyncAt: null, lagMinutes: null };
  const lagMs = Date.now() - lastSync.getTime();
  const lagMinutes = Math.round(lagMs / 60_000);
  const status = lagMinutes > staleThresholdMinutes ? "STALE" : "OK";
  return { status, lastSyncAt: lastSync.toISOString(), lagMinutes };
}

export default defineEventHandler(async () => {
  const start = Date.now();

  try {
    // Parallel checks
    const [dbCounts, dlqStats, latestRun] = await Promise.allSettled([
      db.execute(sql`
        SELECT
          (SELECT COUNT(*) FROM companies WHERE exchange = 'NSE') as nse_companies,
          (SELECT COUNT(*) FROM companies WHERE exchange = 'BSE') as bse_companies,
          (SELECT COUNT(*) FROM candles) as candles,
          (SELECT COUNT(*) FROM price_daily) as price_daily,
          (SELECT COUNT(*) FROM financial_statements) as financial_statements,
          (SELECT COUNT(*) FROM fundamentals) as fundamentals,
          (SELECT COUNT(*) FROM calculation_results) as calculation_results,
          (SELECT COUNT(*) FROM corporate_actions) as corporate_actions,
          (SELECT COUNT(*) FROM dead_letter_queue WHERE resolved = false) as dlq_pending,
          (SELECT MAX(started_at) FROM ingestion_runs WHERE status = 'success') as last_successful_run
      `).then((rows) => (rows as any[])[0] ?? {}),
      getDLQStats(),
      db.execute(sql`
        SELECT source, status, started_at, completed_at, symbols_succeeded, records_inserted
        FROM ingestion_runs
        ORDER BY started_at DESC
        LIMIT 5
      `).then((rows) => rows as any[]),
    ]);

    const counts = dbCounts.status === "fulfilled" ? dbCounts.value : {};
    const dlq = dlqStats.status === "fulfilled" ? dlqStats.value : { total: 0, pending: 0, resolved: 0, bySource: {} };
    const runs = latestRun.status === "fulfilled" ? latestRun.value : [];

    // Source status
    const sources: Record<string, SourceStatus> = {
      "yahoo-history": assessSource(YahooHistory.getLastSyncTimestamp(), 1440),
      "nse-equities": assessSource(NSEEquities.getLastSyncTimestamp(), 1440),
    };

    // Overall health
    const sourceStatuses = Object.values(sources).map((s) => s.status);
    const hasDown = sourceStatuses.includes("DOWN");
    const hasStale = sourceStatuses.includes("STALE");
    const overallStatus = hasDown ? "DEGRADED" : hasStale ? "WARNING" : "HEALTHY";

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      responseMs: Date.now() - start,
      sources,
      database: {
        status: dbCounts.status === "fulfilled" ? "OK" : "ERROR",
        rowCounts: {
          nseCompanies: parseInt(counts.nse_companies ?? "0"),
          bseCompanies: parseInt(counts.bse_companies ?? "0"),
          candles: parseInt(counts.candles ?? "0"),
          priceDaily: parseInt(counts.price_daily ?? "0"),
          financialStatements: parseInt(counts.financial_statements ?? "0"),
          fundamentals: parseInt(counts.fundamentals ?? "0"),
          calculationResults: parseInt(counts.calculation_results ?? "0"),
          corporateActions: parseInt(counts.corporate_actions ?? "0"),
        },
        lastSuccessfulIngestion: counts.last_successful_run ?? null,
      },
      deadLetterQueue: {
        total: dlq.total,
        pending: dlq.pending,
        resolved: dlq.resolved,
        bySource: dlq.bySource,
        status: dlq.pending > 100 ? "HIGH" : dlq.pending > 10 ? "ELEVATED" : "NORMAL",
      },
      recentRuns: runs.slice(0, 5).map((r) => ({
        source: r.source,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        symbolsSucceeded: r.symbols_succeeded,
        recordsInserted: r.records_inserted,
      })),
    };
  } catch (err) {
    return {
      status: "ERROR",
      timestamp: new Date().toISOString(),
      responseMs: Date.now() - start,
      error: (err as Error).message,
    };
  }
});
