import { getSqlClient, closeDb } from "../data/drizzle/client";
import * as fs from "node:fs";
import * as path from "node:path";
import { getConfig } from "../config";

async function main() {
  // Load config to initialize environment variables
  getConfig();
  
  const sqlFilePath = path.join(import.meta.dirname, "../../insert_baselines.sql");
  console.log(`Reading SQL file from: ${sqlFilePath}`);
  
  const sql = fs.readFileSync(sqlFilePath, "utf8");
  
  const client = getSqlClient();
  
  console.log("Executing SQL statements...");
  
  // Execute the raw SQL statements
  await client.unsafe(sql);
  
  console.log("✅ Successfully populated market_baseline_metrics in Supabase!");
}

main()
  .catch((err) => {
    console.error("❌ Failed to populate baseline metrics:", err);
    process.exit(1);
  })
  .finally(async () => {
    await closeDb();
  });
