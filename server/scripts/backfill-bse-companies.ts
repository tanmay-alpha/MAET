/**
 * Backfill BSE scrip codes for existing NSE companies and insert BSE-only companies.
 *
 * Uses the Zerodha Kite instruments dump to map BSE scrip codes (exchange_token)
 * to trading symbols.
 *
 * Usage:
 *   bun --env-file=.env run server/scripts/backfill-bse-companies.ts
 */

import { closeDb, db } from "../data/drizzle/client";
import { closeRedis } from "../data/redis/client";
import { companies } from "../db/schema";
import { eq } from "drizzle-orm";

async function main() {
  if (!process.env.SUPABASE_DB_URL && !process.env.DATABASE_URL) {
    throw new Error("SUPABASE_DB_URL or DATABASE_URL is required");
  }

  console.log("Fetching existing companies from DB...");
  const existingList = await db.select({
    id: companies.id,
    symbol: companies.symbol,
    isin: companies.isin,
  }).from(companies);

  const existingBySymbol = new Map(existingList.map(c => [c.symbol, c]));
  console.log(`Loaded ${existingList.length} existing companies.`);

  const url = "https://api.kite.trade/instruments";
  console.log(`Downloading Zerodha instruments from: ${url}`);
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download instruments: ${response.status}`);
  }
  const text = await response.text();
  console.log("Instruments downloaded successfully.");

  const lines = text.split("\n");
  const headers = lines[0].split(",");
  const exchangeIdx = headers.indexOf("exchange");
  const exchangeTokenIdx = headers.indexOf("exchange_token");
  const tradingSymbolIdx = headers.indexOf("tradingsymbol");
  const nameIdx = headers.indexOf("name");
  const instrumentTypeIdx = headers.indexOf("instrument_type");

  let updatedCount = 0;
  let newBseInserted = 0;

  // Track BSE-only symbols to avoid duplicate inserts
  const bseOnlyInsertedSymbols = new Set<string>();

  // We will run updates and collect inserts
  const inserts: any[] = [];

  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const cols = lines[i].split(",");
    
    const exchange = cols[exchangeIdx];
    const instrumentType = cols[instrumentTypeIdx];
    
    if (exchange === "BSE" && instrumentType === "EQ") {
      const symbol = cols[tradingSymbolIdx]?.trim().toUpperCase();
      const bseCode = cols[exchangeTokenIdx]?.trim();
      let name = cols[nameIdx]?.trim() || symbol;
      if (name.startsWith('"') && name.endsWith('"')) {
        name = name.slice(1, -1).trim();
      }

      if (!symbol || !bseCode) continue;

      const existing = existingBySymbol.get(symbol);
      if (existing) {
        // Update existing NSE company with its BSE code
        await db.update(companies)
          .set({
            bseCode,
            updatedAt: new Date(),
          })
          .where(eq(companies.symbol, symbol));
        updatedCount++;
      } else {
        // This is a BSE-only company
        if (!bseOnlyInsertedSymbols.has(symbol)) {
          bseOnlyInsertedSymbols.add(symbol);
          inserts.push({
            id: symbol,
            symbol,
            name,
            exchange: "BSE",
            series: "EQ",
            bseCode,
            yahooSymbol: `${symbol}.BO`,
            exchangePrimary: "BSE",
            marketCapBucket: "unknown",
            isActive: true,
            dataSource: "bse_kite",
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }
    }
  }

  console.log(`Updated ${updatedCount} existing NSE companies with BSE codes.`);

  // Insert BSE-only companies in batches of 200
  const batchSize = 200;
  for (let index = 0; index < inserts.length; index += batchSize) {
    const batch = inserts.slice(index, index + batchSize);
    await db.insert(companies).values(batch).onConflictDoNothing();
    newBseInserted += batch.length;
  }

  console.log(`Inserted ${newBseInserted} new BSE-only companies.`);
  console.log("BSE companies backfill successfully complete!");
}

main()
  .catch(console.error)
  .finally(async () => {
    await closeRedis();
    await closeDb();
  });
