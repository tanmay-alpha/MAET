import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationPath = join(import.meta.dir, "0023_paper_margin_and_position_identity.sql");
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("Migration 0023 paper margin function and position identity", () => {
  it("is additive: no table drops and no hard-coded constraint name", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE/iu);
    expect(migrationSql).not.toMatch(/\bCASCADE\b/iu);
    expect(migrationSql).not.toMatch(/paper_positions_user_id_symbol_exchange_key/u);
  });

  it("drops the legacy (user, symbol, exchange) unique constraint and fixes calculate_live_margin", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0023 PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const schema = `t_m0023_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const shortUser = crypto.randomUUID();
    const resetUser = crypto.randomUUID();
    const exchangeUser = crypto.randomUUID();

    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      // Shape of the tables after 0005 + 0006 + 0011 + 0020, including the 0005 inline UNIQUE.
      await sql.unsafe(`
        CREATE TYPE ${schema}.paper_order_status AS ENUM
          ('TRIGGER_PENDING', 'PENDING', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED');
        CREATE TABLE ${schema}.paper_accounts (
          user_id uuid PRIMARY KEY,
          cash_balance numeric(18, 4) NOT NULL,
          allocated_margin numeric(18, 4) NOT NULL DEFAULT 0,
          maintenance_margin numeric(18, 4) NOT NULL DEFAULT 0,
          is_locked boolean DEFAULT false,
          status text NOT NULL DEFAULT 'ACTIVE',
          generation integer NOT NULL DEFAULT 1
        );
        CREATE TABLE ${schema}.paper_positions (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          symbol text NOT NULL,
          exchange text NOT NULL DEFAULT 'NSE',
          average_entry_price numeric(18, 4) NOT NULL,
          total_shares integer NOT NULL,
          generation integer NOT NULL DEFAULT 1,
          side text NOT NULL DEFAULT 'LONG',
          UNIQUE (user_id, symbol, exchange)
        );
        CREATE UNIQUE INDEX paper_positions_user_generation_symbol_exchange_unique
          ON ${schema}.paper_positions (user_id, generation, symbol, exchange);
      `);

      const scoped = migrationSql.replaceAll("public.", `${schema}.`);
      await sql.unsafe(scoped);
      // Idempotent: a second run must be a no-op.
      await sql.unsafe(scoped);

      const legacy = await sql.unsafe(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = '${schema}.paper_positions'::regclass AND contype = 'u'
      `);
      expect(legacy).toHaveLength(0);
      const generationIndex = await sql.unsafe(`
        SELECT indexname FROM pg_indexes
        WHERE schemaname = '${schema}' AND indexname = 'paper_positions_user_generation_symbol_exchange_unique'
      `);
      expect(generationIndex).toHaveLength(1);

      await sql.unsafe(`
        INSERT INTO ${schema}.paper_accounts (user_id, cash_balance, allocated_margin, maintenance_margin, generation)
        VALUES
          ('${shortUser}', 30000, 20000, 16000, 1),
          ('${resetUser}', 1000000, 0, 0, 2),
          ('${exchangeUser}', 30000, 20000, 16000, 1);
        INSERT INTO ${schema}.paper_positions (user_id, symbol, exchange, average_entry_price, total_shares, generation, side)
        VALUES
          -- short 100 @ 1000; at 1200 it loses 20,000 -> equity 10,000 < 16,000
          ('${shortUser}', 'SHRT', 'NSE', 1000, 100, 1, 'SHORT'),
          -- abandoned generation-1 position (huge loss) and the same symbol re-bought in generation 2
          ('${resetUser}', 'GONE', 'NSE', 1000, 10000, 1, 'LONG'),
          ('${resetUser}', 'GONE', 'NSE', 10, 1, 2, 'LONG'),
          -- long 100 @ 1000 on BSE; only the BSE price may be used
          ('${exchangeUser}', 'DUAL', 'BSE', 1000, 100, 1, 'LONG');
      `);

      const prices = JSON.stringify({
        "NSE:SHRT": 1200,
        "NSE:GONE": 1,
        "BSE:DUAL": 1000,
        // Symbol-only keys must be ignored: DUAL at 500 would breach the BSE holder.
        DUAL: 500,
        SHRT: 800,
      });
      const rows = await sql.unsafe(`SELECT * FROM ${schema}.calculate_live_margin('${prices}'::jsonb)`);
      const breached = rows.map((row) => String(row.user_id));

      expect(breached).toEqual([shortUser]);
      expect(Number(rows[0]!.total_upnl)).toBe(-20000);
      expect(Number(rows[0]!.equity)).toBe(10000);

      const statuses = await sql.unsafe(`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${schema}' AND t.typname = 'paper_order_status'
        ORDER BY e.enumsortorder
      `);
      expect(statuses.map((row) => row.enumlabel)).toEqual([
        "TRIGGER_PENDING",
        "PENDING",
        "TRIGGERED",
        "PARTIALLY_FILLED",
        "FILLED",
        "REJECTED",
        "CANCELLED",
      ]);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  });
});
