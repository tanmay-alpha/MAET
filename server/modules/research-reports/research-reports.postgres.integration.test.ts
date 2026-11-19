/**
 * Research run reports — PostgreSQL integration tests.
 *
 * Runs real backtest jobs through the job runner, then reads their reports, CSV exports and
 * comparison through the researchReports router: what the worker records at completion, that the
 * report is stable, and that another user's run is NOT_FOUND everywhere. Skipped without
 * TEST_DATABASE_URL.
 */

import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { TRPCError } from "@trpc/server";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { strategyBacktestsRouter } from "../../api/trpc/routers/strategy-backtests";
import { researchReportsRouter } from "../../api/trpc/routers/research-reports";
import { createStrategyJobRunner } from "../strategy-jobs/runner";
import { loadJobCandles } from "../strategy-jobs/candles";
import { candleFingerprint, serverGitCommit } from "./hashing";
import type { StrategyDefinition, StrategyExecutionConfig } from "../../../shared/strategy/ast";

const enabled = Boolean(process.env.TEST_DATABASE_URL);
const owner = "00000000-0000-0000-0000-0000000000e1";
const intruder = "00000000-0000-0000-0000-0000000000e2";
const strategyId = "e1000000-0000-0000-0000-000000000001";
const versionLow = "e1000000-0000-0000-0000-000000000002";
const versionHigh = "e1000000-0000-0000-0000-000000000003";
const intruderStrategy = "e2000000-0000-0000-0000-000000000001";
const intruderVersion = "e2000000-0000-0000-0000-000000000002";
const symbol = "REPORTTEST";
const start = Date.UTC(2023, 0, 2);
const BARS = 240;
const day = (i: number) => new Date(start + i * 86_400_000).toISOString();

const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
function definition(slippageBps: number): StrategyDefinition {
  return {
    name: "report",
    direction: "LONG_ONLY",
    entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: "CROSS_ABOVE", right: sma(20) }] },
    exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(5), operator: "CROSS_BELOW", right: sma(20) }] },
    risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
    execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps, initialCapital: 100_000 } as StrategyExecutionConfig,
  };
}

const ownerCtx = { userId: owner, email: "owner@test.com", role: "user" };
const intruderCtx = { userId: intruder, email: "intruder@test.com", role: "user" };

async function expectNotFound(call: Promise<unknown>) {
  const error = await call.then(() => null, (e: unknown) => e);
  expect(error).toBeInstanceOf(TRPCError);
  expect((error as TRPCError).code).toBe("NOT_FOUND");
}

/** Polls real state: the runner works on wall-clock time against a real database, so fake timers cannot drive it. */
async function waitForCompletion(ids: string[]) {
  const sql = getSqlClient();
  const deadline = Date.now() + 60_000;
  for (;;) {
    const rows = await sql`SELECT status FROM public.strategy_backtest_jobs WHERE id = ANY(${ids}::uuid[])`;
    if (rows.every((r) => r.status !== "QUEUED" && r.status !== "RUNNING")) return rows.map((r) => r.status as string);
    if (Date.now() > deadline) throw new Error("Timed out waiting for backtests");
    await Bun.sleep(25);
  }
}

