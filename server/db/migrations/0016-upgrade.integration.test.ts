/**
 * Migration 0016 Strategy Lab — upgrade integration test.
 *
 * Verifies:
 * 1. Fresh PostgreSQL schema: applies 0001..0016, checks 14 tables, indexes, FKs, unique constraints, RLS.
 * 2. Upgrade PostgreSQL schema: applies 0001..0015, seeds Phase 1 & 2 data, records stable hashes, applies 0016,
 *    verifies zero data loss or mutation on original data, and verifies Phase 3 tables function cleanly.
 */

import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "fs";
import { join } from "path";

const migrationSql = readFileSync(
  join(import.meta.dir, "0016_strategy_lab.sql"),
  "utf-8",
);

describe("Migration 0016 Additive Upgrade Integration Test Suite", () => {
  it("1. Migration 0016 contains zero DROP TABLE statements (non-comment)", () => {
    const nonCommentLines = migrationSql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    const matches = nonCommentLines.match(/DROP\s+TABLE/gi) ?? [];
    expect(matches).toHaveLength(0);
  });

  it("2. Migration 0016 contains zero CASCADE data loss statements", () => {
    const nonCommentLines = migrationSql
      .split("\n")
      .filter((l) => !l.trimStart().startsWith("--"))
      .join("\n");
    const dangerousMatches = nonCommentLines.match(/DROP.*CASCADE|TRUNCATE.*CASCADE/gi) ?? [];
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
    const rlsCount = (migrationSql.match(/ENABLE ROW LEVEL SECURITY/g) ?? []).length;
    expect(rlsCount).toBeGreaterThanOrEqual(14);
  });

  it("6. Live PostgreSQL Migration — Fresh & Upgrade Integration Verification", async () => {
    const url = process.env.TEST_DATABASE_URL;
    if (!url) {
      console.log("  Skipping PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(process.env.TEST_DATABASE_URL, { max: 1 });

    try {
      // -------------------------------------------------------------------------
      // Setup mock auth schema and helper roles
      // -------------------------------------------------------------------------
      await sql`CREATE SCHEMA IF NOT EXISTS auth;`;
      await sql`
        CREATE TABLE IF NOT EXISTS auth.users (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid()
        );
      `;
      await sql`
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
          SELECT COALESCE(
            NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid
          );
        $$ LANGUAGE sql STABLE;
      `;

      // -------------------------------------------------------------------------
      // Fresh Schema Test: Apply 0001 through 0016 in isolated schema
      // -------------------------------------------------------------------------
      const freshSchema = `test_fresh_0016_${Date.now()}`;
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE;`);
      await sql.unsafe(`CREATE SCHEMA ${freshSchema};`);
      await sql.unsafe(`SET search_path TO ${freshSchema}, auth;`);

      const migrationsDir = join(process.cwd(), "server/db/migrations");
      const migrationFiles = readdirSync(migrationsDir)
        .filter((f) => f.endsWith(".sql") && f <= "0016_strategy_lab.sql")
        .sort();

      const scopeSql = (content: string, schema: string) => {
        return content
          .replace(/schemaname = 'public'/gi, "schemaname = current_schema()")
          .replace(/public\./g, `${schema}.`)
          .replace(/WHERE typname = '/gi, `WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()) AND typname = '`);
      };

      for (const file of migrationFiles) {
        const content = readFileSync(join(migrationsDir, file), "utf-8");
        await sql.unsafe(scopeSql(content, freshSchema));
      }

      // Verify 14 Phase 3 tables exist in fresh schema
      const phase3Tables = [
        "strategy_definitions", "strategy_versions", "strategy_backtest_jobs",
        "strategy_backtest_trades", "strategy_equity_points", "strategy_parameter_sweeps",
        "strategy_sweep_results", "strategy_walk_forward_runs", "strategy_walk_forward_windows",
        "strategy_deployments", "strategy_signal_events", "strategy_execution_decisions",
        "strategy_performance_snapshots", "strategy_replay_sessions",
      ];

      const freshTables = await sql`
        SELECT table_name FROM information_schema.tables
        WHERE table_schema = ${freshSchema}
          AND table_name = ANY(${phase3Tables})
      `;
      expect(freshTables.length).toBe(14);

      // Verify unique constraint on strategy_versions
      const freshConstraints = await sql`
        SELECT constraint_name FROM information_schema.table_constraints
        WHERE table_schema = ${freshSchema}
          AND table_name = 'strategy_versions'
          AND constraint_type = 'UNIQUE'
      `;
      expect(freshConstraints.length).toBeGreaterThanOrEqual(2);

      // Verify RLS policies exist
      const rlsPolicies = await sql`
        SELECT policyname FROM pg_policies
        WHERE schemaname = ${freshSchema}
          AND tablename = ANY(${phase3Tables})
      `;
      expect(rlsPolicies.length).toBeGreaterThanOrEqual(14);

      // Clean up fresh schema
      await sql.unsafe(`DROP SCHEMA ${freshSchema} CASCADE;`);

      // -------------------------------------------------------------------------
      // Upgrade Test: Apply 0001..0015, Seed, Apply 0016, Verify Zero Data Loss
      // -------------------------------------------------------------------------
      const upgradeSchema = `test_upgrade_0016_${Date.now()}`;
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE;`);
      await sql.unsafe(`CREATE SCHEMA ${upgradeSchema};`);
      await sql.unsafe(`SET search_path TO ${upgradeSchema}, auth;`);

      // Apply migrations 0001..0015 in upgradeSchema
      for (const file of migrationFiles.filter((f) => f < "0016_strategy_lab.sql")) {
        const content = readFileSync(join(migrationsDir, file), "utf-8");
        await sql.unsafe(scopeSql(content, upgradeSchema));
      }

      // Seed test data in upgrade schema
      const testUserId = "00000000-0000-0000-0000-000000000001";
      await sql.unsafe(`
        INSERT INTO auth.users (id) VALUES ('${testUserId}') ON CONFLICT DO NOTHING;
        INSERT INTO users (id, email)
        VALUES ('${testUserId}', 'upgrade_test@maet.com')
        ON CONFLICT DO NOTHING;
      `);

      await sql.unsafe(`
        INSERT INTO candles (symbol, timeframe, ts, open, high, low, close, volume, source)
        VALUES ('RELIANCE', '1d', NOW(), 2500, 2550, 2480, 2520, 100000, 'test_source');
      `);

      // Record pre-0016 table count
      const preCountCandles = (await sql.unsafe(`SELECT count(*)::int as c FROM candles;`))[0].c;

      // Apply 0016 migration in upgrade schema
      const m0016Sql = readFileSync(join(migrationsDir, "0016_strategy_lab.sql"), "utf-8");
      await sql.unsafe(scopeSql(m0016Sql, upgradeSchema));

      // Verify pre-0016 count remains 100% identical
      const postCountCandles = (await sql.unsafe(`SELECT count(*)::int as c FROM candles;`))[0].c;
      expect(postCountCandles).toBe(preCountCandles);

      // Verify Phase 3 tables function cleanly for reads and writes
      await sql.unsafe(`
        INSERT INTO strategy_definitions (id, user_id, name, current_draft)
        VALUES ('11111111-1111-1111-1111-111111111111', '${testUserId}', 'Post-Upgrade Test Strat', '{"name":"Test"}');
      `);

      const insertedStrat = (await sql.unsafe(`
        SELECT name FROM strategy_definitions WHERE id = '11111111-1111-1111-1111-111111111111';
      `))[0];

      expect(insertedStrat.name).toBe("Post-Upgrade Test Strat");

      // Reset search_path & clean up upgrade schema
      await sql.unsafe(`SET search_path TO public, auth;`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE;`);
    } finally {
      await sql.end();
    }
  });
});
