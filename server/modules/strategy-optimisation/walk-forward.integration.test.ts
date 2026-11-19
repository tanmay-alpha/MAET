/**
 * Walk-Forward Optimisation — Integration Test Suite.
 *
 * Runs a queued strategy_walk_forward_runs row through the worker against PostgreSQL (skipped
 * without TEST_DATABASE_URL) and checks the engine-config mapping of the API's window settings.
 */

import { describe, expect, it } from "bun:test";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { runWalkForwardJob, walkForwardEngineConfig } from "../../workers/walk-forward-worker";
import { claimNextWalkForward } from "./repository";
import { uninterruptedJobContext } from "../strategy-jobs/job-context";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

describe("Walk-forward worker", () => {
  it("maps the run onto calendar-day training, validation and test spans over the inclusive date range", () => {
    const config = walkForwardEngineConfig({
      mode: "ROLLING",
      windowCount: 4,
      trainingDays: 120,
      validationDays: 40,
      fromDate: new Date("2024-01-01T00:00:00.000Z"),
      toDate: new Date("2024-12-31T23:59:59.999Z"),
    });
    expect(config).toEqual({
      windowType: "ROLLING",
      maxWindows: 4,
      trainingDays: 120,
      validationDays: 40,
      testDays: 40,
      rangeStart: new Date("2024-01-01T00:00:00.000Z"),
      rangeEnd: new Date("2025-01-01T00:00:00.000Z"),
    });
  });

  it("claims a queued run, optimises the swept parameter and persists every phase", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.log("  Skipping walk-forward PostgreSQL test: TEST_DATABASE_URL not set");
      return;
    }
    await applyMigrations();
    const sql = getSqlClient();

    const userId = "00000000-0000-0000-0000-0000000000f1";
    const strategyId = "f1000000-0000-0000-0000-000000000001";
    const versionId = "f1000000-0000-0000-0000-000000000002";
    const runId = "f1000000-0000-0000-0000-000000000003";
    const symbol = "WFTEST";
    const sma = (period: number) => ({ kind: "INDICATOR", indicator: "SMA", params: { period }, lag: 0 });
    const definition: StrategyDefinition = {
      name: "wf",
      direction: "LONG_ONLY",
      entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5) as never, operator: "CROSS_ABOVE", right: sma(20) as never }] },
      exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(5) as never, operator: "CROSS_BELOW", right: sma(20) as never }] },
      risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
      execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5, initialCapital: 100_000 },
    };

    await sql.unsafe(`
      DELETE FROM public.strategy_walk_forward_runs WHERE id = '${runId}';
      DELETE FROM public.candles WHERE symbol = '${symbol}';
      INSERT INTO auth.users (id) VALUES ('${userId}') ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, email) VALUES ('${userId}', 'wf@test.com') ON CONFLICT DO NOTHING;
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES ('${strategyId}', '${userId}', 'WF', '{}') ON CONFLICT DO NOTHING;
    `);
    await sql`
      INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES (${versionId}, ${strategyId}, ${userId}, 1, ${JSON.stringify(definition)}::jsonb, 'wf-hash', '3.0.0', '1.0.0')
      ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition
    `;
    const start = Date.UTC(2023, 0, 2);
    const candleRows = Array.from({ length: 400 }, (_, i) => {
      const p = 100 * (1 + 0.001 * i) + 6 * Math.sin(i / 9);
      return { symbol, timeframe: "1d", ts: new Date(start + i * 86_400_000).toISOString(), open: p, high: p * 1.01, low: p * 0.99, close: p, volume: 500_000, source: "test" };
    });
    await sql`INSERT INTO public.candles ${sql(candleRows)}`;
    await sql`
      INSERT INTO public.strategy_walk_forward_runs
        (id, user_id, strategy_id, mode, parameters, symbol, timeframe, from_date, to_date, training_days, validation_days, window_count)
      VALUES (${runId}, ${userId}, ${strategyId}, 'ROLLING',
        ${JSON.stringify([{ name: "fast", path: "entry.children.0.left.params.period", values: [3, 5, 8] }])}::jsonb,
        ${symbol}, '1d', ${new Date(start).toISOString()}::timestamptz, ${new Date(start + 399 * 86_400_000).toISOString()}::timestamptz, 60, 20, 4)
    `;

    // Other queued runs may exist in a shared test DB; drain until ours is claimed.
    let claimed: string | null;
    do {
      claimed = await claimNextWalkForward();
      if (claimed && claimed !== runId) await runWalkForwardJob(claimed, uninterruptedJobContext);
    } while (claimed && claimed !== runId);
    expect(claimed).toBe(runId);
    await runWalkForwardJob(runId, uninterruptedJobContext);

    const [run] = await sql`SELECT status, oos_summary FROM public.strategy_walk_forward_runs WHERE id = ${runId}`;
    expect(run.status).toBe("COMPLETED");
    expect(run.oos_summary.totalWindowsCount).toBe(4);
    expect(run.oos_summary.methodology).toMatchObject({ trainingDays: 60, validationDays: 20, testDays: 20, selection: { trialsPerWindow: 3 } });
    expect(run.oos_summary.benchmark).toMatchObject({ kind: "BUY_AND_HOLD", tradeCount: 1 });

    const windows = await sql`
      SELECT window_index, training_from, training_to, validation_from, validation_to, test_from, test_to, selected_parameters, test_metrics, validation_metrics
      FROM public.strategy_walk_forward_windows WHERE run_id = ${runId} ORDER BY window_index`;
    expect(windows).toHaveLength(4);
    const ms = (value: string | Date) => new Date(value).getTime();
    const day = 86_400_000;
    windows.forEach((w, i) => {
      expect(ms(w.training_to) - ms(w.training_from)).toBe(60 * day);
      expect(ms(w.training_to)).toBe(ms(w.validation_from));
      expect(ms(w.validation_to) - ms(w.validation_from)).toBe(20 * day);
      expect(ms(w.validation_to)).toBe(ms(w.test_from));
      expect(ms(w.test_to) - ms(w.test_from)).toBe(20 * day);
      if (i > 0) expect(ms(w.test_from)).toBe(ms(windows[i - 1].test_to));
      expect([3, 5, 8]).toContain(w.selected_parameters.fast);
      // Every test segment is recorded; a rejected window's held cash.
      if (!w.validation_metrics.accepted) expect(w.test_metrics).toMatchObject({ position: "CASH", totalReturn: 0 });
      expect(["STRATEGY", "CASH"]).toContain(w.test_metrics.position);
    });
    // The last test segment ends just after the inclusive to_date.
    expect(ms(windows[3].test_to)).toBe(start + 399 * day + 1);

    await sql`DELETE FROM public.strategy_walk_forward_runs WHERE id = ${runId}`;
    await sql`DELETE FROM public.candles WHERE symbol = ${symbol}`;
  });

  it("fails a run whose strategy belongs to another user", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping walk-forward PostgreSQL test: TEST_DATABASE_URL not set");
      return;
    }
    await applyMigrations();
    const sql = getSqlClient();

    const runnerId = "00000000-0000-0000-0000-0000000000f5";
    const ownerId = "00000000-0000-0000-0000-0000000000f6";
    const strategyId = "f6000000-0000-0000-0000-000000000001";
    const runId = "f5000000-0000-0000-0000-000000000003";

    await sql.unsafe(`
      DELETE FROM public.strategy_walk_forward_runs WHERE id = '${runId}';
      INSERT INTO auth.users (id) VALUES ('${runnerId}'), ('${ownerId}') ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, email) VALUES ('${runnerId}', 'wf-runner@test.com'), ('${ownerId}', 'wf-owner@test.com') ON CONFLICT DO NOTHING;
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES ('${strategyId}', '${ownerId}', 'Theirs', '{}') ON CONFLICT DO NOTHING;
    `);
    await sql`
      INSERT INTO public.strategy_versions (strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES (${strategyId}, ${ownerId}, 1, '{}'::jsonb, 'wf-foreign-hash', '3.0.0', '1.0.0')
      ON CONFLICT DO NOTHING
    `;
    // RUNNING, as the runner leaves a claimed row; a QUEUED row could be drained by another test.
    await sql`
      INSERT INTO public.strategy_walk_forward_runs
        (id, user_id, strategy_id, mode, parameters, symbol, timeframe, from_date, to_date, training_days, validation_days, window_count, status)
      VALUES (${runId}, ${runnerId}, ${strategyId}, 'ROLLING',
        ${JSON.stringify([{ name: "fast", path: "entry.children.0.left.params.period", values: [3, 5] }])}::jsonb,
        'WFTEST', '1d', '2023-01-01T00:00:00Z', '2023-12-31T00:00:00Z', 60, 20, 4, 'RUNNING')
    `;

    await runWalkForwardJob(runId, uninterruptedJobContext);

    const [run] = await sql`SELECT status FROM public.strategy_walk_forward_runs WHERE id = ${runId}`;
    expect(run.status).toBe("FAILED");
    const [{ count }] = await sql`SELECT count(*)::int AS count FROM public.strategy_walk_forward_windows WHERE run_id = ${runId}`;
    expect(count).toBe(0);

    await sql`DELETE FROM public.strategy_walk_forward_runs WHERE id = ${runId}`;
  });
});
