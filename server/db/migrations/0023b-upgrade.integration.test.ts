import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import postgres from "postgres";

const migrationPath = join(import.meta.dir, "0023b_paper_stop_market_and_ledger_backfill.sql");
const migrationSql = existsSync(migrationPath) ? readFileSync(migrationPath, "utf8") : "";

describe("Migration 0023b stop-market exits, per-generation idempotency, INITIAL_CASH backfill", () => {
  it("is additive", () => {
    expect(existsSync(migrationPath)).toBe(true);
    expect(migrationSql).not.toMatch(/DROP\s+TABLE/iu);
    expect(migrationSql).not.toMatch(/\bCASCADE\b/iu);
  });

  it("upgrades an isolated schema idempotently", async () => {
    const databaseUrl = process.env.TEST_DATABASE_URL;
    if (!databaseUrl) {
      console.log("  Skipping migration 0023b PostgreSQL integration test: TEST_DATABASE_URL not set");
      return;
    }

    const sql = postgres(databaseUrl, { max: 1, onnotice: () => {} });
    const schema = `t_m0023b_${Date.now()}_${crypto.randomUUID().slice(0, 8)}`;
    const freshUser = crypto.randomUUID();
    const openedUser = crypto.randomUUID();
    const resetUser = crypto.randomUUID();

    try {
      await sql.unsafe(`CREATE SCHEMA ${schema}`);
      await sql.unsafe(`
        CREATE TYPE ${schema}.paper_order_type AS ENUM ('LIMIT', 'MARKET', 'STOP_LOSS_LIMIT');
        CREATE TABLE ${schema}.paper_accounts (
          user_id uuid PRIMARY KEY,
          initial_cash numeric(18, 4) NOT NULL,
          generation integer NOT NULL DEFAULT 1,
          created_at timestamptz NOT NULL DEFAULT now()
        );
        CREATE TABLE ${schema}.paper_orders (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          generation integer NOT NULL DEFAULT 1,
          idempotency_key text
        );
        CREATE UNIQUE INDEX paper_orders_user_idempotency_key_unique
          ON ${schema}.paper_orders (user_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
        CREATE TABLE ${schema}.paper_ledger_entries (
          id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
          user_id uuid NOT NULL,
          generation integer NOT NULL DEFAULT 1,
          fill_id uuid,
          entry_type text NOT NULL,
          amount numeric(18, 4) NOT NULL,
          balance_after numeric(18, 4) NOT NULL,
          currency text NOT NULL DEFAULT 'INR',
          source_type text NOT NULL,
          source_id text NOT NULL,
          metadata jsonb NOT NULL DEFAULT '{}',
          created_at timestamptz NOT NULL DEFAULT now(),
          CONSTRAINT paper_ledger_unique UNIQUE (user_id, generation, source_type, source_id, entry_type)
        );
        INSERT INTO ${schema}.paper_accounts (user_id, initial_cash, generation) VALUES
          ('${freshUser}', 500000, 1),
          ('${openedUser}', 1000000, 1),
          ('${resetUser}', 1000000, 2);
        INSERT INTO ${schema}.paper_ledger_entries
          (user_id, generation, entry_type, amount, balance_after, source_type, source_id)
        VALUES ('${openedUser}', 1, 'INITIAL_CASH', 1000000, 1000000, 'ACCOUNT_OPEN', 'open:1');
      `);

      const scoped = migrationSql.replaceAll("public.", `${schema}.`);
      await sql.unsafe(scoped);
      await sql.unsafe(scoped);

      const opening = await sql.unsafe(`
        SELECT user_id::text AS user_id, generation, amount, balance_after, source_type
        FROM ${schema}.paper_ledger_entries WHERE entry_type = 'INITIAL_CASH' ORDER BY user_id
      `);
      const byUser = new Map(opening.map((row) => [row.user_id as string, row]));
      expect(opening).toHaveLength(2);
      expect(Number(byUser.get(freshUser)?.amount)).toBe(500000);
      expect(Number(byUser.get(freshUser)?.balance_after)).toBe(500000);
      expect(byUser.get(freshUser)?.generation).toBe(1);
      // A reset account's generation-1 opening balance is unknown: it is not guessed.
      expect(byUser.has(resetUser)).toBe(false);

      const types = await sql.unsafe(`
        SELECT e.enumlabel FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        JOIN pg_namespace n ON n.oid = t.typnamespace
        WHERE n.nspname = '${schema}' AND t.typname = 'paper_order_type'
        ORDER BY e.enumsortorder
      `);
      expect(types.map((row) => row.enumlabel)).toEqual(["LIMIT", "MARKET", "STOP_LOSS_LIMIT", "STOP_LOSS_MARKET"]);

      const indexes = await sql.unsafe(`
        SELECT indexname FROM pg_indexes WHERE schemaname = '${schema}' AND tablename = 'paper_orders' ORDER BY indexname
      `);
      expect(indexes.map((row) => row.indexname)).toEqual([
        "paper_orders_pkey",
        "paper_orders_user_generation_idempotency_key_unique",
      ]);
      await sql.unsafe(`
        INSERT INTO ${schema}.paper_orders (user_id, generation, idempotency_key) VALUES
          ('${resetUser}', 1, 'k'), ('${resetUser}', 2, 'k')
      `);
    } finally {
      await sql.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
      await sql.end();
    }
  });
});
