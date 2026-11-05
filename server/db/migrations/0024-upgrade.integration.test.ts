import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationPath = join(import.meta.dir, "0024_ingestion_storage_tables.sql");
const seedPath = join(import.meta.dir, "../seeds/market_baseline_metrics.sql");
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";
const seedSql = existsSync(seedPath) ? readFileSync(seedPath, "utf8") : "";

describe("Migration 0024 ingestion storage tables", () => {
  it("is additive: creates tables idempotently and never drops data", () => {
    expect(existsSync(migrationPath)).toBe(true);
    for (const table of ["price_daily", "calculation_results", "market_baseline_metrics"]) {
      expect(migrationSql).toMatch(new RegExp(`CREATE\\s+TABLE\\s+IF\\s+NOT\\s+EXISTS\\s+public\\.${table}\\b`, "iu"));
    }
    expect(migrationSql).not.toMatch(/\bDROP\s+(TABLE|COLUMN|SCHEMA)\b/iu);
    expect(migrationSql).not.toMatch(/\bTRUNCATE\s+(TABLE\s+)?public\./iu);
    expect(migrationSql).not.toMatch(/\bDELETE\s+FROM\b/iu);
  });

  it("creates the tables on a fresh schema, loads the seed idempotently and preserves existing rows", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0024 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const freshSchema = `t_m0024_fresh_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const upgradeSchema = `t_m0024_upgrade_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const inSchema = (text: string, schema: string) => text.replaceAll("public.", `${schema}.`);
    const seededRows = seedSql.match(/^\('/gmu)?.length ?? 0;

    try {
      // The policies target Supabase roles; plain PostgreSQL needs them to exist.
      await sql.unsafe(`
        DO $$ BEGIN
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN CREATE ROLE anon; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN CREATE ROLE authenticated; END IF;
          IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN CREATE ROLE service_role; END IF;
        END $$;
      `);

      // Fresh database: tables appear and the seed (which used to fail with
      // "relation market_baseline_metrics does not exist") loads, twice.
      await sql.unsafe(`CREATE SCHEMA ${freshSchema}`);
      await sql.unsafe(inSchema(migrationSql, freshSchema));
      await sql.unsafe(inSchema(migrationSql, freshSchema));
      expect(seededRows).toBeGreaterThan(2000);
      await sql.unsafe(inSchema(seedSql, freshSchema));
      await sql.unsafe(inSchema(seedSql, freshSchema));
      const [{ count }] = await sql.unsafe(`SELECT count(*)::int AS count FROM ${freshSchema}.market_baseline_metrics`);
      expect(count).toBe(seededRows);
      const [firstSeedRow] = await sql.unsafe(
        `SELECT adv_30::text, atr_14::text, last_trading_date::text FROM ${freshSchema}.market_baseline_metrics WHERE symbol = '20MICRONS'`,
      );
      expect(firstSeedRow).toEqual({ adv_30: "681372.77", atr_14: "7.6364", last_trading_date: "2026-07-03" });

      // Existing database created by the retired ingestion-engine DDL: rows survive.
      await sql.unsafe(`CREATE SCHEMA ${upgradeSchema}`);
      await sql.unsafe(`
        CREATE TABLE ${upgradeSchema}.calculation_results (
          symbol TEXT NOT NULL, date DATE NOT NULL, indicator_name TEXT NOT NULL,
          indicator_value NUMERIC(18,6), indicator_signal NUMERIC(18,6), indicator_hist NUMERIC(18,6),
          timeframe TEXT NOT NULL DEFAULT '1d', parameters JSONB,
          calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          PRIMARY KEY (symbol, date, indicator_name, timeframe)
        );
        INSERT INTO ${upgradeSchema}.calculation_results (symbol, date, indicator_name, indicator_value)
        VALUES ('INFY', '2026-07-03', 'RSI_14', 61.25);
        CREATE TABLE ${upgradeSchema}.market_baseline_metrics (
          symbol TEXT PRIMARY KEY, adv_30 NUMERIC NOT NULL, atr_14 NUMERIC NOT NULL,
          last_trading_date DATE NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        );
        INSERT INTO ${upgradeSchema}.market_baseline_metrics (symbol, adv_30, atr_14, last_trading_date)
        VALUES ('KEEPME', 1, 2, '2026-01-01');
      `);
      await sql.unsafe(inSchema(migrationSql, upgradeSchema));

      const calc = await sql.unsafe(
        `SELECT symbol, indicator_name, indicator_value::text AS value FROM ${upgradeSchema}.calculation_results`,
      );
      expect(calc).toEqual([{ symbol: "INFY", indicator_name: "RSI_14", value: "61.250000" }]);
      const baseline = await sql.unsafe(`SELECT symbol FROM ${upgradeSchema}.market_baseline_metrics`);
      expect(baseline.map((row) => row.symbol)).toEqual(["KEEPME"]);
      const [priceDaily] = await sql.unsafe(`SELECT to_regclass('${upgradeSchema}.price_daily') AS relation`);
      expect(priceDaily?.relation).toBe(`${upgradeSchema}.price_daily`);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${freshSchema} CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${upgradeSchema} CASCADE`);
      await sql.end();
    }
  });
});
