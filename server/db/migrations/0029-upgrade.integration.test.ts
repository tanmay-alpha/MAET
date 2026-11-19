import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationsDir = import.meta.dir;
const migrationPath = join(migrationsDir, "0029_thesis_child_owner_policies.sql");
const CHILD_TABLES = ["thesis_order_links", "thesis_signals", "thesis_snapshots"];

describe("Migration 0029 thesis child owner policies", () => {
  it("lets a signed-in client read only the child rows of their own theses", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0029 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const freshDb = `maet_m0029_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const freshUrl = new URL(databaseUrl);
    freshUrl.pathname = `/${freshDb}`;

    await admin.unsafe(`CREATE DATABASE ${freshDb}`);
    const sql = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      // Mirror Supabase: auth stubs, client roles and default grants.
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

      const policies = await sql<{ name: string; cmd: string }[]>`
        SELECT tablename || '.' || policyname AS name, cmd FROM pg_policies
        WHERE schemaname = 'public' AND tablename = ANY(${CHILD_TABLES}) ORDER BY name
      `;
      expect(policies).toEqual(CHILD_TABLES.map((t) => ({ name: `${t}.${t}_owner_select`, cmd: "SELECT" })));

      const exposed = await sql<{ table_name: string }[]>`
        SELECT c.relname AS table_name FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relname = ANY(${CHILD_TABLES})
          AND (
            NOT c.relrowsecurity
            OR has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE')
            OR has_table_privilege('authenticated', c.oid, 'INSERT,UPDATE,DELETE,TRUNCATE')
            OR NOT has_table_privilege('authenticated', c.oid, 'SELECT')
          )
      `;
      expect(exposed).toEqual([]);

      const [userA, userB] = [crypto.randomUUID(), crypto.randomUUID()];
      const thesisByUser = new Map<string, string>();
      for (const id of [userA, userB]) {
        await sql`INSERT INTO auth.users (id) VALUES (${id})`;
        await sql`INSERT INTO public.users (id, email) VALUES (${id}, ${`m0029-${id}@example.com`})`;
        const [thesis] = await sql<{ id: string }[]>`
          INSERT INTO public.trade_theses (user_id, symbol, title, setup_type, direction, hypothesis)
          VALUES (${id}, 'RELIANCE', 'T', 'breakout', 'LONG', 'h') RETURNING id
        `;
        thesisByUser.set(id, thesis.id);
        await sql`
          INSERT INTO public.thesis_signals (thesis_id, signal_type, field, operator, observed_value, source)
          VALUES (${thesis.id}, 'ENTRY', 'close', '>', '1', 'test')
        `;
        await sql`
          INSERT INTO public.thesis_snapshots (thesis_id, quote_price, quote_source, quote_quality, quote_timestamp, timeframe)
          VALUES (${thesis.id}, 100, 'test', 'LIVE', now(), '1D')
        `;
      }

      const asClient = async (userId: string, statement: string) => {
        const rows = await sql.begin(async (tx) => {
          await tx`SELECT set_config('request.jwt.claim.sub', ${userId}, true)`;
          await tx.unsafe("SET LOCAL ROLE authenticated");
          return tx.unsafe(statement);
        });
        return [...rows].map((row) => row.thesis_id as string);
      };
      for (const table of ["thesis_signals", "thesis_snapshots"]) {
        expect(await asClient(userA, `SELECT thesis_id FROM public.${table}`)).toEqual([thesisByUser.get(userA)!]);
        expect(await asClient(userB, `SELECT thesis_id FROM public.${table}`)).toEqual([thesisByUser.get(userB)!]);
      }

      // Idempotent: re-applying 0029 must not fail.
      await sql.unsafe(readFileSync(migrationPath, "utf8"));
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${freshDb} WITH (FORCE)`);
      await admin.end();
    }
  }, 120_000);
});
