/**
 * Strategy Parameter Sweeps — Integration Test Suite.
 *
 * Runs a sweep row (in the shape the API stores) through the worker against PostgreSQL and checks
 * that each parameter combination really changes the backtest. Skipped without TEST_DATABASE_URL.
 */

import { describe, expect, it } from "bun:test";
import { applyMigrations } from "../../scripts/apply-migrations";
import { getSqlClient } from "../../data/drizzle/client";
import { processSweep } from "../../workers/sweep-worker";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

describe("Strategy parameter sweep worker", () => {
  it("backtests every combination with its parameters applied and persists the results", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping sweep PostgreSQL test: TEST_DATABASE_URL not set");
      return;
    }
    await applyMigrations();
    const sql = getSqlClient();

    const userId = "00000000-0000-0000-0000-0000000000f2";
    const strategyId = "f2000000-0000-0000-0000-000000000001";
    const versionId = "f2000000-0000-0000-0000-000000000002";
    const sweepId = "f2000000-0000-0000-0000-000000000003";
    const symbol = "SWTEST";
    const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });
    const definition: StrategyDefinition = {
      name: "sweep",
      direction: "LONG_ONLY",
      entry: { kind: "GROUP", id: "e", combinator: "AND", children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: "CROSS_ABOVE", right: sma(20) }] },
      exit: { kind: "GROUP", id: "x", combinator: "AND", children: [{ kind: "CONDITION", id: "x1", left: sma(5), operator: "CROSS_BELOW", right: sma(20) }] },
      risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
      execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "VOLUME_AWARE", slippageBps: 5, initialCapital: 100_000 },
    };
    const parameters = [{ name: "fast", path: "entry.children.0.left.params.period", values: [3, 5, 8] }];

    await sql.unsafe(`
      DELETE FROM public.strategy_parameter_sweeps WHERE id = '${sweepId}';
      DELETE FROM public.candles WHERE symbol = '${symbol}';
      INSERT INTO auth.users (id) VALUES ('${userId}') ON CONFLICT DO NOTHING;
      INSERT INTO public.users (id, email) VALUES ('${userId}', 'sweep@test.com') ON CONFLICT DO NOTHING;
      INSERT INTO public.strategy_definitions (id, user_id, name, current_draft)
        VALUES ('${strategyId}', '${userId}', 'Sweep', '{}') ON CONFLICT DO NOTHING;
    `);
    await sql`
      INSERT INTO public.strategy_versions (id, strategy_id, user_id, version_number, definition, definition_hash, engine_version, indicator_version)
      VALUES (${versionId}, ${strategyId}, ${userId}, 1, ${JSON.stringify(definition)}::jsonb, 'sweep-hash', '3.0.0', '1.0.0')
      ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition
    `;
    const start = Date.UTC(2023, 0, 2);
    const candleRows = Array.from({ length: 200 }, (_, i) => {
      const p = 100 + 10 * Math.sin(i / 6) + i * 0.05;
      return { symbol, timeframe: "1d", ts: new Date(start + i * 86_400_000).toISOString(), open: p, high: p + 1, low: p - 1, close: p, volume: 100_000, source: "test" };
    });
    await sql`INSERT INTO public.candles ${sql(candleRows)}`;
    await sql`
      INSERT INTO public.strategy_parameter_sweeps
        (id, user_id, strategy_id, parameters, combination_count, symbol_or_universe, timeframe, from_date, to_date, status)
      VALUES (${sweepId}, ${userId}, ${strategyId}, ${JSON.stringify(parameters)}::jsonb, 3, ${symbol}, '1d',
        ${new Date(start).toISOString()}::timestamptz, ${new Date(start + 199 * 86_400_000).toISOString()}::timestamptz, 'RUNNING')
    `;

    const [sweep] = await sql`SELECT * FROM public.strategy_parameter_sweeps WHERE id = ${sweepId}`;
    await processSweep(sweep);

    const [done] = await sql`SELECT status, completed_count FROM public.strategy_parameter_sweeps WHERE id = ${sweepId}`;
    expect(done.status).toBe("COMPLETED");
    expect(done.completed_count).toBe(3);

    const results = await sql`
      SELECT parameter_values, result_summary FROM public.strategy_sweep_results
      WHERE sweep_id = ${sweepId} ORDER BY combination_index`;
    expect(results.map((r) => r.parameter_values.fast)).toEqual([3, 5, 8]);
    // The parameter reaches the strategy: different fast periods give different backtests.
    expect(new Set(results.map((r) => JSON.stringify(r.result_summary))).size).toBeGreaterThan(1);

    await sql`DELETE FROM public.strategy_parameter_sweeps WHERE id = ${sweepId}`;
    await sql`DELETE FROM public.candles WHERE symbol = ${symbol}`;
  });
});
