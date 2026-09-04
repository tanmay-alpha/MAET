import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(import.meta.dir, "0019_retire_legacy_watchlist.sql");
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const schemaSource = readFileSync(join(import.meta.dir, "../schema.ts"), "utf8");

describe("Migration 0019 legacy watchlist retirement", () => {
  it("preserves legacy rows before dropping only the legacy table", () => {
    expect(existsSync(migrationPath)).toBe(true);
    const copyIndex = migrationSql.search(/INSERT\s+INTO\s+public\.watchlist_items/iu);
    const dropIndex = migrationSql.search(/DROP\s+TABLE\s+public\.watchlist\s*;/iu);
    expect(copyIndex).toBeGreaterThanOrEqual(0);
    expect(dropIndex).toBeGreaterThan(copyIndex);
    expect(migrationSql).toMatch(/ON\s+CONFLICT\s*\(watchlist_id,\s*symbol,\s*exchange\)\s+DO\s+NOTHING/iu);
    expect(migrationSql).not.toMatch(/\bCASCADE\b/iu);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE[^;]*\buser_watchlists\b/iu);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE[^;]*\bwatchlist_items\b/iu);

    const droppedTables = [...migrationSql.matchAll(/DROP\s+TABLE\s+(?:IF\s+EXISTS\s+)?([\w.]+)/giu)]
      .map((match) => match[1]?.toLowerCase());
    expect(droppedTables).toEqual(["public.watchlist"]);
  });

  it("removes only the legacy Drizzle export", () => {
    expect(schemaSource).not.toMatch(/export\s+const\s+watchlist\b/u);
    expect(schemaSource).toMatch(/export\s+const\s+userWatchlists\b/u);
    expect(schemaSource).toMatch(/export\s+const\s+watchlistItems\b/u);
  });

  it("preserves both users' rows in an isolated PostgreSQL schema", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0019 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl, { max: 1 });
    const isolatedSchema = `test_upgrade_0019_${Date.now()}_${crypto.randomUUID().replaceAll("-", "")}`;
    const userA = crypto.randomUUID();
    const userB = crypto.randomUUID();
    const importedWatchlistB = crypto.randomUUID();

    try {
      await sql.unsafe(`CREATE SCHEMA ${isolatedSchema}`);
      await sql.unsafe(`
        CREATE TABLE ${isolatedSchema}.user_watchlists (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          name text NOT NULL,
          description text,
          is_pinned boolean NOT NULL DEFAULT false,
          position integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${isolatedSchema}.watchlist_items (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          watchlist_id uuid NOT NULL REFERENCES ${isolatedSchema}.user_watchlists(id) ON DELETE CASCADE,
          user_id uuid NOT NULL,
          symbol text NOT NULL,
          exchange text NOT NULL DEFAULT 'NSE',
          note text,
          position integer NOT NULL DEFAULT 0,
          created_at timestamptz NOT NULL DEFAULT now(),
          UNIQUE (watchlist_id, symbol, exchange)
        );
        CREATE TABLE ${isolatedSchema}.watchlist (
          user_id uuid NOT NULL,
          exchange text NOT NULL DEFAULT 'NSE',
          symbol text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          PRIMARY KEY (user_id, exchange, symbol)
        );
      `);
      await sql.unsafe(`
        INSERT INTO ${isolatedSchema}.watchlist (user_id, exchange, symbol, created_at)
        VALUES
          ('${userA}', 'NSE', 'RELIANCE', '2026-01-01T00:00:00Z'),
          ('${userA}', 'NSE', 'TCS', '2026-01-02T00:00:00Z'),
          ('${userB}', 'NSE', 'INFY', '2026-01-03T00:00:00Z');
        INSERT INTO ${isolatedSchema}.user_watchlists
          (id, user_id, name, description, is_pinned, position, created_at, updated_at)
        VALUES
          ('${importedWatchlistB}', '${userB}', 'Imported Watchlist', 'Existing target', false, 2, '2025-01-01T00:00:00Z', '2025-01-01T00:00:00Z');
        INSERT INTO ${isolatedSchema}.watchlist_items
          (watchlist_id, user_id, symbol, exchange, note, position, created_at)
        VALUES
          ('${importedWatchlistB}', '${userB}', 'HDFCBANK', 'NSE', 'keep', 4, '2025-01-02T00:00:00Z');
      `);

      await sql.unsafe(migrationSql.replaceAll("public.", `${isolatedSchema}.`));

      const legacy = await sql.unsafe(`SELECT to_regclass('${isolatedSchema}.watchlist') AS relation`);
      expect(legacy[0]?.relation).toBeNull();

      const importedA = await sql.unsafe(`
        SELECT id FROM ${isolatedSchema}.user_watchlists
        WHERE user_id = '${userA}' AND name = 'Imported Watchlist'
      `);
      expect(importedA).toHaveLength(1);
      const itemsA = await sql.unsafe(`
        SELECT symbol, position FROM ${isolatedSchema}.watchlist_items
        WHERE watchlist_id = '${importedA[0]?.id}'
        ORDER BY position, symbol
      `);
      expect(itemsA.map((row) => row.symbol)).toEqual(["RELIANCE", "TCS"]);
      expect(itemsA.map((row) => row.position)).toEqual([0, 1]);

      const importedB = await sql.unsafe(`
        SELECT id FROM ${isolatedSchema}.user_watchlists
        WHERE user_id = '${userB}' AND name = 'Imported Watchlist'
      `);
      expect(importedB).toHaveLength(1);
      expect(importedB[0]?.id).toBe(importedWatchlistB);
      const itemsB = await sql.unsafe(`
        SELECT symbol, note, position FROM ${isolatedSchema}.watchlist_items
        WHERE watchlist_id = '${importedWatchlistB}'
        ORDER BY position, symbol
      `);
      expect(itemsB.map((row) => row.symbol)).toEqual(["HDFCBANK", "INFY"]);
      expect(itemsB[0]?.note).toBe("keep");
      expect(itemsB[1]?.position).toBe(5);

      const duplicates = await sql.unsafe(`
        SELECT watchlist_id, symbol, exchange, count(*)
        FROM ${isolatedSchema}.watchlist_items
        GROUP BY watchlist_id, symbol, exchange
        HAVING count(*) > 1
      `);
      expect(duplicates).toHaveLength(0);

      for (const tableName of ["user_watchlists", "watchlist_items"]) {
        const canonical = await sql.unsafe(`SELECT to_regclass('${isolatedSchema}.${tableName}') AS relation`);
        expect(canonical[0]?.relation).toBe(`${isolatedSchema}.${tableName}`);
      }
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${isolatedSchema} CASCADE`);
      await sql.end();
    }
  });
});
