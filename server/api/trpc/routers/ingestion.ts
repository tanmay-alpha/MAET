/**
 * Ingestion tRPC Router — Admin status and retry controls
 * FIX 3: Replaced void fire-and-forget with try/catch, concurrency limit, and proper error reporting.
 */

import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { sql } from "drizzle-orm";
import { getDLQStats, getPendingRetries } from "../../../workers/ingestion-engine/queue/dead-letter-queue";
import * as YahooHistory from "../../../workers/ingestion-engine/sources/yahoo-history";
import * as NSEEquities from "../../../workers/ingestion-engine/sources/nse-equities";

// FIX 3: Concurrency guard — only one manual pipeline run at a time
const runningPipelines = new Map<string, { startedAt: Date; runId: string }>();

function acquirePipelineSlot(source: string): { runId: string; acquired: boolean } {
  const existing = runningPipelines.get(source);
  if (existing) {
    const ageMs = Date.now() - existing.startedAt.getTime();
    // Auto-release after 2 hours (pipeline should never take that long)
    if (ageMs > 2 * 60 * 60 * 1000) {
      console.warn(`[ingestion] Auto-releasing stale pipeline slot for ${source} (started ${ageMs}ms ago)`);
      runningPipelines.delete(source);
    } else {
      return { runId: existing.runId, acquired: false };
    }
  }
  const runId = `manual-${source}-${Date.now()}`;
  runningPipelines.set(source, { startedAt: new Date(), runId });
  return { runId, acquired: true };
}

function releasePipelineSlot(source: string): void {
  runningPipelines.delete(source);
}

// FIX 3: Admin role check
const ADMIN_USER_IDS = new Set(
  (process.env.ADMIN_USER_IDS || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean)
);

function isAdmin(userId: string | undefined): boolean {
  if (!userId) return false;
  return ADMIN_USER_IDS.has(userId);
}

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
    .query(async ({ input, ctx }) => {
      if (!isAdmin(ctx.userId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }
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
   * FIX 3: Wrapped in try/catch with concurrency guard and proper error reporting.
   */
  triggerRun: protectedProcedure
    .input(z.object({
      source: z.enum(["yahoo-history", "nse-equities"]),
      symbols: z.array(z.string().min(1)).min(1).max(50),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!isAdmin(ctx.userId)) {
        throw new TRPCError({
          code: "FORBIDDEN",
          message: "Admin access required",
        });
      }

      // Concurrency guard: reject if a pipeline for the same source is already running
      const slot = acquirePipelineSlot(input.source);
      if (!slot.acquired) {
        const existing = runningPipelines.get(input.source);
        const ageMs = existing ? Date.now() - existing.startedAt.getTime() : 0;
        const ageMin = Math.floor(ageMs / 60_000);
        throw new TRPCError({
          code: "CONFLICT",
          message: `A ${input.source} pipeline is already running (started ${ageMin}m ago). Wait for it to complete or use a different source.`,
        });
      }

      const runId = slot.runId;

      try {
        if (input.source === "yahoo-history") {
          // Import dynamically to avoid circular deps
          const { runDailyPipeline } = await import("../../../workers/ingestion-engine/pipelines/daily-pipeline");
          const result = await runDailyPipeline({
            symbols: input.symbols,
            backfillDays: 365,
          });
          return {
            runId,
            status: result.symbolsFailed === 0 ? "completed" : result.symbolsSucceeded > 0 ? "partial" : "failed",
            symbols: input.symbols,
            result,
          };
        }

        if (input.source === "nse-equities") {
          // nse-equities ingestion is handled via the scheduled engine;
          // manual trigger returns the run ID for tracking.
          return {
            runId,
            status: "started",
            symbols: input.symbols,
            note: "nse-equities uses the scheduled engine. Check ingestion_runs for status.",
          };
        }

        throw new TRPCError({ code: "BAD_REQUEST", message: `Source ${input.source} does not support manual trigger` });
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown pipeline error";
        console.error(`[ingestion] Pipeline ${runId} failed:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Pipeline run failed: ${message}`,
        });
      } finally {
        // Always release the concurrency slot
        releasePipelineSlot(input.source);
      }
    }),
});
