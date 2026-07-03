/**
 * Screener v4 Smoke Test
 *
 * Verifies the MAET backend can connect to Supabase and ingest market data.
 * Tests with 5 NSE symbols: RELIANCE, HDFCBANK, TCS, INFY, 20MICRONS
 *
 * Usage:
 *   bun run smoke:screener-v4
 *
 * Or directly:
 *   bun run server/scripts/screener-v4-smoke-test.ts
 */

import { closeDb, db, getSqlClient } from "../data/drizzle/client";
import { sql } from "drizzle-orm";
import {
  candles,
  companies,
  companyIdentifiers,
  financialStatements,
  fundamentals,
  marketCapClassifications,
  quoteSnapshots,
} from "../db/schema";
import { getNseCompanyMaster } from "../data/sources/nse-company-master";
import { getCandles, getQuote } from "../data/sources/yahoo";
import { getYahooFundamentals } from "../data/sources/yahoo-fundamentals";
import { resolveMarketSymbol } from "../domain/market/symbol";
import { closeRedis, getRedis } from "../data/redis/client";

// Test symbols as specified
const TEST_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "20MICRONS"];

// Table row counts
interface RowCounts {
  companies: number;
  company_identifiers: number;
  quote_snapshots: number;
  candles: number;
  fundamentals: number;
  financial_statements: number;
  market_cap_classifications: number;
}

async function countRows(): Promise<RowCounts> {
  const [
    companiesCount,
    identifiersCount,
    snapshotsCount,
    candlesCount,
    fundamentalsCount,
    statementsCount,
    classificationsCount,
  ] = await Promise.all([
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM companies`),
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM company_identifiers`),
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM quote_snapshots`),
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM candles`),
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM fundamentals`),
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM financial_statements`),
    db.execute(sql<{ count: number }>`SELECT COUNT(*)::int as count FROM market_cap_classifications`),
  ]);

  return {
    companies: Number((companiesCount[0] as { count: number })?.count ?? 0),
    company_identifiers: Number((identifiersCount[0] as { count: number })?.count ?? 0),
    quote_snapshots: Number((snapshotsCount[0] as { count: number })?.count ?? 0),
    candles: Number((candlesCount[0] as { count: number })?.count ?? 0),
    fundamentals: Number((fundamentalsCount[0] as { count: number })?.count ?? 0),
    financial_statements: Number((statementsCount[0] as { count: number })?.count ?? 0),
    market_cap_classifications: Number((classificationsCount[0] as { count: number })?.count ?? 0),
  };
}

function printCounts(label: string, before: RowCounts, after: RowCounts): void {
  console.log(`\n${label}`);
  console.log("─".repeat(60));
  console.log(`{"companies":${before.companies} → ${after.companies}, "delta":${after.companies - before.companies}}`);
  console.log(`{"company_identifiers":${before.company_identifiers} → ${after.company_identifiers}, "delta":${after.company_identifiers - before.company_identifiers}}`);
  console.log(`{"quote_snapshots":${before.quote_snapshots} → ${after.quote_snapshots}, "delta":${after.quote_snapshots - before.quote_snapshots}}`);
  console.log(`{"candles":${before.candles} → ${after.candles}, "delta":${after.candles - before.candles}}`);
  console.log(`{"fundamentals":${before.fundamentals} → ${after.fundamentals}, "delta":${after.fundamentals - before.fundamentals}}`);
  console.log(`{"financial_statements":${before.financial_statements} → ${after.financial_statements}, "delta":${after.financial_statements - before.financial_statements}}`);
  console.log(`{"market_cap_classifications":${before.market_cap_classifications} → ${after.market_cap_classifications}, "delta":${after.market_cap_classifications - before.market_cap_classifications}}`);
}

async function fetchNseCompanyIdentity(symbol: string): Promise<{
  name: string;
  isin: string | null;
  listingDate?: string;
  faceValue?: number;
  marketLot?: number;
} | null> {
  try {
    const master = await getNseCompanyMaster(false);
    const company = master.find((c) => c.symbol === symbol);
    if (company) {
      return {
        name: company.name,
        isin: company.isin || null,
        listingDate: company.listingDate,
        faceValue: company.faceValue,
        marketLot: company.marketLot,
      };
    }
    return null;
  } catch (err) {
    console.warn(`  ⚠ NSE company master fetch failed for ${symbol}: ${err}`);
    return null;
  }
}

