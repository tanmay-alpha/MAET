import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const read = (file: string) => readFileSync(join(import.meta.dir, file), "utf8");
const migration0023 = read("0023_paper_margin_and_position_identity.sql");
const migration0028 = read("0028_live_margin_stored_marks.sql");

describe("Migration 0028 calculate_live_margin uses stored marks", () => {
  it("is additive: only replaces the function", () => {
    expect(migration0028).toMatch(/CREATE OR REPLACE FUNCTION public\.calculate_live_margin\(live_prices jsonb\)/u);
    expect(migration0028).not.toMatch(/\bDROP\b/iu);
    expect(migration0028).not.toMatch(/\b(ALTER|UPDATE|DELETE|INSERT)\b/iu);
  });

  it("upgrades the 0023 function: an unquoted position is marked at its last stored mark, not its entry price", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      throw new Error("TEST_DATABASE_URL is required for the migration 0028 upgrade test.");
    }

    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const schema = `t_m0028_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const scoped = (migration: string) => migration.replaceAll("public.", `${schema}.`);
    const stored = crypto.randomUUID();
    const legacy = crypto.randomUUID();
    const live = crypto.randomUUID();
    const short = crypto.randomUUID();
    const breachedUsers = async (prices: Record<string, number>) => {
      const rows = await sql.unsafe(
        `SELECT user_id, equity FROM ${schema}.calculate_live_margin('${JSON.stringify(prices)}'::jsonb)`
      );
      return new Map(rows.map((row) => [String(row.user_id), Number(row.equity)]));
    };

    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      // Shape of the tables after 0011 + 0020 + 0023 (last_quote_* columns come from 0011).
      await sql.unsafe(`
        CREATE TYPE ${schema}.paper_order_status AS ENUM
          ('TRIGGER_PENDING', 'PENDING', 'TRIGGERED', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED');
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
          last_quote_price numeric(18, 4),
          last_quote_timestamp timestamptz
        );
      `);
      await sql.unsafe(scoped(migration0023));
      await sql.unsafe(`
        INSERT INTO ${schema}.paper_accounts (user_id, cash_balance, allocated_margin, maintenance_margin)
        VALUES
          ('${stored}', 40000, 20000, 16000),
          ('${legacy}', 40000, 20000, 16000),
          ('${live}', 40000, 20000, 16000),
          ('${short}', 30000, 20000, 16000);
        INSERT INTO ${schema}.paper_positions (user_id, symbol, average_entry_price, total_shares, side, last_quote_price, last_quote_timestamp)
        VALUES
          -- long 100 @ 1,000, last filled at 700: a known 30,000 loss -> equity 10,000 < 16,000
          ('${stored}', 'STORED', 1000, 100, 'LONG', 700, NOW() - INTERVAL '2 days'),
          -- legacy row without any stored mark: only the entry price is known -> equity 40,000
          ('${legacy}', 'LEGACY', 1000, 100, 'LONG', NULL, NULL),
          -- stored mark 700, but a live price of 1,000 is newer -> equity 40,000
          ('${live}', 'LIVE', 1000, 100, 'LONG', 700, NOW() - INTERVAL '2 days'),
          -- short 100 @ 1,000, last filled at 1,200: a 20,000 loss -> equity 10,000 < 16,000
          ('${short}', 'SHORTY', 1000, 100, 'SHORT', 1200, NOW() - INTERVAL '1 day');
      `);
      const prices = { "NSE:LIVE": 1000 };

      // Before: every unquoted position counted as break-even, hiding both losses.
      expect([...(await breachedUsers(prices)).keys()]).toEqual([]);

      await sql.unsafe(scoped(migration0028));
      // Idempotent: a second run is a no-op.
      await sql.unsafe(scoped(migration0028));

      const after = await breachedUsers(prices);
      expect([...after.keys()].sort()).toEqual([stored, short].sort());
      expect(after.get(stored)).toBe(10000);
      expect(after.get(short)).toBe(10000);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  });
});
