import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationsDir = import.meta.dir;
const MIGRATION_0027 = "0027_paper_portfolio_daily_snapshots.sql";

async function withFreshDatabase(run: (sql: postgres.Sql) => Promise<void>): Promise<void> {
  const databaseUrl = process.env.TEST_DATABASE_URL!;
  const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
  const freshDb = `maet_m0027_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
  const freshUrl = new URL(databaseUrl);
  freshUrl.pathname = `/${freshDb}`;
  await admin.unsafe(`CREATE DATABASE ${freshDb}`);
  const sql = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} });
  try {
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
    `);
    const before = readdirSync(migrationsDir)
      .filter((file) => file.endsWith(".sql") && file < MIGRATION_0027)
      .sort();
    for (const file of before) {
      await sql.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
    }
    await run(sql);
  } finally {
    await sql.end();
    await admin.unsafe(`DROP DATABASE IF EXISTS ${freshDb} WITH (FORCE)`);
    await admin.end();
  }
}

async function columnsOf(sql: postgres.Sql, table: string): Promise<string[]> {
  const rows = await sql<{ column_name: string }[]>`
    SELECT column_name FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = ${table}
  `;
  return rows.map((row) => row.column_name).sort();
}

async function createUser(sql: postgres.Sql): Promise<string> {
  const userId = crypto.randomUUID();
  await sql`INSERT INTO auth.users (id) VALUES (${userId})`;
  await sql`INSERT INTO public.users (id, email) VALUES (${userId}, ${`m0027-${userId}@example.com`})`;
  return userId;
}

const migration0027 = () => readFileSync(join(migrationsDir, MIGRATION_0027), "utf8");

describe("Migration 0027 paper portfolio daily snapshots", () => {
  it("locks the legacy table before checking whether it is empty", () => {
    const code = migration0027().replace(/--[^\n]*/gu, "");
    const lock = code.search(/LOCK\s+TABLE\s+public\.paper_portfolio_snapshots\s+IN\s+ACCESS\s+EXCLUSIVE\s+MODE/iu);
    const emptinessCheck = code.search(/IF\s+EXISTS\s*\(\s*SELECT\s+1\s+FROM\s+public\.paper_portfolio_snapshots\s*\)/iu);
    expect(lock).toBeGreaterThan(-1);
    expect(emptinessCheck).toBeGreaterThan(lock);
  });

  it("replaces the never-written 0008 table with a per-generation, per-date one", async () => {
    if (!process.env.TEST_DATABASE_URL) {
      console.log("  Skipping migration 0027 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }
    await withFreshDatabase(async (sql) => {
      expect(await columnsOf(sql, "paper_portfolio_snapshots")).not.toContain("snapshot_date");
      await sql.unsafe(migration0027());

      const columns = await columnsOf(sql, "paper_portfolio_snapshots");
      for (const column of ["generation", "snapshot_date", "fees_to_date", "positions_market_value", "stale_prices", "price_source", "is_final"]) {
        expect(columns).toContain(column);
      }
      // The empty legacy table is dropped, not kept around.
      expect((await sql`SELECT to_regclass('public.paper_portfolio_snapshots_legacy_0008') AS t`)[0]!.t).toBeNull();

      const [rls] = await sql<{ relrowsecurity: boolean }[]>`
        SELECT relrowsecurity FROM pg_class WHERE oid = 'public.paper_portfolio_snapshots'::regclass
      `;
      expect(rls!.relrowsecurity).toBe(true);

      // One row per (user, generation, date).
      const userId = await createUser(sql);
      const insert = (generation: number) => sql`
        INSERT INTO public.paper_portfolio_snapshots
          (user_id, generation, snapshot_date, initial_cash, cash_balance, positions_market_value, equity,
           realized_pnl, unrealized_pnl, fees_to_date, stale_prices, price_source, is_final, captured_by)
        VALUES (${userId}, ${generation}, '2026-10-05', 1000000, 1000000, 0, 1000000, 0, 0, 0, false, 'none', true, 'SCHEDULER')
      `;
      await insert(1);
      await insert(2);
      const duplicate = await insert(1).then(
        () => null,
        (error: unknown) => error
      );
      expect(String(duplicate)).toContain("paper_portfolio_snapshots_user_generation_date_unique");

      // Re-applying is a no-op.
      await sql.unsafe(migration0027());
      expect((await sql`SELECT count(*)::int AS n FROM public.paper_portfolio_snapshots`)[0]!.n).toBe(2);
    });
  }, 120_000);

  it("keeps a legacy table that holds rows, renamed", async () => {
    if (!process.env.TEST_DATABASE_URL) return;
    await withFreshDatabase(async (sql) => {
      const userId = await createUser(sql);
      await sql`
        INSERT INTO public.paper_portfolio_snapshots (user_id, cash_balance, equity, margin_used, unrealized_pnl, realized_pnl)
        VALUES (${userId}, 1, 1, 0, 0, 0)
      `;
      await sql.unsafe(migration0027());
      expect((await sql`SELECT count(*)::int AS n FROM public.paper_portfolio_snapshots_legacy_0008`)[0]!.n).toBe(1);
      expect(await columnsOf(sql, "paper_portfolio_snapshots")).toContain("snapshot_date");
    });
  }, 120_000);
});