type SmokeQuote = {
  price: number;
  volume: number;
  changePct?: number;
  asOf: Date;
  source: "angelone" | "yahoo" | "nse";
};

async function fetchQuoteSnapshot(symbol: string): Promise<SmokeQuote | null> {
  try {
    const resolved = resolveMarketSymbol(symbol);
    const tick = await getQuote(resolved.symbol, resolved.ticker);
    return {
      price: tick.price,
      volume: tick.volume,
      changePct: tick.changePct,
      asOf: new Date(tick.ts),
      source: tick.source,
    };
  } catch (err) {
    console.warn(`  ⚠ Quote fetch failed for ${symbol}: ${err}`);
    return null;
  }
}

async function storeCompanyAndIdentity(
  symbol: string,
  identity: { name: string; isin: string | null; listingDate?: string; faceValue?: number; marketLot?: number },
  quote?: SmokeQuote
): Promise<boolean> {
  try {
    const now = new Date();
    const companyId = symbol.toUpperCase();

    // Upsert company
    await db.insert(companies).values({
      id: companyId,
      symbol: companyId,
      name: identity.name,
      exchange: "NSE",
      series: "EQ",
      isin: identity.isin,
      listingDate: identity.listingDate ? new Date(`${identity.listingDate}T00:00:00Z`) : null,
      faceValue: identity.faceValue?.toString(),
      marketLot: identity.marketLot,
      isActive: true,
      dataSource: "nse",
      lastMasterUpdate: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: companies.symbol,
      set: {
        name: sql`excluded.name`,
        isin: sql`excluded.isin`,
        listingDate: sql`excluded.listing_date`,
        faceValue: sql`excluded.face_value`,
        marketLot: sql`excluded.market_lot`,
        isActive: true,
        dataSource: sql`excluded.data_source`,
        lastMasterUpdate: now,
        updatedAt: now,
      },
    });

    // Upsert company identifiers
    const identifiers = [
      {
        companyId,
        identifierType: "nse_symbol",
        identifierValue: symbol,
        source: "nse",
        verifiedAt: now,
      },
      ...(identity.isin ? [{
        companyId,
        identifierType: "isin",
        identifierValue: identity.isin,
        source: "nse",
        verifiedAt: now,
      }] : []),
      {
        companyId,
        identifierType: "yahoo_symbol",
        identifierValue: `${symbol}.NS`,
        source: "derived_from_nse_symbol",
        verifiedAt: now,
      },
    ];

    await db.insert(companyIdentifiers).values(identifiers)
      .onConflictDoUpdate({
        target: [companyIdentifiers.identifierType, companyIdentifiers.identifierValue],
        set: {
          companyId: sql`excluded.company_id`,
          source: sql`excluded.source`,
          verifiedAt: now,
        },
      });

    // Upsert quote snapshot
    if (quote && quote.price > 0) {
      await db.insert(quoteSnapshots).values({
        companyId,
        price: quote.price.toString(),
        changePct: quote.changePct?.toString(),
        volume: quote.volume,
        asOf: quote.asOf,
        source: quote.source,
      }).onConflictDoUpdate({
        target: [quoteSnapshots.companyId, quoteSnapshots.asOf],
        set: {
          price: quote.price.toString(),
          changePct: quote.changePct?.toString(),
          volume: quote.volume,
          source: quote.source,
        },
      });
    }

    console.log(`    ✓ Stored company: ${symbol} (${identity.name})`);
    return true;
  } catch (err) {
    console.warn(`    ⚠ Failed to store company/identity for ${symbol}: ${err}`);
    return false;
  }
}

