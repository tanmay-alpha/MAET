import { afterAll, describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationsDir = import.meta.dir;
const MIGRATION = "0030_corporate_actions_identity.sql";
const databaseUrl = process.env.TEST_DATABASE_URL;

// Pools are created per run and always closed in afterAll (which bun runs even after a test
// timeout), with a bounded end() so a stuck connection can never keep the process alive.
let admin: postgres.Sql | undefined;
let sql: postgres.Sql | undefined;
let freshDb: string | undefined;

afterAll(async () => {
  await sql?.end({ timeout: 5 });
  if (admin && freshDb) await admin.unsafe(`DROP DATABASE IF EXISTS ${freshDb} WITH (FORCE)`);
  await admin?.end({ timeout: 5 });
});

describe("Migration 0030 corporate_actions identity", () => {
  it("keeps the newest of colliding rows and makes (symbol, action_type, ex_date) unique", async () => {
    if (!databaseUrl) {
      console.log("  Skipping migration 0030 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    freshDb = `maet_m0030_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const freshUrl = new URL(databaseUrl);
    freshUrl.pathname = `/${freshDb}`;
    await admin.unsafe(`CREATE DATABASE ${freshDb}`);
    const db = (sql = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} }));

    // Mirror Supabase: auth stubs and client roles the earlier migrations grant to.
    await db.unsafe(`
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
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
    for (const file of files.filter((f) => f < MIGRATION)) {
      await db.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
    }

    await db`
      INSERT INTO corporate_actions (id, symbol, action_type, ex_date, amount, ingested_at) VALUES
        ('old', 'ITC', 'DIVIDEND', '2025-06-04T00:00:00+05:30', 7.5, '2025-06-01T00:00:00Z'),
        ('new', 'ITC', 'DIVIDEND', '2025-06-04T00:00:00+05:30', 7.85, '2025-06-02T00:00:00Z'),
        ('split', 'ITC', 'SPLIT', '2025-06-04T00:00:00+05:30', NULL, '2025-06-01T00:00:00Z'),
        ('undated-1', 'ITC', 'BOARD_MEETING', NULL, NULL, '2025-06-01T00:00:00Z'),
        ('undated-2', 'ITC', 'BOARD_MEETING', NULL, NULL, '2025-06-02T00:00:00Z')
    `;
    await db.unsafe(readFileSync(join(migrationsDir, MIGRATION), "utf8"));

    const ids = await db<{ id: string }[]>`SELECT id FROM corporate_actions ORDER BY id`;
    expect(ids.map((row) => row.id)).toEqual(["new", "split", "undated-1", "undated-2"]);

    // postgres.js queries are lazy: they run only when `.then` is called. Bun 1.3's
    // `expect(query).rejects` never calls it, so the query was never sent and the test hung.
    // Settle the query here and assert on the outcome.
    const duplicate = await db`
      INSERT INTO corporate_actions (symbol, action_type, ex_date) VALUES ('ITC', 'DIVIDEND', '2025-06-04T00:00:00+05:30')
    `.then(() => null, (error: unknown) => error);
    expect(duplicate).toMatchObject({ code: "23505" });

    // Re-running the migration is a no-op.
    await db.unsafe(readFileSync(join(migrationsDir, MIGRATION), "utf8"));
    const [{ count }] = await db<{ count: number }[]>`SELECT count(*)::int AS count FROM corporate_actions`;
    expect(count).toBe(4);
  }, 120_000);
});
