import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationsDir = import.meta.dir;
const migrationPath = join(migrationsDir, "0026_rls_hardening.sql");

describe("Migration 0026 RLS hardening", () => {
  it("enables RLS on the four previously unprotected tables", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const migrationSql = readFileSync(migrationPath, "utf8");
    for (const table of ["alerts", "backtest_presets", "technical_snapshots", "universe_membership"]) {
      expect(migrationSql).toMatch(
        new RegExp(`ALTER\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?public\\.${table}\\s+ENABLE\\s+ROW\\s+LEVEL\\s+SECURITY`, "iu")
      );
    }
  });

  it("leaves no public table reachable by anon/authenticated without RLS (Supabase default grants)", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0026 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const freshDb = `maet_rls_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
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
        GRANT USAGE ON SCHEMA public TO anon, authenticated, service_role;
        ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO anon, authenticated, service_role;
      `);

      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files) {
        await sql.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
      }

      const exposed = await sql<{ table_name: string }[]>`
        SELECT c.relname AS table_name
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public'
          AND c.relkind IN ('r', 'p')
          AND NOT c.relrowsecurity
          AND (
            has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
            OR has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
          )
        ORDER BY c.relname
      `;
      expect(exposed.map((row) => row.table_name)).toEqual([]);

      const policies = await sql<{ tablename: string; policyname: string }[]>`
        SELECT tablename, policyname FROM pg_policies
        WHERE schemaname = 'public' AND tablename IN ('alerts', 'backtest_presets')
        ORDER BY tablename, policyname
      `;
      // 0028 later drops the *_owner_modify policies: clients only read these tables.
      expect(policies.map((p) => `${p.tablename}.${p.policyname}`)).toEqual([
        "alerts.alerts_owner_select",
        "backtest_presets.backtest_presets_owner_select",
      ]);

      // Idempotent: re-applying 0026 must not fail.
      await sql.unsafe(readFileSync(migrationPath, "utf8"));
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${freshDb} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);
});