async function fetchYahooCandles(symbol: string): Promise<number> {
  try {
    const resolved = resolveMarketSymbol(symbol);
    const to = new Date();
    const from = new Date(to.getTime() - 30 * 24 * 60 * 60 * 1000); // 30 days
    const candlesData = await getCandles(resolved.ticker, from, to, "1d");

    // Upsert candles using raw SQL to avoid Drizzle onConflictDoUpdate bug with composite PK
    if (candlesData.length > 0) {
      console.log(`    ${candlesData.length} candles fetched, storing...`);
      const rawSql = getSqlClient();

      for (const candle of candlesData) {
        await rawSql`
          INSERT INTO candles (symbol, timeframe, ts, open, high, low, close, volume, source)
          VALUES (${resolved.symbol}, '1d', ${candle.ts}, ${candle.open}, ${candle.high}, ${candle.low}, ${candle.close}, ${Math.floor(candle.volume)}, 'yahoo')
          ON CONFLICT (symbol, timeframe, ts) DO UPDATE SET
            open = EXCLUDED.open,
            high = EXCLUDED.high,
            low = EXCLUDED.low,
            close = EXCLUDED.close,
            volume = EXCLUDED.volume,
            source = EXCLUDED.source
        `;
      }
      console.log(`    ✓ Inserted ${candlesData.length} candle rows`);
    }
    return candlesData.length;
  } catch (err) {
    console.warn(`  ⚠ Yahoo candles fetch failed for ${symbol}: ${err}`);
    return 0;
  }
}

