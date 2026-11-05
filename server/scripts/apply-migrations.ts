import { readdirSync, readFileSync } from "fs";
import { join } from "path";
import postgres from "postgres";
import { getSqlClient } from "../data/drizzle/client";

export type ApplyMigrationsOptions = {
  /** Target connection; defaults to the shared app/test pool (TEST_DATABASE_URL under test). */
  sql?: postgres.Sql;
  migrationsDir?: string;
  /** Schema-qualified tracking table; overridable so tests can use an isolated schema. */
  trackingTable?: string;
};

/**
 * The CLI never guesses a database: MIGRATION_DATABASE_URL names the target,
 * and TEST_DATABASE_URL is accepted only for test runs (NODE_ENV=test).
 */
export function resolveMigrationDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string {
  if (env.MIGRATION_DATABASE_URL) return env.MIGRATION_DATABASE_URL;
  if (env.NODE_ENV === "test" && env.TEST_DATABASE_URL) return env.TEST_DATABASE_URL;
  throw new Error(
    "No migration target. Set MIGRATION_DATABASE_URL, or TEST_DATABASE_URL together with NODE_ENV=test.",
  );
}

// Statements PostgreSQL refuses to run inside a transaction block (or, for
// explicit transaction control, that would break the runner's own transaction).
const NON_TRANSACTIONAL_PATTERNS: ReadonlyArray<[RegExp, string]> = [
  [/\b(?:CREATE\s+(?:UNIQUE\s+)?INDEX|DROP\s+INDEX|REINDEX\b[^;]*?)\s+CONCURRENTLY\b/iu, "CONCURRENTLY"],
  [/\bVACUUM\b/iu, "VACUUM"],
  [/\b(?:CREATE|DROP)\s+DATABASE\b/iu, "CREATE/DROP DATABASE"],
  [/\bALTER\s+SYSTEM\b/iu, "ALTER SYSTEM"],
  [/^\s*(?:BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*;/imu, "explicit transaction control"],
];

/** Returns the reasons a migration cannot run inside the runner's transaction. */
export function findNonTransactionalStatements(sqlText: string): string[] {
  // Ignore `--` comments and dollar-quoted function/DO bodies (whose plpgsql
  // BEGIN/END are not transaction control) so only top-level statements count.
  const code = sqlText.replace(/--[^\n]*/gu, "").replace(/\$(\w*)\$[\s\S]*?\$\1\$/gu, "");
  return NON_TRANSACTIONAL_PATTERNS.filter(([pattern]) => pattern.test(code)).map(([, reason]) => reason);
}

export async function applyMigrations(options: ApplyMigrationsOptions = {}): Promise<void> {
  const sql = options.sql ?? getSqlClient();
  const migrationsDir = options.migrationsDir ?? join(process.cwd(), "server/db/migrations");
  const trackingTable = sql(options.trackingTable ?? "public._applied_migrations");

  // Local/CI PostgreSQL lacks Supabase's auth schema and roles; create minimal
  // stand-ins only where they are missing so Supabase's real auth.uid() is
  // never replaced when this runs against production.
  await sql`CREATE SCHEMA IF NOT EXISTS auth;`;
  await sql`
    CREATE TABLE IF NOT EXISTS auth.users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid()
    );
  `;
  await sql`
    DO $do$ BEGIN
      IF to_regprocedure('auth.uid()') IS NULL THEN
        CREATE FUNCTION auth.uid() RETURNS UUID AS $fn$
          SELECT COALESCE(
            NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid,
            '00000000-0000-0000-0000-000000000000'::uuid
          );
        $fn$ LANGUAGE sql STABLE;
      END IF;
    END $do$;
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

  const files = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  console.log(`Found ${files.length} migration files in ${migrationsDir}`);

  await sql`
    CREATE TABLE IF NOT EXISTS ${trackingTable} (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `;

  const appliedRows = await sql<{ name: string }[]>`SELECT name FROM ${trackingTable}`;
  const applied = new Set(appliedRows.map((row) => row.name));
  const pending = files
    .filter((name) => !applied.has(name))
    .map((name) => ({ name, content: readFileSync(join(migrationsDir, name), "utf-8") }));

  // Refuse to start if any pending file cannot run atomically, before applying
  // anything, so the database is never left between two migrations.
  const blocked = pending
    .map(({ name, content }) => ({ name, reasons: findNonTransactionalStatements(content) }))
    .filter(({ reasons }) => reasons.length > 0);
  if (blocked.length > 0) {
    const details = blocked.map(({ name, reasons }) => `${name} (${reasons.join(", ")})`).join("; ");
    throw new Error(
      `Migrations cannot run inside a transaction: ${details}. ` +
        "Apply those statements manually, record the file in the tracking table, and keep migration files transactional.",
    );
  }

  for (const { name, content } of pending) {
    console.log(`Applying migration ${name}...`);
    // DDL and the tracking row commit together: a failing file leaves neither
    // partial schema changes nor a row claiming it was applied.
    await sql.begin(async (tx) => {
      await tx.unsafe(content);
      await tx`INSERT INTO ${trackingTable} (name) VALUES (${name})`;
    });
    console.log(`Migration ${name} applied successfully.`);
  }
}

if (import.meta.main) {
  let target: postgres.Sql | undefined;
  try {
    target = postgres(resolveMigrationDatabaseUrl(), { max: 1, prepare: false, onnotice: () => {} });
    await applyMigrations({ sql: target });
    console.log("All migrations applied successfully.");
  } catch (err) {
    console.error("Migration error:", err);
    process.exitCode = 1;
  } finally {
    await target?.end({ timeout: 5 });
  }
}
