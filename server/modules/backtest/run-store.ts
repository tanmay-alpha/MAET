/**
 * Persistence for Backtest Lab runs (backtestV2.run). Every run is stored, so storage is
 * bounded per user: at most MAX_STORED_BACKTEST_RUNS_PER_USER rows (oldest deleted in the
 * same transaction as the insert) and an equity curve of at most MAX_STORED_EQUITY_POINTS
 * points. The run's response to the caller still carries the full per-bar curve.
 */
import { sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import { backtestRuns } from "../../db/schema";
import { downsample } from "../strategy-jobs/downsample";

/** Newest runs kept per user; listRuns shows at most 50. */
export const MAX_STORED_BACKTEST_RUNS_PER_USER = 50;
/** Same chart resolution the strategy backtest jobs store (server/workers/backtest-worker.ts). */
export const MAX_STORED_EQUITY_POINTS = 1_000;

export type NewBacktestRun = typeof backtestRuns.$inferInsert;
export type BacktestRunRow = typeof backtestRuns.$inferSelect;

/** Every n-th equity point plus the last, so the stored curve keeps its start and final equity. */
export function storedEquityCurve<T>(points: T[]): T[] {
  return downsample(points, MAX_STORED_EQUITY_POINTS);
}

/**
 * Inserts a run and deletes the user's runs beyond the newest MAX_STORED_BACKTEST_RUNS_PER_USER.
 * The user's advisory lock serialises concurrent runs, so the cap holds after every commit;
 * the new row is always kept, even if another row shares its timestamp.
 */
export async function saveBacktestRun(run: NewBacktestRun): Promise<BacktestRunRow> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`backtest-runs:${run.userId}`}))`);
    const [saved] = await tx.insert(backtestRuns).values(run).returning();
    await tx.execute(sql`
      DELETE FROM public.backtest_runs
      WHERE user_id = ${run.userId}
        AND id NOT IN (
          SELECT id FROM public.backtest_runs
          WHERE user_id = ${run.userId}
          ORDER BY (id = ${saved.id}) DESC, created_at DESC, id DESC
          LIMIT ${MAX_STORED_BACKTEST_RUNS_PER_USER}
        )
    `);
    return saved;
  });
}
