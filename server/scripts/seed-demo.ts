/**
 * `bun run seed:demo` — writes the synthetic demo dataset (server/modules/demo/seed.ts).
 *
 * Target: MIGRATION_DATABASE_URL, or TEST_DATABASE_URL with NODE_ENV=test. Never the app's
 * DATABASE_URL / SUPABASE_DB_URL. A target that is not a local database is refused unless
 * `--i-know` is passed (server/modules/demo/target.ts). Re-running replaces the previous demo rows.
 *
 *   MIGRATION_DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/maet_demo bun run seed:demo
 */

import { closeDb, resolveDatabaseUrl } from "../data/drizzle/client";
import { countDemoRows, seedDemo } from "../modules/demo/seed";
import { DemoTargetRefusedError, resolveDemoSeedTarget } from "../modules/demo/target";

async function main(): Promise<void> {
  const target = resolveDemoSeedTarget(process.env, process.argv.slice(2));
  // The shared client (used by the paper and backtest writers) resolves its URL lazily on first
  // use. Point both of its sources at the target before anything connects.
  process.env.TEST_DATABASE_URL = target;
  process.env.SUPABASE_DB_URL = target;
  if (resolveDatabaseUrl() !== target) throw new Error("Could not point the database client at the seed target");

  try {
    const summary = await seedDemo();
    console.log(`Seeded synthetic demo data: ${summary.symbols.join(", ")}`);
    console.log(`  ${summary.barsPerSymbol} daily bars per symbol, ${summary.fills} paper fills`);
    console.log(`  backtest job ${summary.backtestJobId}: ${summary.backtestTrades} trades, data hash ${summary.backtestDataHash}`);
    console.log(`  rows: ${JSON.stringify(await countDemoRows())}`);
  } finally {
    await closeDb();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof DemoTargetRefusedError ? error.message : error);
  process.exit(1);
});
