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

    // Create postgres client (no pool by default - uses default pool size of 10)
    sqlClientInstance = postgres(connectionString, {
      prepare: false, // Disable prepared statements for serverless compatibility
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

/**
 * Reset the database client (useful for testing)
 */
export function resetDb() {
  if (sqlClientInstance) {
    sqlClientInstance.end();
  }
  dbInstance = null;
  sqlClientInstance = null;
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