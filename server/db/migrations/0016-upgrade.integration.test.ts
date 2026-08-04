/**
 * Migration 0016 Strategy Lab — upgrade integration test.
 *
 * Verifies:
 * A) The migration SQL contains zero DROP TABLE statements
 * B) The migration SQL contains zero CASCADE data loss statements
 * C) The migration uses IF NOT EXISTS for additive tables and columns
 * D) Live PostgreSQL migration verification (requires TEST_DATABASE_URL)
 */

import { describe, expect, it } from "bun:test";
import { readFileSync } from "fs";
import { join } from "path";

const migrationSql = readFileSync(
  join(import.meta.dir, "0016_strategy_lab.sql"),
  "utf-8",
);

describe("Migration 0016 Additive Upgrade Integration Test Suite", () => {
  it("1. Migration 0016 contains zero DROP TABLE statements", () => {
    const matches = migrationSql.match(/DROP\s+TABLE/gi) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("2. Migration 0016 contains zero CASCADE data loss statements", () => {
    // Only allow ON DELETE CASCADE in FK constraints (not DROP or TRUNCATE CASCADE)
    const dangerousMatches = (migrationSql.match(/DROP.*CASCADE|TRUNCATE.*CASCADE/gi) ?? []);
    expect(dangerousMatches).toHaveLength(0);
  });

  it("3. Migration 0016 uses IF NOT EXISTS for additive tables and columns", () => {
    const createTableStatements = migrationSql.match(/CREATE TABLE\s+(?!IF NOT EXISTS)/gi) ?? [];
    expect(createTableStatements).toHaveLength(0);

    const addColumnStatements = migrationSql.match(/ADD COLUMN\s+(?!IF NOT EXISTS)/gi) ?? [];
    expect(addColumnStatements).toHaveLength(0);
  });

  it("4. Migration 0016 defines all 14 required Phase 3 tables", () => {
    const expectedTables = [
      "strategy_definitions",
      "strategy_versions",
      "strategy_backtest_jobs",
      "strategy_backtest_trades",
      "strategy_equity_points",
      "strategy_parameter_sweeps",
      "strategy_sweep_results",
      "strategy_walk_forward_runs",
      "strategy_walk_forward_windows",
      "strategy_deployments",
      "strategy_signal_events",
      "strategy_execution_decisions",
      "strategy_performance_snapshots",
      "strategy_replay_sessions",
    ];
    for (const table of expectedTables) {
      expect(migrationSql).toContain(table);
    }
  });

  it("5. Migration 0016 uses RLS for all Phase 3 tables", () => {
    expect(migrationSql).toContain("ENABLE ROW LEVEL SECURITY");
    const rlsCount = (migrationSql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length;
    // 14 tables must each enable RLS
    expect(rlsCount).toBeGreaterThanOrEqual(14);
  });

  it("6. Live PostgreSQL migration upgrade verification (DB contract test)", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.log("  Skipping: TEST_DATABASE_URL not set");
      return;
    }

    const { db } = await import("../../data/drizzle/client");
    const { sql } = await import("drizzle-orm");

    // Apply migration
    await db.execute(sql.raw(migrationSql));

    // Verify core tables exist
    const result = await db.execute(sql`
      SELECT table_name FROM information_schema.tables
      WHERE table_schema = 'public'
        AND table_name IN (
          'strategy_definitions', 'strategy_versions', 'strategy_backtest_jobs',
          'strategy_backtest_trades', 'strategy_equity_points',
          'strategy_parameter_sweeps', 'strategy_sweep_results',
          'strategy_walk_forward_runs', 'strategy_walk_forward_windows',
          'strategy_deployments', 'strategy_signal_events',
          'strategy_execution_decisions', 'strategy_performance_snapshots',
          'strategy_replay_sessions'
        )
      ORDER BY table_name
    `);

    expect(result.rows.length).toBe(14);

    // Verify strategy_backtest_jobs has correct column
    const colResult = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'strategy_backtest_jobs'
        AND column_name = 'strategy_version_id'
    `);
    expect(colResult.rows.length).toBe(1);

    // Verify backtest_runs was extended with strategy_version_id
    const extResult = await db.execute(sql`
      SELECT column_name FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'backtest_runs'
        AND column_name = 'strategy_version_id'
    `);
    expect(extResult.rows.length).toBe(1);

    // Verify unique constraint on strategy_versions
    const constraintResult = await db.execute(sql`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_schema = 'public'
        AND table_name = 'strategy_versions'
        AND constraint_type = 'UNIQUE'
    `);
    expect(constraintResult.rows.length).toBeGreaterThanOrEqual(2);
  });
});
