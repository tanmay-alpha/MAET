/**
 * Backfill BSE scrip codes and BSE companies via Supabase REST API.
 *
 * Usage:
 *   bun --env-file=.env run server/scripts/run-bse-backfill-rest.ts
 */

import * as fs from "fs";
import * as path from "path";

async function main() {
  const supabaseUrl = process.env.SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceKey) {
    throw new Error("SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are required in env");
  }

  // 1. Fetch existing symbols to know what's in the DB (use limit=5000)
  console.log("Fetching existing companies from DB...");
  const selectUrl = `${supabaseUrl}/rest/v1/companies?select=symbol&limit=5000`;
  const selectRes = await fetch(selectUrl, {
    headers: {
      "apikey": serviceKey,
      "Authorization": `Bearer ${serviceKey}`,
    }
  });

  if (!selectRes.ok) {
    throw new Error(`Failed to fetch existing companies: ${selectRes.status} ${await selectRes.text()}`);
  }

  const existingList = await selectRes.json() as { symbol: string }[];
  const existingSymbols = new Set(existingList.map(c => c.symbol.toUpperCase()));
  console.log(`Loaded ${existingList.length} existing companies from database.`);

  // 2. Read Zerodha instruments CSV file
  const scratchDir = path.join(
    "C:",
    "Users",
    "TANMAY",
    ".gemini",
    "antigravity-ide",
    "brain",
    "d7266fc6-94b9-40fd-93fc-4e48c060bbd6",
    "scratch"
  );
  const filePath = path.join(scratchDir, "api-scrip-master.csv");
  let text = "";
  if (fs.existsSync(filePath)) {
    text = fs.readFileSync(filePath, "utf8");
  } else {
    const url = "https://api.kite.trade/instruments";
    console.log(`Downloading instruments from Zerodha: ${url}`);
    const response = await fetch(url);
    if (!response.ok) throw new Error("Fetch instruments failed");
    text = await response.text();
    fs.writeFileSync(filePath, text);
  }

  const lines = text.split("\n");
  const headers = lines[0].split(",");
  const exchangeIdx = headers.indexOf("exchange");
  const exchangeTokenIdx = headers.indexOf("exchange_token");
  const tradingSymbolIdx = headers.indexOf("tradingsymbol");
  const nameIdx = headers.indexOf("name");
  const instrumentTypeIdx = headers.indexOf("instrument_type");

  const updates: Array<{ id: string; symbol: string; bse_code: string; updated_at: string }> = [];
  const inserts: any[] = [];
  const bseOnlyInsertedSymbols = new Set<string>();

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

      if (existingSymbols.has(symbol)) {
        // Supply id as symbol to satisfy NOT NULL constraints during PostgREST upsert evaluation.
        updates.push({
          id: symbol,
          symbol,
          bse_code: bseCode,
          updated_at: new Date().toISOString(),
        });
      } else {
        if (!bseOnlyInsertedSymbols.has(symbol)) {
          bseOnlyInsertedSymbols.add(symbol);
          inserts.push({
            id: symbol,
            symbol,
            name,
            exchange: "BSE",
            series: "EQ",
            bse_code: bseCode,
            yahoo_symbol: `${symbol}.BO`,
            exchange_primary: "BSE",
            market_cap_bucket: "unknown",
            is_active: true,
            data_source: "bse_kite",
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          });
        }
      }
    }
  }

  console.log(`Prepared ${updates.length} updates and ${inserts.length} inserts.`);

  // 3. Send updates in batches of 200 via PostgREST bulk upsert
  const batchSize = 200;
  let updatedCount = 0;
  console.log("Applying updates to existing companies...");
  for (let index = 0; index < updates.length; index += batchSize) {
    const batch = updates.slice(index, index + batchSize);
    const upsertUrl = `${supabaseUrl}/rest/v1/companies`;
    const res = await fetch(upsertUrl, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=merge-duplicates",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      console.error(`Failed to update batch at index ${index}:`, res.status, await res.text());
    } else {
      updatedCount += batch.length;
    }
  }
  console.log(`Updated ${updatedCount} companies successfully.`);

  // 4. Send inserts in batches of 200 via PostgREST bulk insert
  let insertedCount = 0;
  console.log("Inserting new BSE-only companies...");
  for (let index = 0; index < inserts.length; index += batchSize) {
    const batch = inserts.slice(index, index + batchSize);
    const insertUrl = `${supabaseUrl}/rest/v1/companies`;
    const res = await fetch(insertUrl, {
      method: "POST",
      headers: {
        "apikey": serviceKey,
        "Authorization": `Bearer ${serviceKey}`,
        "Content-Type": "application/json",
        "Prefer": "resolution=ignore-duplicates",
      },
      body: JSON.stringify(batch),
    });

    if (!res.ok) {
      console.error(`Failed to insert batch at index ${index}:`, res.status, await res.text());
    } else {
      insertedCount += batch.length;
    }
  }
  console.log(`Inserted ${insertedCount} new BSE-only companies successfully.`);
  console.log("BSE companies backfill successfully complete!");
}

main().catch(console.error);
