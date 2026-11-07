import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationsDir = import.meta.dir;
const migrationPath = join(migrationsDir, "0028_client_read_only_owner_tables.sql");

const OWNER_TABLES = [
  "user_watchlists", "watchlist_items", "saved_screener_definitions", "saved_screener_runs",
  "alert_events", "user_notifications", "portfolio_snapshots", "research_notes",
  "feature_preferences", "saved_comparisons", "alerts", "backtest_presets",
  "chart_workspaces", "chart_panes", "chart_drawings", "indicator_templates", "trade_theses", "trade_reviews",
  "strategy_definitions", "strategy_versions", "strategy_backtest_jobs", "strategy_backtest_trades",
  "strategy_equity_points", "strategy_parameter_sweeps", "strategy_sweep_results",
  "strategy_walk_forward_runs", "strategy_walk_forward_windows", "strategy_deployments",
  "strategy_signal_events", "strategy_execution_decisions", "strategy_performance_snapshots",
  "strategy_replay_sessions",
];

describe("Migration 0028 client read-only owner tables", () => {
  it("leaves clients read-only access to their own rows (Supabase default grants)", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0028 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const freshDb = `maet_m0028_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const freshUrl = new URL(databaseUrl);
    freshUrl.pathname = `/${freshDb}`;

    await admin.unsafe(`CREATE DATABASE ${freshDb}`);
    const sql = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      // Mirror Supabase: auth stubs, client roles, and the default privileges
      // that grant every new public table to anon/authenticated.
      await sql.unsafe(`
        CREATE SCHEMA IF NOT EXISTS auth;
        CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY DEFAULT gen_random_uuid());
        CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid AS $$
          SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid;
        $$ LANGUAGE sql STABLE;
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
        END $$;
        GRANT USAGE ON SCHEMA auth TO anon, authenticated;
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      `);

      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        await sql.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
      }

      const present = await sql<{ table_name: string }[]>`
        SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY(${OWNER_TABLES}) ORDER BY c.relname
      `;
      expect(present.map((row) => row.table_name)).toEqual([...OWNER_TABLES].sort());

      const writable = await sql<{ table_name: string }[]>`
        SELECT c.relname AS table_name
        FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relname = ANY(${OWNER_TABLES})
          AND (
            NOT c.relrowsecurity
            OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
            OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
            OR NOT has_table_privilege('authenticated', c.oid, 'SELECT')
          )
        ORDER BY c.relname
      `;
      expect(writable.map((row) => row.table_name)).toEqual([]);

      const writePolicies = await sql<{ name: string }[]>`
        SELECT tablename || '.' || policyname AS name FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY(${OWNER_TABLES}) AND cmd <> 'SELECT'
        ORDER BY name
      `;
      expect(writePolicies.map((row) => row.name)).toEqual([]);

      // Behaviour as a signed-in PostgREST client: reads own rows only, cannot write.
      const [owner, other] = [crypto.randomUUID(), crypto.randomUUID()];
      for (const id of [owner, other]) {
        await sql`INSERT INTO auth.users (id) VALUES (${id})`;
        await sql`INSERT INTO public.users (id, email) VALUES (${id}, ${`m0028-${id}@example.com`})`;
        await sql`INSERT INTO public.strategy_definitions (user_id, name, current_draft) VALUES (${id}, 'S', '{}')`;
      }
      const asClient = async (userId: string, statement: string) => {
        try {
          const rows = await sql.begin(async (tx) => {
            await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
            await tx.unsafe("SET LOCAL ROLE authenticated");
            return tx.unsafe(statement);
          });
          return { rows: [...rows], error: null };
        } catch (error) {
          return { rows: [], error: error instanceof postgres.PostgresError ? error.code : String(error) };
        }
      };
      const visible = await asClient(owner, "SELECT user_id FROM public.strategy_definitions");
      expect(visible.rows.map((row) => row.user_id)).toEqual([owner]);
      expect((await asClient(owner, "UPDATE public.strategy_definitions SET name = 'x'")).error).toBe("42501");
      expect((await asClient(owner, "DELETE FROM public.strategy_definitions")).error).toBe("42501");
      expect(
        (await asClient(owner, `INSERT INTO public.strategy_definitions (user_id, name, current_draft) VALUES ('${owner}', 'y', '{}')`)).error,
      ).toBe("42501");

      // Idempotent: re-applying 0028 must not fail.
      await sql.unsafe(readFileSync(migrationPath, "utf8"));
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${freshDb} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);
});
