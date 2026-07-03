/**
 * Resumable Nifty 500 fundamentals enrichment.
 *
 * ENRICH_OFFSET=0 ENRICH_LIMIT=25 bun run enrich:nifty500
 */
import { closeDb } from "../data/drizzle/client";
import { closeRedis } from "../data/redis/client";
import { getNifty500Constituents } from "../data/sources/nse-index-constituents";
import { runDailyProcessor } from "../workers/daily-processor";

function nonNegativeInteger(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value < 0) throw new Error(`${name} must be a non-negative integer`);
  return value;
}

async function main(): Promise<void> {
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required");
  }
  const offset = nonNegativeInteger("ENRICH_OFFSET", 0);
  const limit = nonNegativeInteger("ENRICH_LIMIT", 25);
  if (limit === 0) throw new Error("ENRICH_LIMIT must be greater than zero");

  const universe = await getNifty500Constituents();
  const symbols = universe.slice(offset, offset + limit).map((company) => company.symbol);
  if (symbols.length === 0) throw new Error(`No Nifty 500 symbols at offset ${offset}`);

  console.log(JSON.stringify({ event: "nifty500_enrichment_started", offset, limit: symbols.length, total: universe.length }));
  const stats = await runDailyProcessor({
    symbols,
    timeframes: [],
    syncCompanyMaster: false,
    syncMarketData: false,
    syncFundamentals: true,
    refreshClassifications: true,
    cleanupStaleData: false,
  });
  const nextOffset = offset + symbols.length;
  const batchComplete = stats.fundamentalsFailed.length === 0;
  console.log(JSON.stringify({
    event: "nifty500_enrichment_finished",
    fundamentalsSynced: stats.fundamentalsSynced,
    fundamentalsFailed: stats.fundamentalsFailed,
    classificationsSynced: stats.classificationsSynced,
    errors: stats.errors.length,
    nextOffset: batchComplete && nextOffset < universe.length ? nextOffset : batchComplete ? null : offset,
  }));
  if (!batchComplete || stats.errors.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await closeDb();
  });
