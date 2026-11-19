import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationsDir = import.meta.dir;
const MIGRATION = "0030_corporate_actions_identity.sql";

describe("Migration 0030 corporate_actions identity", () => {
  it("keeps the newest of colliding rows and makes (symbol, action_type, ex_date) unique", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0030 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const admin = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const freshDb = `maet_m0030_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const freshUrl = new URL(databaseUrl);
    freshUrl.pathname = `/${freshDb}`;

    await admin.unsafe(`CREATE DATABASE ${freshDb}`);
    const sql = postgres(freshUrl.toString(), { max: 1, onnotice: () => {} });
    try {
      // Mirror Supabase: auth stubs and client roles the earlier migrations grant to.
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
      const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
      for (const file of files.filter((f) => f < MIGRATION)) {
        await sql.unsafe(readFileSync(join(migrationsDir, file), "utf8"));
      }

      await sql`
        INSERT INTO corporate_actions (id, symbol, action_type, ex_date, amount, ingested_at) VALUES
          ('old', 'ITC', 'DIVIDEND', '2025-06-04T00:00:00+05:30', 7.5, '2025-06-01T00:00:00Z'),
          ('new', 'ITC', 'DIVIDEND', '2025-06-04T00:00:00+05:30', 7.85, '2025-06-02T00:00:00Z'),
          ('split', 'ITC', 'SPLIT', '2025-06-04T00:00:00+05:30', NULL, '2025-06-01T00:00:00Z'),
          ('undated-1', 'ITC', 'BOARD_MEETING', NULL, NULL, '2025-06-01T00:00:00Z'),
          ('undated-2', 'ITC', 'BOARD_MEETING', NULL, NULL, '2025-06-02T00:00:00Z')
      `;
      await sql.unsafe(readFileSync(join(migrationsDir, MIGRATION), "utf8"));

      const ids = await sql<{ id: string }[]>`SELECT id FROM corporate_actions ORDER BY id`;
      expect(ids.map((row) => row.id)).toEqual(["new", "split", "undated-1", "undated-2"]);

      await expect(sql`
        INSERT INTO corporate_actions (symbol, action_type, ex_date) VALUES ('ITC', 'DIVIDEND', '2025-06-04T00:00:00+05:30')
      `).rejects.toMatchObject({ code: "23505" });

      // Re-running the migration is a no-op.
      await sql.unsafe(readFileSync(join(migrationsDir, MIGRATION), "utf8"));
      const [{ count }] = await sql<{ count: number }[]>`SELECT count(*)::int AS count FROM corporate_actions`;
      expect(count).toBe(4);
    } finally {
      await sql.end();
      await admin.unsafe(`DROP DATABASE IF EXISTS ${freshDb}`);
      await admin.end();
    }
  }, 120_000);
});
