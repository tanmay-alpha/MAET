import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const migrationPath = join(import.meta.dir, "0018_drop_legacy_option_chain.sql");
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const schemaSource = readFileSync(join(import.meta.dir, "../schema.ts"), "utf8");

describe("Migration 0018 legacy option-chain retirement", () => {
  it("drops only the legacy option_chain table without cascade", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migrationSql).toMatch(/DROP\s+TABLE\s+IF\s+EXISTS\s+public\.option_chain\s*;/i);
    expect(migrationSql).not.toMatch(/\bCASCADE\b/i);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE[^;]*option_contracts/i);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE[^;]*option_quote_snapshots/i);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE[^;]*option_greek_snapshots/i);
  });

  it("removes the legacy Drizzle table export", () => {
    expect(schemaSource).not.toMatch(/export\s+const\s+optionChain\b/u);
  });

  it("drops legacy data while retaining canonical option tables in an isolated schema", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl, { max: 1 });
    const isolatedSchema = `test_upgrade_0018_${Date.now()}`;

    try {
      await sql.unsafe(`CREATE SCHEMA ${isolatedSchema}`);
      await sql.unsafe(`CREATE TABLE ${isolatedSchema}.option_chain (symbol text NOT NULL, price numeric NOT NULL)`);
      await sql.unsafe(`INSERT INTO ${isolatedSchema}.option_chain (symbol, price) VALUES ('NIFTY', 100)`);
      await sql.unsafe(`CREATE TABLE ${isolatedSchema}.option_contracts (id uuid PRIMARY KEY)`);
      await sql.unsafe(`CREATE TABLE ${isolatedSchema}.option_quote_snapshots (id uuid PRIMARY KEY)`);
      await sql.unsafe(`CREATE TABLE ${isolatedSchema}.option_greek_snapshots (id uuid PRIMARY KEY)`);

      await sql.unsafe(migrationSql.replace(/public\./g, `${isolatedSchema}.`));

      const legacy = await sql.unsafe(`SELECT to_regclass('${isolatedSchema}.option_chain') AS relation`);
      expect(legacy[0]?.relation).toBeNull();
      for (const tableName of ["option_contracts", "option_quote_snapshots", "option_greek_snapshots"]) {
        const canonical = await sql.unsafe(`SELECT to_regclass('${isolatedSchema}.${tableName}') AS relation`);
        expect(canonical[0]?.relation).toBe(`${isolatedSchema}.${tableName}`);
      }
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${isolatedSchema} CASCADE`);
      await sql.end();
    }
  });
});