async function fetchFundamentals(symbol: string): Promise<boolean> {
  try {
    const yahoo = await getYahooFundamentals(symbol);
    if (!yahoo) {
      console.log(`  ℹ Yahoo fundamentals returned null (401/429/unavailable) for ${symbol} - logging and continuing`);
      return false;
    }

    const now = new Date(yahoo.asOf);
    const companyId = symbol.toUpperCase();

    // Upsert company
    await db.insert(companies).values({
      id: companyId,
      symbol: companyId,
      name: companyId,
      exchange: "NSE",
      yahooSymbol: `${companyId}.NS`,
      marketCap: yahoo.marketCap?.toString(),
      peRatio: yahoo.trailingPe?.toString(),
      pbRatio: yahoo.pb?.toString(),
      roe: yahoo.roe?.toString(),
      dividendYield: yahoo.dividendYield?.toString(),
      eps: yahoo.epsTtm?.toString(),
      debtToEquity: yahoo.debtToEquity?.toString(),
      lastFundamentalsUpdate: now,
      updatedAt: now,
    }).onConflictDoUpdate({
      target: companies.symbol,
      set: {
        yahooSymbol: `${companyId}.NS`,
        marketCap: yahoo.marketCap?.toString(),
        peRatio: yahoo.trailingPe?.toString(),
        pbRatio: yahoo.pb?.toString(),
        roe: yahoo.roe?.toString(),
        dividendYield: yahoo.dividendYield?.toString(),
        eps: yahoo.epsTtm?.toString(),
        debtToEquity: yahoo.debtToEquity?.toString(),
        lastFundamentalsUpdate: now,
        updatedAt: now,
      },
    });

    // Upsert fundamentals
    const fundId = `${companyId}-fundamentals-${now.toISOString().slice(0, 10)}`;
    await db.insert(fundamentals).values({
      id: fundId,
      companyId,
      periodDate: now,
      periodType: "snapshot",
      marketCap: yahoo.marketCap?.toString(),
      peRatio: yahoo.trailingPe?.toString(),
      forwardPe: yahoo.forwardPe?.toString(),
      pbRatio: yahoo.pb?.toString(),
      roe: yahoo.roe?.toString(),
      dividendYield: yahoo.dividendYield?.toString(),
      eps: yahoo.epsTtm?.toString(),
      bookValuePerShare: yahoo.bookValuePerShare?.toString(),
      debtToEquity: yahoo.debtToEquity?.toString(),
      fiftyTwoWeekHigh: yahoo.fiftyTwoWeekHigh?.toString(),
      fiftyTwoWeekLow: yahoo.fiftyTwoWeekLow?.toString(),
      source: "yahoo",
      isStale: false,
    }).onConflictDoUpdate({
      target: fundamentals.id,
      set: {
        marketCap: yahoo.marketCap?.toString(),
        peRatio: yahoo.trailingPe?.toString(),
        forwardPe: yahoo.forwardPe?.toString(),
        pbRatio: yahoo.pb?.toString(),
        roe: yahoo.roe?.toString(),
        dividendYield: yahoo.dividendYield?.toString(),
        eps: yahoo.epsTtm?.toString(),
        bookValuePerShare: yahoo.bookValuePerShare?.toString(),
        debtToEquity: yahoo.debtToEquity?.toString(),
        fiftyTwoWeekHigh: yahoo.fiftyTwoWeekHigh?.toString(),
        fiftyTwoWeekLow: yahoo.fiftyTwoWeekLow?.toString(),
        isStale: false,
      },
    });

    // Upsert financial statements
    for (const statement of yahoo.statements) {
      const statementId = `${companyId}-${statement.periodType}-${statement.periodDate.slice(0, 10)}`;
      await db.insert(financialStatements).values({
        id: statementId,
        companyId,
        periodDate: new Date(statement.periodDate),
        periodType: statement.periodType,
        statementType: "combined",
        fiscalYear: statement.fiscalYear,
        currency: statement.currency,
        revenue: statement.revenue?.toString(),
        costOfRevenue: statement.costOfRevenue?.toString(),
        operatingIncome: statement.operatingIncome?.toString(),
        ebitda: statement.ebitda?.toString(),
        ebit: statement.ebit?.toString(),
        interestExpense: statement.interestExpense?.toString(),
        taxExpense: statement.taxExpense?.toString(),
        netIncome: statement.netIncome?.toString(),
        totalAssets: statement.totalAssets?.toString(),
        currentAssets: statement.currentAssets?.toString(),
        inventory: statement.inventory?.toString(),
        cashAndEquivalents: statement.cashAndEquivalents?.toString(),
        totalLiabilities: statement.totalLiabilities?.toString(),
        currentLiabilities: statement.currentLiabilities?.toString(),
        totalDebt: statement.totalDebt?.toString(),
        shareholdersEquity: statement.shareholdersEquity?.toString(),
        operatingCashFlow: statement.operatingCashFlow?.toString(),
        capitalExpenditure: statement.capitalExpenditure?.toString(),
        dividendsPaid: statement.dividendsPaid?.toString(),
        sharesOutstanding: statement.sharesOutstanding?.toString(),
        source: "yahoo",
        asOf: now,
        updatedAt: now,
      }).onConflictDoUpdate({
        target: financialStatements.id,
        set: {
          revenue: statement.revenue?.toString(),
          netIncome: statement.netIncome?.toString(),
          asOf: now,
          updatedAt: now,
        },
      });
    }

    console.log(`  ✓ Yahoo fundamentals synced: ${yahoo.statements.length} statements, PE: ${yahoo.trailingPe}`);
    return true;
  } catch (err) {
    console.warn(`  ⚠ Yahoo fundamentals failed for ${symbol}: ${err}`);
    return false;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("MAET Screener v4 Smoke Test");
  console.log("=".repeat(60));
  console.log(`\nTest symbols: ${TEST_SYMBOLS.join(", ")}`);
  console.log(`Started at: ${new Date().toISOString()}`);

  // Check environment
  const dbUrl = process.env.SUPABASE_DB_URL || process.env.DATABASE_URL;
  const redisUrl = process.env.UPSTASH_REDIS_URL;

  console.log(`\nEnvironment:`);
  console.log(`  SUPABASE_DB_URL: ${dbUrl ? "✓ set" : "✗ NOT SET"}`);
  console.log(`  UPSTASH_REDIS_URL: ${redisUrl ? "✓ set" : "✗ NOT SET"}`);

  if (!dbUrl) {
    console.error("\nFATAL: SUPABASE_DB_URL is not set. Cannot proceed.");
    process.exit(1);
  }

  console.log("\nConnection checks:");
  await getSqlClient()`select 1`;
  console.log("  Supabase PostgreSQL: reachable");
  if (redisUrl) {
    const redisReply = await getRedis().ping();
    if (redisReply !== "PONG") throw new Error(`Redis ping returned ${redisReply}`);
    console.log("  Redis: reachable");
  } else {
    console.log("  Redis: not configured; cache verification skipped");
  }

  // Record initial counts
  console.log("\n📊 Counting rows BEFORE ingestion...");
  const beforeCounts = await countRows();
  console.log(`\nRow counts BEFORE:`);
  Object.entries(beforeCounts).forEach(([table, count]) => {
    console.log(`  ${table}: ${count}`);
  });

  // Step 1: Fetch NSE company identity/ISIN and store companies + identifiers
  console.log("\n📥 Step 1: Fetching NSE company identity/ISIN...");
  const nseIdentities: Map<string, { name: string; isin: string | null; listingDate?: string; faceValue?: number; marketLot?: number }> = new Map();
  for (const symbol of TEST_SYMBOLS) {
    const identity = await fetchNseCompanyIdentity(symbol);
    if (identity) {
      nseIdentities.set(symbol, identity);
      console.log(`  ✓ ${symbol}: ${identity.name} (ISIN: ${identity.isin || "N/A"})`);
    } else {
      console.log(`  ✗ ${symbol}: NOT FOUND in NSE company master`);
    }
  }

  // Step 2: Fetch quote snapshots
  console.log("\n📈 Step 2: Fetching quote snapshots from Yahoo...");
  const quotes = new Map<string, SmokeQuote>();
  for (const symbol of TEST_SYMBOLS) {
    const quote = await fetchQuoteSnapshot(symbol);
    if (quote) {
      quotes.set(symbol, quote);
      console.log(`  ✓ ${symbol}: ₹${quote.price.toFixed(2)} (vol: ${quote.volume.toLocaleString()})`);
    } else {
      console.log(`  ✗ ${symbol}: Quote unavailable`);
    }
  }

  // Step 3: Store companies + identifiers from NSE identity data
  console.log("\n📦 Step 3: Storing companies, identifiers, and quote snapshots...");
  let companiesStored = 0;
  for (const symbol of TEST_SYMBOLS) {
    const identity = nseIdentities.get(symbol);
    const quote = quotes.get(symbol);
    if (identity) {
      const ok = await storeCompanyAndIdentity(symbol, identity, quote || undefined);
      if (ok) companiesStored++;
    } else {
      console.log(`  ⚠ Skipping ${symbol}: no NSE identity available`);
    }
  }
  console.log(`  → Stored ${companiesStored} companies with identifiers`);

  // Step 4: Fetch Yahoo candles (30 days of daily data)
  console.log("\n🕯️ Step 4: Fetching Yahoo candles (30 days, 1d timeframe)...");
  let totalCandles = 0;
  for (const symbol of TEST_SYMBOLS) {
    const count = await fetchYahooCandles(symbol);
    totalCandles += count;
    console.log(`  ✓ ${symbol}: ${count} candles`);
  }

  // Step 5: Fetch Yahoo quoteSummary fundamentals (may return null for 401/429)
  console.log("\n📋 Step 5: Fetching Yahoo fundamentals...");
  let fundamentalsFetched = 0;
  let nseFundamentalsFetched = 0;
  for (const symbol of TEST_SYMBOLS) {
    const success = await fetchFundamentals(symbol);
    if (success) fundamentalsFetched++;
  }
  console.log(`  → Yahoo fundamentals synced: ${fundamentalsFetched}/${TEST_SYMBOLS.length} symbols`);

  // Record final counts
  console.log("\n📊 Counting rows AFTER ingestion...");
  const afterCounts = await countRows();
  printCounts("Row count changes:", beforeCounts, afterCounts);

  // Repeat the exact writes once. Keys come from the source timestamps and
  // reporting periods, so a safe upsert must not increase any row count.
  console.log("\nVerifying idempotent rerun...");
  for (const symbol of TEST_SYMBOLS) {
    const identity = nseIdentities.get(symbol);
    if (identity) await storeCompanyAndIdentity(symbol, identity, quotes.get(symbol));
    await fetchYahooCandles(symbol);
    await fetchFundamentals(symbol);
  }
  const rerunCounts = await countRows();
  const duplicateTables = Object.keys(afterCounts).filter(
    (table) => rerunCounts[table as keyof RowCounts] !== afterCounts[table as keyof RowCounts]
  );
  if (duplicateTables.length > 0) {
    throw new Error(`Idempotency check failed; row counts changed in: ${duplicateTables.join(", ")}`);
  }
  console.log("  Row counts unchanged on the second pass");

  // Summary
  console.log("\n" + "=".repeat(60));
  console.log("SMOKE TEST SUMMARY");
  console.log("=".repeat(60));
  console.log(`\n1. Is Supabase connected?`);
  console.log(`   ${dbUrl ? "✓ YES - SUPABASE_DB_URL is configured" : "✗ NO - SUPABASE_DB_URL not set"}`);

  console.log(`\n2. Can backend write to Supabase?`);
  const wroteData = fundamentalsFetched > 0 || afterCounts.companies > beforeCounts.companies ||
                   afterCounts.candles > beforeCounts.candles ||
                   afterCounts.quote_snapshots > beforeCounts.quote_snapshots;
  console.log(`   ${wroteData ? "✓ YES - Upserts completed successfully" : "⚠ CHECK - Verify row counts above"}`);

  console.log(`\n3. Row count changes:`);
  console.log(`   companies: ${beforeCounts.companies} → ${afterCounts.companies} (Δ ${afterCounts.companies - beforeCounts.companies})`);
  console.log(`   company_identifiers: ${beforeCounts.company_identifiers} → ${afterCounts.company_identifiers} (Δ ${afterCounts.company_identifiers - beforeCounts.company_identifiers})`);
  console.log(`   quote_snapshots: ${beforeCounts.quote_snapshots} → ${afterCounts.quote_snapshots} (Δ ${afterCounts.quote_snapshots - beforeCounts.quote_snapshots})`);
  console.log(`   candles: ${beforeCounts.candles} → ${afterCounts.candles} (Δ ${afterCounts.candles - beforeCounts.candles})`);
  console.log(`   fundamentals: ${beforeCounts.fundamentals} → ${afterCounts.fundamentals} (Δ ${afterCounts.fundamentals - beforeCounts.fundamentals})`);
  console.log(`   financial_statements: ${beforeCounts.financial_statements} → ${afterCounts.financial_statements} (Δ ${afterCounts.financial_statements - beforeCounts.financial_statements})`);
  console.log(`   market_cap_classifications: ${beforeCounts.market_cap_classifications} → ${afterCounts.market_cap_classifications} (Δ ${afterCounts.market_cap_classifications - beforeCounts.market_cap_classifications})`);

  console.log(`\n4. Tables with new data:`);
  const tablesWithData = [
    { name: "companies", before: beforeCounts.companies, after: afterCounts.companies },
    { name: "company_identifiers", before: beforeCounts.company_identifiers, after: afterCounts.company_identifiers },
    { name: "quote_snapshots", before: beforeCounts.quote_snapshots, after: afterCounts.quote_snapshots },
    { name: "candles", before: beforeCounts.candles, after: afterCounts.candles },
    { name: "fundamentals", before: beforeCounts.fundamentals, after: afterCounts.fundamentals },
    { name: "financial_statements", before: beforeCounts.financial_statements, after: afterCounts.financial_statements },
    { name: "market_cap_classifications", before: beforeCounts.market_cap_classifications, after: afterCounts.market_cap_classifications },
  ].filter(t => t.after > t.before);

  if (tablesWithData.length === 0) {
    console.log(`   (none - no rows added)`);
  } else {
    tablesWithData.forEach(t => console.log(`   ✓ ${t.name}: +${t.after - t.before} rows`));
  }

  console.log(`\n5. Tables still empty:`);
  const emptyTables = [
    { name: "companies", count: afterCounts.companies },
    { name: "company_identifiers", count: afterCounts.company_identifiers },
    { name: "quote_snapshots", count: afterCounts.quote_snapshots },
    { name: "candles", count: afterCounts.candles },
    { name: "fundamentals", count: afterCounts.fundamentals },
    { name: "financial_statements", count: afterCounts.financial_statements },
    { name: "market_cap_classifications", count: afterCounts.market_cap_classifications },
  ].filter(t => t.count === 0);

  if (emptyTables.length === 0) {
    console.log(`   (none - all tables have data)`);
  } else {
    emptyTables.forEach(t => console.log(`   ⚠ ${t.name}: 0 rows`));
    if (fundamentalsFetched === 0) {
      console.log(`\n   Yahoo fundamentals were unavailable (401/429/null); no values were fabricated.`);
    }
    if (emptyTables.some((table) => table.name === "financial_statements")) {
      console.log(`   Financial statements remain empty because no verified Yahoo statement payload was available.`);
    }
    if (emptyTables.some((table) => table.name === "market_cap_classifications")) {
      console.log(`   Market-cap classifications are refreshed by the daily processor, not this bounded smoke test.`);
    }
  }

  console.log(`\n6. Commands:`);
  console.log(`   Bounded verification: bun run smoke:screener-v4`);
  console.log(`   Scheduled ingestion: bun run server/orchestrator.ts`);
  console.log(`   The orchestrator runs the configured universe after market close; this smoke script is not a full backfill.`);

  console.log(`\n7. Idempotency:`);
  console.log(`   Verified: row counts were unchanged on the second pass.`);

  console.log("\n" + "=".repeat(60));
  console.log(`Completed at: ${new Date().toISOString()}`);
  console.log("=".repeat(60));
}

main()
  .catch((err) => {
    console.error("\nFATAL ERROR:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closeRedis();
    await closeDb();
  });
