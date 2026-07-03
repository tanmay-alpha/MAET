/**
 * Drizzle ORM Client for Postgres/Supabase
 * Lazy singleton - only initializes when first used
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "../../db/schema";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sqlClientInstance: postgres.Sql | null = null;

/**
 * Initialize or get the Drizzle database client
 * Connects to Supabase Postgres via connection string
 */
export function getDb() {
  if (!dbInstance) {
    const connectionString = process.env.SUPABASE_DB_URL ||
                            process.env.DATABASE_URL ||
                            process.env.POSTGRES_URL;

    if (!connectionString) {
      throw new Error(
        "Database connection string not found. Set SUPABASE_DB_URL or DATABASE_URL env var."
      );
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
  return sqlClientInstance!;
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
