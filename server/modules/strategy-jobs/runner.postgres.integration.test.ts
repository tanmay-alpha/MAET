/**
 * Strategy job runner — PostgreSQL integration tests.
 *
 * Drives the real runner (claims, heartbeats, stop, stale recovery, time budget) against PostgreSQL
 * with seeded candles. Skipped without TEST_DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { strategyBacktestsRouter } from "../../api/trpc/routers/strategy-backtests";
import { strategyOptimisationRouter } from "../../api/trpc/routers/strategy-optimisation";
import { createStrategyJobRunner } from "./runner";
import { loadJobCandles } from "./candles";
import { runBacktestV3 } from "../../domain/strategy/runner-v3";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const userId = "00000000-0000-0000-0000-0000000000c7";
const strategyId = "c7000000-0000-0000-0000-000000000001";
const versionId = "c7000000-0000-0000-0000-000000000002";
const symbol = "RUNNERTEST";
const start = Date.UTC(2023, 0, 2);
const BARS = 300;
const from = new Date(start).toISOString();
const to = new Date(start + (BARS - 1) * 86_400_000).toISOString();

const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
const definition: StrategyDefinition = {
  name: "runner",
  direction: "LONG_ONLY",
  entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: "CROSS_ABOVE", right: sma(20) }] },
  exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(5), operator: "CROSS_BELOW", right: sma(20) }] },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5, initialCapital: 100_000 },
};
/** 25 x 20 = 500 combinations: long enough to interrupt part-way. */
const largeGrid = [
  { name: "fast", path: "entry.children.0.left.params.period", values: Array.from({ length: 25 }, (_, i) => i + 2) },
  { name: "slow", path: "entry.children.0.right.params.period", values: Array.from({ length: 20 }, (_, i) => i + 30) },
];
const fastRunner = { kinds: undefined, pollIntervalMs: 50, heartbeatIntervalMs: 100 } as const;

/** Polls real state: the runner works on wall-clock time against a real database, so fake timers cannot drive it. */
async function waitFor<T>(read: () => Promise<T>, done: (value: T) => boolean, timeoutMs = 30_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await read();
    if (done(value)) return value;
    if (Date.now() > deadline) throw new Error(`Timed out waiting; last value: ${JSON.stringify(value)}`);
    await Bun.sleep(25);
  }
}

async function insertSweep(parameters: unknown, status = "QUEUED"): Promise<string> {
  const sql = getSqlClient();
  const [row] = await sql`
    INSERT INTO public.strategy_parameter_sweeps
      (user_id, strategy_id, parameters, combination_count, symbol_or_universe, timeframe, from_date, to_date, status)
    VALUES (${userId}, ${strategyId}, ${JSON.stringify(parameters)}::jsonb, 500, ${symbol}, '1d', ${from}::timestamptz, ${to}::timestamptz, ${status})
    RETURNING id`;
  return row.id as string;
}

async function sweepState(id: string) {
  const sql = getSqlClient();
  const [row] = await sql`SELECT status, completed_count FROM public.strategy_parameter_sweeps WHERE id = ${id}`;
  const [{ count }] = await sql`SELECT count(*)::int AS count FROM public.strategy_sweep_results WHERE sweep_id = ${id}`;
  return { status: row.status as string, completedCount: row.completed_count as number, results: count as number };
}

async function backtestState(id: string) {
  const sql = getSqlClient();
  const [row] = await sql`SELECT status, error_code, worker_id FROM public.strategy_backtest_jobs WHERE id = ${id}`;
  return { status: row.status as string, errorCode: row.error_code as string | null, workerId: row.worker_id as string | null };
}

