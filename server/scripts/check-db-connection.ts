import { sql } from "drizzle-orm";
import { closeDb, getDb } from "../data/drizzle/client";
import { inspectDatabaseUrl, redactDatabaseError } from "../infra/database-diagnostics";

async function main(): Promise<void> {
  const connectionString = process.env.SUPABASE_DB_URL ?? process.env.DATABASE_URL ?? process.env.POSTGRES_URL;
  const diagnostics = inspectDatabaseUrl(connectionString);
  console.log(JSON.stringify({ event: "database_configuration", ...diagnostics }));
  if (!connectionString) throw new Error("SUPABASE_DB_URL is not set");

  const db = getDb();
  await db.execute(sql`select 1`);
  const [companiesResult, fundamentalsResult] = await Promise.all([
    db.execute(sql<{ count: number }>`select count(*)::int as count from companies`),
    db.execute(sql<{ count: number }>`select count(*)::int as count from fundamentals`),
  ]);
  console.log(JSON.stringify({
    event: "database_connection_ok",
    selectOne: true,
    companies: Number(companiesResult[0]?.count ?? 0),
    fundamentals: Number(fundamentalsResult[0]?.count ?? 0),
  }));
}

main()
  .catch((error) => {
    const safe = redactDatabaseError(error);
    console.error(JSON.stringify({ event: "database_connection_failed", ...safe }));
    process.exitCode = 1;
  })
  .finally(() => closeDb());