describe("Research run reports (PostgreSQL)", () => {
  const jobs: { low?: string; high?: string; late?: string; intruder?: string; queued?: string } = {};

  beforeAll(async () => {
    if (!enabled) return;
    await applyMigrations();
    const sql = getSqlClient();
    await sql.unsafe(`
      DELETE FROM public.users WHERE id IN ('${owner}', '${intruder}');
      DELETE FROM auth.users WHERE id IN ('${owner}', '${intruder}');
      DELETE FROM public.candles WHERE symbol = '${symbol}';
      INSERT INTO auth.users (id) VALUES ('${owner}'), ('${intruder}');
      INSERT INTO public.users (id, email) VALUES ('${owner}', 'owner@test.com'), ('${intruder}', 'intruder@test.com');
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
      VALUES ('${strategyId}', '${owner}', 'Owner strategy', '{}'), ('${intruderStrategy}', '${intruder}', 'Intruder strategy', '{}');
    `);
    for (const [id, strategy, user, number, slippage] of [
      [versionLow, strategyId, owner, 1, 5],
      [versionHigh, strategyId, owner, 2, 25],
      [intruderVersion, intruderStrategy, intruder, 1, 5],
    ] as const) {
      await sql`
        INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
        VALUES (${id}, ${strategy}, ${user}, ${number}, ${JSON.stringify(definition(slippage))}::jsonb, ${`hash-${id}`}, '4.0.0', '1.0.0')`;
    }
    const candleRows = Array.from({ length: BARS }, (_, i) => {
      const p = 100 * (1 + 0.001 * i) + 8 * Math.sin(i / 7);
      return { symbol, timeframe: "1d", ts: day(i), open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 500_000, source: "test" };
    });
    await sql`INSERT INTO public.candles ${sql(candleRows)}`;

    const owned = strategyBacktestsRouter.createCaller(ownerCtx);
    const other = strategyBacktestsRouter.createCaller(intruderCtx);
    jobs.low = (await owned.createJob({ strategyVersionId: versionLow, symbolOrUniverse: symbol, timeframe: "1d", from: day(0), to: day(BARS - 1) })).job.id;
    jobs.high = (await owned.createJob({ strategyVersionId: versionHigh, symbolOrUniverse: symbol, timeframe: "1d", from: day(0), to: day(BARS - 1), benchmarkSymbol: "NIFTY50" })).job.id;
    // Overlaps the other runs on its last 100 days only.
    jobs.late = (await owned.createJob({ strategyVersionId: versionLow, symbolOrUniverse: symbol, timeframe: "1d", from: day(60), to: day(BARS - 1) })).job.id;
    jobs.intruder = (await other.createJob({ strategyVersionId: intruderVersion, symbolOrUniverse: symbol, timeframe: "1d", from: day(0), to: day(BARS - 1) })).job.id;

    const runner = createStrategyJobRunner({ kinds: ["backtest"], pollIntervalMs: 50, heartbeatIntervalMs: 100 });
    runner.start();
    try {
      expect(await waitForCompletion([jobs.low, jobs.high, jobs.late, jobs.intruder])).toEqual(["COMPLETED", "COMPLETED", "COMPLETED", "COMPLETED"]);
    } finally {
      await runner.stop();
    }
    // Queued after the runner stopped: never runs.
    jobs.queued = (await owned.createJob({ strategyVersionId: versionLow, symbolOrUniverse: symbol, timeframe: "1d", from: day(0), to: day(BARS - 1) })).job.id;
  }, 120_000);

  afterAll(async () => {
    if (!enabled) return;
    const sql = getSqlClient();
    await sql`DELETE FROM public.users WHERE id IN (${owner}, ${intruder})`;
    await sql`DELETE FROM auth.users WHERE id IN (${owner}, ${intruder})`;
    await sql`DELETE FROM public.candles WHERE symbol = ${symbol}`;
  });

  it("records the server commit and the exact candles at completion, and reports them", async () => {
    if (!enabled) return console.log("  Skipping research report test: TEST_DATABASE_URL not set");
    const caller = researchReportsRouter.createCaller(ownerCtx);
    const report = await caller.getReport({ jobId: jobs.low! });
    const used = await loadJobCandles(symbol, "1d", new Date(day(0)), new Date(day(BARS - 1)));

    expect(report.identity).toMatchObject({ jobId: jobs.low, strategyId, strategyName: "Owner strategy", versionNumber: 1 });
    expect(report.reproducible.server.gitCommitSha).toBe(serverGitCommit());
    expect(report.reproducible.data).toMatchObject({ symbols: [symbol], candleCount: BARS, firstCandleTs: day(0), lastCandleTs: day(BARS - 1) });
    expect(report.reproducible.data.candleSha256).toBe(candleFingerprint(used));
    expect(report.reproducible.data.candleSha256!.startsWith(report.reproducible.data.engineDataHash!)).toBe(true);
    expect(report.reproducible.versions.indicatorEngine).not.toBeNull();
    expect(report.reproducible.missingFields).toEqual([]);
    expect(report.reproducible.execution).toMatchObject({ slippageBps: 5, initialCapital: 100_000 });
    expect(report.reproducible.results.tradeCount).toBeGreaterThan(0);

    // Immutable: reading it again gives the same hash.
    const again = await caller.getReport({ jobId: jobs.low! });
    expect(again.reproducibilityHash.value).toBe(report.reproducibilityHash.value);

    const trades = await caller.exportCsv({ jobId: jobs.low!, kind: "trades" });
    const equity = await caller.exportCsv({ jobId: jobs.low!, kind: "equity" });
    expect(trades.sha256).toBe(report.reproducible.results.tradesCsvSha256);
    expect(equity.sha256).toBe(report.reproducible.results.equityCsvSha256);
    expect(trades.content.trimEnd().split("\r\n")).toHaveLength(report.reproducible.results.tradeCount + 1);
    expect(equity.content.trimEnd().split("\r\n")).toHaveLength(report.reproducible.results.equityPointCount + 1);
  });

  it("shows a run that completed without recorded metadata as not recorded", async () => {
    if (!enabled) return;
    const sql = getSqlClient();
    await sql`UPDATE public.strategy_backtest_jobs SET reproducibility_metadata = NULL WHERE id = ${jobs.late!}`;
    const report = await researchReportsRouter.createCaller(ownerCtx).getReport({ jobId: jobs.late! });
    expect(report.reproducible.server.gitCommitSha).toBeNull();
    expect(report.reproducible.data.candleCount).toBeNull();
    expect(report.reproducible.missingFields).toContain("server.gitCommitSha");
    expect(report.reproducible.missingFields).toContain("data.candleSha256");
    expect(report.reproducible.data.engineDataHash).toMatch(/^[0-9a-f]{16}$/);
  });

  it("compares runs on their common dates and flags different cost assumptions and benchmarks", async () => {
    if (!enabled) return;
    const caller = researchReportsRouter.createCaller(ownerCtx);
    const sameCosts = await caller.compare({ jobIds: [jobs.low!, jobs.late!] });
    expect(sameCosts.likeForLike).toBe(true);
    expect(sameCosts.intersection.status).toBe("OK");
    // The late run starts trading after its first bar, so the window starts no earlier than day 60.
    expect(sameCosts.intersection.from! >= day(60).slice(0, 10)).toBe(true);
    expect(sameCosts.intersection.to).toBe(day(BARS - 1).slice(0, 10));
    expect(sameCosts.runs[0].excludedDates).toBeGreaterThan(0);
    for (const run of sameCosts.runs) expect(run.series[0].equity).toBe(100);

    const mixed = await caller.compare({ jobIds: [jobs.low!, jobs.high!] });
    expect(mixed.likeForLike).toBe(false);
    expect(mixed.flags.map((f) => f.code)).toEqual(["COST_ASSUMPTIONS_DIFFER", "BENCHMARK_DIFFERS"]);
    expect(mixed.flags[0].message).toContain("slippageBps");
    // Same signals, higher slippage: costs eat more of the account.
    expect(mixed.runs[1].metrics.costDrag!).toBeGreaterThan(mixed.runs[0].metrics.costDrag!);
  });

  it("lists only the user's completed runs", async () => {
    if (!enabled) return;
    const { runs } = await researchReportsRouter.createCaller(ownerCtx).listRuns();
    const ids = runs.map((r) => r.jobId);
    expect(ids).toEqual(expect.arrayContaining([jobs.low, jobs.high, jobs.late]));
    expect(ids).not.toContain(jobs.intruder);
    expect(ids).not.toContain(jobs.queued);
  });

  it("returns NOT_FOUND for another user's run on every procedure", async () => {
    if (!enabled) return;
    const intruderCaller = researchReportsRouter.createCaller(intruderCtx);
    await expectNotFound(intruderCaller.getReport({ jobId: jobs.low! }));
    await expectNotFound(intruderCaller.exportCsv({ jobId: jobs.low!, kind: "trades" }));
    await expectNotFound(intruderCaller.exportCsv({ jobId: jobs.low!, kind: "equity" }));
    // Mixing in one of their own runs does not let them through.
    await expectNotFound(intruderCaller.compare({ jobIds: [jobs.intruder!, jobs.low!] }));
    expect((await intruderCaller.listRuns()).runs.map((r) => r.jobId)).toEqual([jobs.intruder]);
    // Their own run still works.
    expect((await intruderCaller.getReport({ jobId: jobs.intruder! })).identity.jobId).toBe(jobs.intruder);
  });

  it("returns NOT_FOUND for a run that has not completed", async () => {
    if (!enabled) return;
    const caller = researchReportsRouter.createCaller(ownerCtx);
    await expectNotFound(caller.getReport({ jobId: jobs.queued! }));
    await expectNotFound(caller.compare({ jobIds: [jobs.low!, jobs.queued!] }));
  });
});