describe("Strategy job runner (PostgreSQL)", () => {
  beforeAll(async () => {
    if (!enabled) return;
    await applyMigrations();
    const sql = getSqlClient();
    await sql.unsafe(`
      DELETE FROM public.users WHERE id = '${userId}';
      DELETE FROM auth.users WHERE id = '${userId}';
      DELETE FROM public.candles WHERE symbol = '${symbol}';
      INSERT INTO auth.users (id) VALUES ('${userId}');
      INSERT INTO public.users (id, email) VALUES ('${userId}', 'runner@test.com');
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft) VALUES ('${strategyId}', '${userId}', 'Runner', '{}');
    `);
    await sql`
      INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES (${versionId}, ${strategyId}, ${userId}, 1, ${JSON.stringify(definition)}::jsonb, 'runner-hash', '3.0.0', '1.0.0')`;
    const candleRows = Array.from({ length: BARS }, (_, i) => {
      const p = 100 * (1 + 0.001 * i) + 8 * Math.sin(i / 7);
      return { symbol, timeframe: "1d", ts: new Date(start + i * 86_400_000).toISOString(), open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 500_000, source: "test" };
    });
    await sql`INSERT INTO public.candles ${sql(candleRows)}`;
  });

  afterAll(async () => {
    if (!enabled) return;
    const sql = getSqlClient();
    await sql`DELETE FROM public.users WHERE id = ${userId}`;
    await sql`DELETE FROM auth.users WHERE id = ${userId}`;
    await sql`DELETE FROM public.candles WHERE symbol = ${symbol}`;
  });

  it("claims a backtest queued through tRPC and stores its results", async () => {
    if (!enabled) return console.log("  Skipping runner test: TEST_DATABASE_URL not set");
    const caller = strategyBacktestsRouter.createCaller({ userId, email: "runner@test.com", role: "user" });
    const { job } = await caller.createJob({ strategyVersionId: versionId, symbolOrUniverse: symbol, timeframe: "1d", from, to, overrideCapital: 250_000 });
    expect(job.status).toBe("QUEUED");

    const runner = createStrategyJobRunner({ ...fastRunner, kinds: ["backtest"] });
    runner.start();
    try {
      await waitFor(() => backtestState(job.id), (s) => s.status !== "QUEUED" && s.status !== "RUNNING");
    } finally {
      await runner.stop();
    }

    const { job: done, snapshot } = await caller.getJob({ jobId: job.id });
    expect(done.status).toBe("COMPLETED");
    expect(done.progress).toBe(100);
    expect(done.workerId).toBe(runner.workerId);
    expect(snapshot).not.toBeNull();
    expect(snapshot!.tradeCount).toBeGreaterThan(0);
    const { points } = await caller.getEquityCurve({ jobId: job.id });
    expect(Number(points[0].equity)).toBe(250_000);
    const { trades } = await caller.getTrades({ jobId: job.id });
    expect(trades).toHaveLength(snapshot!.tradeCount);

    // exposure_percent holds a percentage (0-100); the engine reports exposure as a fraction.
    const engine = runBacktestV3({
      strategyVersionId: versionId, definition, symbol, timeframe: "1d", overrideCapital: 250_000,
      candles: await loadJobCandles(symbol, "1d", new Date(from), new Date(to)),
    });
    expect(engine.metrics.exposure).toBeGreaterThan(0.01);
    expect(Number(snapshot!.exposurePercent)).toBeCloseTo(engine.metrics.exposure * 100, 4);
  });

  it("requeues the running job on stop, without partial results, and keeps the event loop responsive", async () => {
    if (!enabled) return console.log("  Skipping runner test: TEST_DATABASE_URL not set");
    const sweepId = await insertSweep(largeGrid);

    // Real interval: measures how long the event loop is blocked while the sweep runs.
    let maxGapMs = 0;
    let last = performance.now();
    const ticker = setInterval(() => {
      const now = performance.now();
      maxGapMs = Math.max(maxGapMs, now - last);
      last = now;
    }, 5);

    const runner = createStrategyJobRunner({ ...fastRunner, kinds: ["sweep"] });
    runner.start();
    try {
      await waitFor(() => sweepState(sweepId), (s) => s.status === "RUNNING" && s.completedCount >= 20);
    } finally {
      clearInterval(ticker);
      await runner.stop();
    }

    expect(await sweepState(sweepId)).toEqual({ status: "QUEUED", completedCount: 0, results: 0 });
    // The sweep yields after every backtest (a few ms each); without that, 20+ backtests would run in one block.
    expect(maxGapMs).toBeLessThan(250);

    // A fresh runner picks the requeued sweep up again and finishes it.
    const second = createStrategyJobRunner({ ...fastRunner, kinds: ["sweep"] });
    second.start();
    try {
      await waitFor(() => sweepState(sweepId), (s) => s.status === "COMPLETED", 60_000);
    } finally {
      await second.stop();
    }
    expect(await sweepState(sweepId)).toEqual({ status: "COMPLETED", completedCount: 500, results: 500 });

    const caller = strategyOptimisationRouter.createCaller({ userId, email: "runner@test.com", role: "user" });
    const { robustness } = await caller.getSweep({ sweepId });
    expect(robustness).not.toBeNull();
    expect([robustness!.paramX, robustness!.paramY]).toEqual(["fast", "slow"]);
    expect(robustness!.analysis.heatmapMatrix).toHaveLength(500);
  }, 90_000);

  it("requeues and runs a RUNNING job whose worker died, and fails one too old to retry", async () => {
    if (!enabled) return console.log("  Skipping runner test: TEST_DATABASE_URL not set");
    const sql = getSqlClient();
    const [stale] = await sql`
      INSERT INTO public.strategy_backtest_jobs
        (user_id, strategy_version_id, symbol_or_universe, timeframe, from_date, to_date, status, worker_id, started_at, heartbeat_at, requested_at)
      VALUES (${userId}, ${versionId}, ${symbol}, '1d', ${from}::timestamptz, ${to}::timestamptz, 'RUNNING', 'dead-worker',
        now() - interval '20 minutes', now() - interval '10 minutes', now() - interval '20 minutes')
      RETURNING id`;
    const [ancient] = await sql`
      INSERT INTO public.strategy_backtest_jobs
        (user_id, strategy_version_id, symbol_or_universe, timeframe, from_date, to_date, status, worker_id, started_at, heartbeat_at, requested_at)
      VALUES (${userId}, ${versionId}, ${symbol}, '1d', ${from}::timestamptz, ${to}::timestamptz, 'RUNNING', 'dead-worker',
        now() - interval '7 hours', now() - interval '6 hours', now() - interval '7 hours')
      RETURNING id`;
    // A sweep whose worker died mid-run: updated_at is its heartbeat.
    const staleSweep = await insertSweep([largeGrid[0]], "RUNNING");
    await sql`UPDATE public.strategy_parameter_sweeps SET updated_at = now() - interval '10 minutes', completed_count = 10 WHERE id = ${staleSweep}`;

    const runner = createStrategyJobRunner({ ...fastRunner, kinds: ["backtest", "sweep"] });
    runner.start();
    try {
      await waitFor(() => backtestState(stale.id), (s) => s.status === "COMPLETED");
      await waitFor(() => sweepState(staleSweep), (s) => s.status === "COMPLETED");
    } finally {
      await runner.stop();
    }

    expect((await backtestState(stale.id)).workerId).toBe(runner.workerId);
    expect(await backtestState(ancient.id)).toMatchObject({ status: "FAILED", errorCode: "ABANDONED" });
    expect(await sweepState(staleSweep)).toEqual({ status: "COMPLETED", completedCount: 25, results: 25 });
  }, 60_000);

  it("fails a job that runs past the time budget", async () => {
    if (!enabled) return console.log("  Skipping runner test: TEST_DATABASE_URL not set");
    const sweepId = await insertSweep(largeGrid);

    const runner = createStrategyJobRunner({ ...fastRunner, kinds: ["sweep"], jobTimeBudgetMs: 150 });
    runner.start();
    try {
      await waitFor(() => sweepState(sweepId), (s) => s.status === "FAILED");
    } finally {
      await runner.stop();
    }
    expect((await sweepState(sweepId)).results).toBe(0);
  });

  it("runs a walk-forward run and lists it with a chartable out-of-sample curve", async () => {
    if (!enabled) return console.log("  Skipping runner test: TEST_DATABASE_URL not set");
    const caller = strategyOptimisationRouter.createCaller({ userId, email: "runner@test.com", role: "user" });
    const { run } = await caller.createWalkForward({
      strategyId,
      mode: "ROLLING",
      parameters: [{ name: "fast", path: "entry.children.0.left.params.period", values: [3, 5, 8] }],
      symbol,
      timeframe: "1d",
      from,
      to,
      trainingWindowDays: 45,
      validationWindowDays: 15,
      minimumWindows: 2,
    });

    const runner = createStrategyJobRunner({ ...fastRunner, kinds: ["walk-forward"] });
    runner.start();
    try {
      await waitFor(async () => (await caller.getWalkForward({ runId: run.id })).run.status, (s) => s !== "QUEUED" && s !== "RUNNING");
    } finally {
      await runner.stop();
    }

    const { run: done, windows } = await caller.getWalkForward({ runId: run.id });
    expect(done.status).toBe("COMPLETED");
    const summary = done.oosSummary as { totalWindowsCount: number; oosEquityCurve: Array<{ timestamp: number; equity: number }> };
    expect(windows).toHaveLength(summary.totalWindowsCount);
    expect(summary.oosEquityCurve.length).toBeGreaterThan(1);
    const { runs } = await caller.listWalkForwards({ strategyId });
    expect(runs.map((r) => r.id)).toContain(run.id);
  }, 60_000);
});
