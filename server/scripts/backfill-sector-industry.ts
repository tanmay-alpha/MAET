/**
 * Backfill sector and industry for Nifty 500 companies.
 *
 * Uses the NSE Nifty 500 CSV (which includes an INDUSTRY column) to populate
 * the industry field for all 500 companies in one offline pass.
 *
 * Sector (the broader category) comes from Yahoo assetProfile — run
 * enrich:nifty500 after deploying the updated yahoo-fundamentals code to
 * pull it via the new assetProfile module.
 *
 * Usage:
 *   bun --env-file=.env run server/scripts/backfill-sector-industry.ts
 */

import { closeDb, db } from "../data/drizzle/client";
import { closeRedis } from "../data/redis/client";
import { getNifty500Constituents } from "../data/sources/nse-index-constituents";
import { companies } from "../db/schema";
import { eq } from "drizzle-orm";

async function main(): Promise<void> {
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required");
  }

  console.log(JSON.stringify({ event: "backfill_sector_industry_started" }));

  // Load Nifty 500 constituents — the NSE CSV has an INDUSTRY column
  // with reliable industry labels for all 500 stocks.
  const constituents = await getNifty500Constituents();
  console.log(JSON.stringify({ event: "nse_constituents_loaded", count: constituents.length }));

  let updatedFromNSE = 0;
  let skipped = 0;

  for (const constituent of constituents) {
    const industry = constituent.industry?.trim();
    if (!industry) { skipped++; continue; }

    // Only update companies that already exist in the database.
    await db
      .update(companies)
      .set({
        industry,
        updatedAt: new Date(),
      })
      .where(eq(companies.symbol, constituent.symbol));

    updatedFromNSE++;
  }

  console.log(JSON.stringify({
    event: "nse_industry_backfill_complete",
    updated: updatedFromNSE,
    skipped,
    total: constituents.length,
    note: "Run enrich:nifty500 to pull Yahoo sector data via assetProfile module",
  }));
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
