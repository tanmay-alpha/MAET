/**
 * Ingestion tRPC Router — Admin status and retry controls
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { sql } from "drizzle-orm";
import { getDLQStats, getPendingRetries } from "../../../workers/ingestion-engine/queue/dead-letter-queue";
import * as YahooHistory from "../../../workers/ingestion-engine/sources/yahoo-history";
import * as NSEEquities from "../../../workers/ingestion-engine/sources/nse-equities";

export const ingestionRouter = createRouter({
  /**
   * Get overall ingestion system status
   */
  getStatus: protectedProcedure.query(async () => {
    const [dlqStats, latestRuns] = await Promise.all([
      getDLQStats(),
      db.execute(sql`
        SELECT source, pipeline, status, started_at, completed_at, duration_ms,
               symbols_attempted, symbols_succeeded, symbols_failed, records_inserted
        FROM ingestion_runs
        ORDER BY started_at DESC
        LIMIT 20
      `).then((rows) => rows as any[]),
    ]);

    const sourceStatus: Record<string, {
      lastSync: string | null;
      status: "OK" | "STALE" | "UNKNOWN";
    }> = {
      "yahoo-history": {
        lastSync: YahooHistory.getLastSyncTimestamp()?.toISOString() ?? null,
        status: (() => {
          const last = YahooHistory.getLastSyncTimestamp();
          if (!last) return "UNKNOWN";
          const ageMins = (Date.now() - last.getTime()) / 60_000;
          return ageMins > 1440 ? "STALE" : "OK"; // stale if > 24h
        })(),
      },
      "nse-equities": {
        lastSync: NSEEquities.getLastSyncTimestamp()?.toISOString() ?? null,
        status: (() => {
          const last = NSEEquities.getLastSyncTimestamp();
          if (!last) return "UNKNOWN";
          const ageMins = (Date.now() - last.getTime()) / 60_000;
          return ageMins > 1440 ? "STALE" : "OK";
        })(),
      },
    };

    return {
      dlq: dlqStats,
      sources: sourceStatus,
      recentRuns: latestRuns.map((r) => ({
        source: r.source,
        pipeline: r.pipeline,
        status: r.status,
        startedAt: r.started_at,
        completedAt: r.completed_at,
        durationMs: r.duration_ms,
        symbolsAttempted: r.symbols_attempted,
        symbolsSucceeded: r.symbols_succeeded,
        symbolsFailed: r.symbols_failed,
        recordsInserted: r.records_inserted,
      })),
    };
  }),

  /**
   * Get dead letter queue entries
   */
  getDLQ: protectedProcedure
    .input(z.object({ source: z.string().optional() }).optional())
    .query(async ({ input }) => {
      const pending = await getPendingRetries(input?.source);
      return { pending, count: pending.length };
    }),

  /**
   * Get table row counts for quick inventory check
   */
  getInventory: protectedProcedure.query(async () => {
    const counts = await db.execute(sql`
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
    `);

    return (counts as any[])[0] ?? {};
  }),

  /**
   * Trigger a manual ingestion run for specific symbols (admin only)
   */
  triggerRun: protectedProcedure
    .input(z.object({
      source: z.enum(["yahoo-history", "nse-equities"]),
      symbols: z.array(z.string().min(1)).min(1).max(50),
    }))
    .mutation(async ({ input }) => {
      if (input.source === "yahoo-history") {
        // Fire and forget — the response returns the run ID immediately
        const runId = `manual-${Date.now()}`;
        // Import dynamically to avoid circular deps
        const { runDailyPipeline } = await import("../../../workers/ingestion-engine/pipelines/daily-pipeline");
        void runDailyPipeline({ symbols: input.symbols, backfillDays: 365 });
        return { runId, status: "started", symbols: input.symbols };
      }

      throw new TRPCError({ code: "BAD_REQUEST", message: `Source ${input.source} does not support manual trigger` });
    }),
});
