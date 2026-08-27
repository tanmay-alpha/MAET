import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync, readdirSync } from "fs";
import { join } from "path";
import { getTableConfig } from "drizzle-orm/pg-core";
import { optionGreekSnapshots, optionQuoteSnapshots } from "../schema";

const migrationPath = join(import.meta.dir, "0017_options_market_data.sql");
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf-8") : "";

function nonCommentSql(sql: string): string {
  return sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");
}

describe("Migration 0017 options market data upgrade", () => {
  it("is additive and does not destroy existing data", () => {
    const executableSql = nonCommentSql(migrationSql);

    expect(existsSync(migrationPath)).toBe(true);
    expect(executableSql).not.toMatch(/\bDROP\s+(TABLE|SCHEMA|COLUMN)\b/i);
    expect(executableSql).not.toMatch(/\bTRUNCATE\b/i);
    expect(executableSql).not.toMatch(/\bCASCADE\b/i);
  });

  it("defines canonical option contracts with validated identity and lookup indexes", () => {
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.option_contracts");
    expect(migrationSql).toContain("provider");
    expect(migrationSql).toContain("trading_symbol");
    expect(migrationSql).toMatch(/expiry_date\s+date\s+NOT NULL/i);
    expect(migrationSql).toMatch(/strike_price\s+numeric/i);
    expect(migrationSql).toMatch(/option_type\s+text\s+NOT NULL/i);
    expect(migrationSql).toContain("option_contracts_identity_unique");
    expect(migrationSql).toContain("option_contracts_provider_exchange_token_idx");
    expect(migrationSql).toContain("option_contracts_chain_lookup_idx");
    expect(migrationSql).toMatch(/CHECK\s*\(strike_price\s*>\s*0\)/i);
    expect(migrationSql).toMatch(/CHECK\s*\(lot_size\s*>\s*0\)/i);
    expect(migrationSql).toMatch(/CHECK\s*\(option_type\s+IN\s*\('CE',\s*'PE'\)\)/i);
  });

  it("defines append-only quote and Greek snapshots without invented provider fields", () => {
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.option_quote_snapshots");
    expect(migrationSql).toContain("CREATE TABLE IF NOT EXISTS public.option_greek_snapshots");
    expect(migrationSql).toContain("option_quote_snapshots_contract_feed_unique");
    expect(migrationSql).toContain("option_quote_snapshots_contract_feed_idx");
    expect(migrationSql).toContain("option_greek_snapshots_contract_observed_idx");
    expect(migrationSql).not.toMatch(/\brho\b/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+0\b/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+false\b/i);
    expect(migrationSql).not.toMatch(/DEFAULT\s+'unknown'/i);
  });

  it("keeps Drizzle history indexes in descending timestamp order", () => {
    const quoteHistoryIndex = getTableConfig(optionQuoteSnapshots).indexes
      .find((index) => index.config.name === "option_quote_snapshots_contract_feed_idx");
    const greekHistoryIndex = getTableConfig(optionGreekSnapshots).indexes
      .find((index) => index.config.name === "option_greek_snapshots_contract_observed_idx");

    expect(quoteHistoryIndex?.config.columns[1]?.indexConfig.order).toBe("desc");
    expect(greekHistoryIndex?.config.columns[1]?.indexConfig.order).toBe("desc");
  });

  it("rejects mutations of stored quote and Greek history", () => {
    expect(migrationSql).toContain("CREATE TRIGGER option_quote_snapshots_append_only");
    expect(migrationSql).toContain("CREATE TRIGGER option_greek_snapshots_append_only");
    expect(migrationSql).toMatch(/BEFORE\s+UPDATE\s+OR\s+DELETE/i);
  });

  it("enables RLS, adds no user policies, and revokes direct API-role access", () => {
    for (const tableName of ["option_contracts", "option_quote_snapshots", "option_greek_snapshots"]) {
      expect(migrationSql).toContain(`ALTER TABLE public.${tableName} ENABLE ROW LEVEL SECURITY`);
      for (const roleName of ["anon", "authenticated"]) {
        expect(migrationSql).toMatch(new RegExp(
          `REVOKE\\s+ALL\\s+ON\\s+TABLE\\s+public\\.${tableName}\\s+FROM\\s+${roleName}`,
          "i",
        ));
      }
    }
    expect(migrationSql).not.toMatch(/CREATE\s+POLICY/i);
  });

  it("preserves existing data and enforces option history invariants in PostgreSQL", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const postgres = (await import("postgres")).default;
    const sql = postgres(databaseUrl, { max: 1 });
    const isolatedSchema = `test_upgrade_0017_${Date.now()}`;
    const authSchema = `${isolatedSchema}_auth`;

    const scopeSql = (content: string, schema: string, scopedAuthSchema: string) => content
      .replace(/schemaname = 'public'/gi, "schemaname = current_schema()")
      .replace(/public\./g, `${schema}.`)
      .replace(/auth\./g, `${scopedAuthSchema}.`)
      .replace(
        /WHERE typname = '/gi,
        "WHERE typnamespace = (SELECT oid FROM pg_namespace WHERE nspname = current_schema()) AND typname = '",
      );

    try {
      await sql.unsafe(`CREATE SCHEMA ${authSchema}`);
      await sql.unsafe(`
        CREATE TABLE ${authSchema}.users (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid()
        )
      `);
      await sql.unsafe(`
        CREATE FUNCTION ${authSchema}.uid() RETURNS uuid AS $$
          SELECT COALESCE(
            NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid
          )
        $$ LANGUAGE sql STABLE
      `);

      await sql.unsafe(`CREATE SCHEMA ${isolatedSchema}`);
      await sql.unsafe(`SET search_path TO ${isolatedSchema}, ${authSchema}`);

      const migrationsDir = join(process.cwd(), "server/db/migrations");
      const existingMigrations = readdirSync(migrationsDir)
        .filter((file) => file.endsWith(".sql") && file <= "0016_strategy_lab.sql")
        .sort();
      for (const file of existingMigrations) {
        await sql.unsafe(scopeSql(readFileSync(join(migrationsDir, file), "utf-8"), isolatedSchema, authSchema));
      }

      const userId = "00000000-0000-0000-0000-000000000001";
      await sql.unsafe(`INSERT INTO ${authSchema}.users (id) VALUES ('${userId}') ON CONFLICT DO NOTHING`);
      await sql.unsafe(`INSERT INTO users (id, email) VALUES ('${userId}', 'options_upgrade@maet.com')`);
      await sql.unsafe(`
        INSERT INTO candles (symbol, timeframe, ts, open, high, low, close, volume, source)
        VALUES ('NIFTY', '1d', NOW(), 22000, 22100, 21950, 22050, 100000, 'test')
      `);

      const beforeUpgrade = (await sql.unsafe(`
        SELECT count(*)::int AS count,
          md5(coalesce(string_agg(symbol || ':' || close::text, ',' ORDER BY symbol), '')) AS digest
        FROM candles
      `))[0];

      await sql.unsafe(scopeSql(migrationSql, isolatedSchema, authSchema));

      const afterUpgrade = (await sql.unsafe(`
        SELECT count(*)::int AS count,
          md5(coalesce(string_agg(symbol || ':' || close::text, ',' ORDER BY symbol), '')) AS digest
        FROM candles
      `))[0];
      expect(afterUpgrade).toEqual(beforeUpgrade);

      await sql.unsafe(`
        INSERT INTO option_contracts (
          provider, exchange, token, trading_symbol, underlying, expiry_date,
          strike_price, option_type, lot_size, instrument_type, is_active, first_seen_at, last_seen_at
        ) VALUES
          ('angelone', 'NFO', '101', 'NIFTY28AUG2622000CE', 'NIFTY', '2026-08-28', 22000, 'CE', 75, 'OPTIDX', true, NOW(), NOW()),
          ('angelone', 'NFO', '102', 'NIFTY28AUG2622000PE', 'NIFTY', '2026-08-28', 22000, 'PE', 75, 'OPTIDX', true, NOW(), NOW()),
          ('angelone', 'NFO', '103', 'NIFTY28AUG2622100CE', 'NIFTY', '2026-08-28', 22100, 'CE', 75, 'OPTIDX', true, NOW(), NOW())
      `);

      const chainRows = await sql.unsafe(`
        SELECT trading_symbol FROM option_contracts
        WHERE underlying = 'NIFTY' AND expiry_date = '2026-08-28'
        ORDER BY strike_price, option_type
      `);
      expect(chainRows.map((row) => row.trading_symbol)).toEqual([
        "NIFTY28AUG2622000CE",
        "NIFTY28AUG2622000PE",
        "NIFTY28AUG2622100CE",
      ]);

      await expect(sql.unsafe(`
        INSERT INTO option_contracts (
          provider, exchange, token, trading_symbol, underlying, expiry_date,
          strike_price, option_type, lot_size, instrument_type, is_active, first_seen_at, last_seen_at
        ) VALUES ('angelone', 'NFO', '104', 'NIFTY28AUG260000CE', 'NIFTY', '2026-08-28', 0, 'CE', 75, 'OPTIDX', true, NOW(), NOW())
      `)).rejects.toThrow();
      await expect(sql.unsafe(`
        INSERT INTO option_contracts (
          provider, exchange, token, trading_symbol, underlying, expiry_date,
          strike_price, option_type, lot_size, instrument_type, is_active, first_seen_at, last_seen_at
        ) VALUES ('angelone', 'NFO', '105', 'NIFTY28AUG2622100XX', 'NIFTY', '2026-08-28', 22100, 'XX', 75, 'OPTIDX', true, NOW(), NOW())
      `)).rejects.toThrow();
      await expect(sql.unsafe(`
        INSERT INTO option_contracts (
          provider, exchange, token, trading_symbol, underlying, expiry_date,
          strike_price, option_type, lot_size, instrument_type, is_active, first_seen_at, last_seen_at
        ) VALUES ('angelone', 'NFO', '106', 'NIFTY28AUG2622200CE', 'NIFTY', '2026-08-28', 22200, 'CE', 0, 'OPTIDX', true, NOW(), NOW())
      `)).rejects.toThrow();
      await expect(sql.unsafe(`
        INSERT INTO option_contracts (
          provider, exchange, token, trading_symbol, underlying, expiry_date,
          strike_price, option_type, lot_size, instrument_type, is_active, first_seen_at, last_seen_at
        ) VALUES ('angelone', 'NFO', '107', 'NIFTY28AUG2622300CE', ' ', '2026-08-28', 22300, 'CE', 75, 'OPTIDX', true, NOW(), NOW())
      `)).rejects.toThrow();

      const contractId = (await sql.unsafe(`
        SELECT id FROM option_contracts WHERE trading_symbol = 'NIFTY28AUG2622000CE'
      `))[0].id;
      await sql.unsafe(`
        INSERT INTO option_quote_snapshots (contract_id, ltp, exchange_feed_at, received_at, source)
        VALUES ('${contractId}', 101.25, '2026-08-26T09:30:00Z', NOW(), 'angelone')
      `);
      await expect(sql.unsafe(`
        INSERT INTO option_quote_snapshots (contract_id, ltp, exchange_feed_at, received_at, source)
        VALUES ('${contractId}', 101.25, '2026-08-26T09:30:00Z', NOW(), 'angelone')
      `)).rejects.toThrow();
      await expect(sql.unsafe(`
        UPDATE option_quote_snapshots SET ltp = 102 WHERE contract_id = '${contractId}'
      `)).rejects.toThrow();
      await expect(sql.unsafe(`
        DELETE FROM option_quote_snapshots WHERE contract_id = '${contractId}'
      `)).rejects.toThrow();

      await sql.unsafe(`
        INSERT INTO option_greek_snapshots (contract_id, delta, observed_at, source)
        VALUES ('${contractId}', 0.5, NOW(), 'angelone')
      `);
      await expect(sql.unsafe(`
        UPDATE option_greek_snapshots SET delta = 0.6 WHERE contract_id = '${contractId}'
      `)).rejects.toThrow();
      await expect(sql.unsafe(`
        DELETE FROM option_greek_snapshots WHERE contract_id = '${contractId}'
      `)).rejects.toThrow();

      const forbiddenColumns = await sql`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = ${isolatedSchema}
          AND table_name = 'option_greek_snapshots'
          AND column_name = ANY(ARRAY['rho', 'provider_timestamp', 'exchange_feed_at', 'exchange_trade_at'])
      `;
      expect(forbiddenColumns).toHaveLength(0);

      const rlsTables = await sql`
        SELECT relname
        FROM pg_class
        JOIN pg_namespace ON pg_namespace.oid = pg_class.relnamespace
        WHERE pg_namespace.nspname = ${isolatedSchema}
          AND relname = ANY(ARRAY['option_contracts', 'option_quote_snapshots', 'option_greek_snapshots'])
          AND relrowsecurity
      `;
      expect(rlsTables).toHaveLength(3);

      const policies = await sql`
        SELECT policyname
        FROM pg_policies
        WHERE schemaname = ${isolatedSchema}
          AND tablename = ANY(ARRAY['option_contracts', 'option_quote_snapshots', 'option_greek_snapshots'])
      `;
      expect(policies).toHaveLength(0);
    } finally {
      await sql.unsafe("SET search_path TO public");
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${isolatedSchema} CASCADE`);
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${authSchema} CASCADE`);
      await sql.end();
    }
  }, 60_000);
});
