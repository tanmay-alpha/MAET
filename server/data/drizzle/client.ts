/**
 * Drizzle ORM Client for Postgres/Supabase
 * Lazy singleton - only initializes when first used
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sqlClientInstance: postgres.Sql | null = null;

function isTestRun(env: NodeJS.ProcessEnv): boolean {
  return env.NODE_ENV === "test" || Boolean(env.BUN_TEST);
}

/**
 * Test runs must name their database explicitly (TEST_DATABASE_URL) and never
 * fall back to a shared local database or the application's URL. Outside tests
 * TEST_DATABASE_URL is ignored: a leftover value in a server's environment must
 * not redirect production traffic to a scratch database.
 */
export function resolveDatabaseUrl(env: NodeJS.ProcessEnv = process.env): string | undefined {
  if (isTestRun(env)) return env.TEST_DATABASE_URL || undefined;
  return env.SUPABASE_DB_URL || env.DATABASE_URL || env.POSTGRES_URL || undefined;
}

/**
 * Initialize or get the Drizzle database client
 * Connects to Supabase Postgres via connection string
 */
export function getDb(): ReturnType<typeof drizzle> {
  if (!dbInstance) {
    const connectionString = resolveDatabaseUrl();

    if (!connectionString) {
      if (!isTestRun(process.env)) {
        throw new Error("Database connection string not found. Set SUPABASE_DB_URL or DATABASE_URL env var.");
      }
      // Some modules wire a client at import time; let them load and fail on
      // first use (like an unreachable database would), without caching, so a
      // test that sets TEST_DATABASE_URL later still gets a real client.
      return new Proxy({} as ReturnType<typeof drizzle>, {
        get() {
          throw missingTestDatabaseError();
        },
      });
    }

    // Supabase's transaction pooler should receive a small bounded application
    // pool. Connection timeouts also prevent health/smoke processes from
    // remaining alive indefinitely when credentials or host details are wrong.
    sqlClientInstance = postgres(connectionString, {
      prepare: false,
      max: 5,
      connect_timeout: 10,
      idle_timeout: 20,
      max_lifetime: 60 * 30,
    });

    // Create Drizzle instance
    dbInstance = drizzle(sqlClientInstance, { schema });
  }

  return dbInstance;
}

/**
 * Get the raw postgres client for direct SQL queries
 * Useful for operations that Drizzle doesn't handle well (e.g., ON CONFLICT with composite PK)
 */
export function getSqlClient() {
  getDb(); // Ensure client is initialized
  if (!sqlClientInstance) throw missingTestDatabaseError();
  return sqlClientInstance;
}

function missingTestDatabaseError(): Error {
  return new Error(
    "TEST_DATABASE_URL is not set. Tests only connect to an explicitly configured, disposable database.",
  );
}

/** Close the pool and wait for its sockets/timers to be released. */
export async function closeDb(): Promise<void> {
  const current = sqlClientInstance;
  dbInstance = null;
  sqlClientInstance = null;
  if (!current) return;
  await current.end({ timeout: 1 });
}

/**
 * Reset the database client (useful for testing)
 */
export function resetDb() {
  const current = sqlClientInstance;
  dbInstance = null;
  sqlClientInstance = null;
  if (current) void current.end({ timeout: 0 });
}

// Named export for convenience - Drizzle ORM instance
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const instance = getDb();
    return (instance as any)[prop];
  },
});

// Re-export schema for use in routers
export * from "../../db/schema";
