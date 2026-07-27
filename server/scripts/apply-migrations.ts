import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import { closeDb, getSqlClient } from "../data/drizzle/client";

if (!process.env.TEST_DATABASE_URL) {
  process.env.TEST_DATABASE_URL = "postgresql://postgres:tanmay@127.0.0.1:5432/maet_test";
}

export async function applyMigrations(): Promise<void> {
  const sql = getSqlClient();

  // Setup mock auth schema, auth.uid() function, Supabase roles, and optional table stubs for non-Supabase Postgres environments
  await sql`CREATE SCHEMA IF NOT EXISTS auth;`;
  await sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `;
  await sql`
    CREATE OR REPLACE FUNCTION auth.uid() RETURNS UUID AS $$
      SELECT COALESCE(
        NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
        '00000000-0000-0000-0000-000000000000'::uuid
      );
    $$ LANGUAGE sql STABLE;
  `;
  await sql`
    DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
        CREATE ROLE anon;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
        CREATE ROLE authenticated;
      END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
        CREATE ROLE service_role;
      END IF;
    END $$;
  `;

  // Pre-create optional market table stubs if needed by RLS migrations on fresh DBs
  const optionalTables = [
    "price_daily",
    "price_intraday",
    "sectors",
    "peers",
    "option_chain",
    "corporate_actions",
    "shareholding_patterns",
    "institutional_deals",
    "index_valuations",
    "market_baseline_metrics",
    "live_intraday_snapshots",
    "anomaly_flags",
    "source_audit",
    "ingestion_runs",
    "dead_letter_queue",
    "calculation_results",
  ];
  for (const tbl of optionalTables) {
    await sql.unsafe(`CREATE TABLE IF NOT EXISTS public.${tbl} (id uuid PRIMARY KEY DEFAULT gen_random_uuid());`);
  }

  // Ensure reject_reason column exists on paper_orders
  await sql`ALTER TABLE public.paper_orders ADD COLUMN IF NOT EXISTS reject_reason text;`;

  const migrationsDir = join(process.cwd(), "server/db/migrations");
  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files in ${migrationsDir}`);

  // Create migration tracking table if not exists
  await sql`
    CREATE TABLE IF NOT EXISTS public._applied_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  for (const file of files) {
    const name = file;
    const applied = await sql`
      SELECT name FROM public._applied_migrations WHERE name = ${name}
    `;

    if (applied.length > 0) {
      console.log(`Migration ${name} already applied, skipping.`);
      continue;
    }

    console.log(`Applying migration ${name}...`);
    const sqlContent = readFileSync(join(migrationsDir, file), "utf-8");
    await sql.unsafe(sqlContent);
    await sql`
      INSERT INTO public._applied_migrations (name) VALUES (${name})
    `;
    console.log(`Migration ${name} applied successfully.`);
  }
}

if (import.meta.main) {
  applyMigrations()
    .then(() => {
      console.log("All migrations applied successfully.");
    })
    .catch((err) => {
      console.error("Migration error:", err);
      process.exitCode = 1;
    })
    .finally(() => closeDb());
}
