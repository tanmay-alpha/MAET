/**
 * Drizzle ORM Client for Postgres/Supabase
 * Lazy singleton - only initializes when first used
 */

import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let sqlClient: postgres.Sql | null = null;

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

    // Create postgres client (no pool by default - uses default pool size of 10)
    sqlClient = postgres(connectionString, {
      prepare: false, // Disable prepared statements for serverless compatibility
    });

    // Create Drizzle instance
    dbInstance = drizzle(sqlClient, { schema });
  }

  return dbInstance;
}

/**
 * Reset the database client (useful for testing)
 */
export function resetDb() {
  if (sqlClient) {
    sqlClient.end();
  }
  dbInstance = null;
  sqlClient = null;
}

// Named export for convenience
export const db = new Proxy({} as ReturnType<typeof drizzle>, {
  get(_target, prop) {
    const instance = getDb();
    return (instance as any)[prop];
  },
});

// Re-export schema for use in routers
export * from "./schema";