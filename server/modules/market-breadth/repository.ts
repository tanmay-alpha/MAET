import { db } from "../../data/drizzle/client";
import { companies, quoteSnapshots, candles } from "../../db/schema";
import { eq, desc, and, ne, inArray } from "drizzle-orm";

export interface VerifiedQuoteData {
  symbol: string;
  name: string;
  sector: string;
  marketCap?: number;
  price: number;
  changePct: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  high20d?: number;
  low20d?: number;
  asOf: string;
  source: string;
}

export interface FetchQuotesResult {
  available: boolean;
  reason?: string;
  data: VerifiedQuoteData[];
  eligibleCompanies: number;
  companiesWithUsableQuote: number;
  quoteCoverage: number;
  totalEligibleMarketCap: number;
  totalUsableMarketCap: number;
  excludedCount: number;
  dataCoverage: number;
  eligible20dSessions: number;
  sma20Eligible: number;
  sma50Eligible: number;
  sma200Eligible: number;
}

export async function fetchMarketQuotesWithFundamentals(universe = "ALL_NSE"): Promise<FetchQuotesResult> {
  const normalizedUniverse = (universe || "ALL_NSE").trim().toUpperCase();

  // Only ALL_NSE is verified and supported
  if (normalizedUniverse !== "ALL_NSE") {
    return {
      available: false,
      reason: `Verified index membership unavailable for ${universe}. Only ALL_NSE is supported.`,
      data: [],
      eligibleCompanies: 0,
      companiesWithUsableQuote: 0,
      quoteCoverage: 0,
      totalEligibleMarketCap: 0,
      totalUsableMarketCap: 0,
      excludedCount: 0,
      dataCoverage: 0,
      eligible20dSessions: 0,
      sma20Eligible: 0,
      sma50Eligible: 0,
      sma200Eligible: 0,
    };
  }

  // 1. Fetch all active NSE companies
  const eligibleCompanyRows = await db
    .select({
      id: companies.id,
      symbol: companies.symbol,
      name: companies.name,
      sector: companies.sector,
      marketCap: companies.marketCap,
    })
    .from(companies)
    .where(
      and(
        eq(companies.exchange, "NSE"),
        ne(companies.isActive, false),
      )
    );

  const eligibleCompanies = eligibleCompanyRows.length;
  if (eligibleCompanies === 0) {
    return {
      available: true,
      data: [],
      eligibleCompanies: 0,
      companiesWithUsableQuote: 0,
      quoteCoverage: 0,
      totalEligibleMarketCap: 0,
      totalUsableMarketCap: 0,
      excludedCount: 0,
      dataCoverage: 0,
      eligible20dSessions: 0,
      sma20Eligible: 0,
      sma50Eligible: 0,
      sma200Eligible: 0,
    };
  }

  const companyIds = eligibleCompanyRows.map((c) => c.id);

  // 2. Fetch latest quote snapshot per company using DISTINCT ON
  const quoteRows = await db
    .selectDistinctOn([quoteSnapshots.companyId])
    .from(quoteSnapshots)
    .where(inArray(quoteSnapshots.companyId, companyIds))
    .orderBy(quoteSnapshots.companyId, desc(quoteSnapshots.asOf));

  const quoteMap = new Map<string, (typeof quoteRows)[number]>();
  for (const q of quoteRows) {
    quoteMap.set(q.companyId, q);
  }

  // 3. Filter for companies with usable quotes
  const usableCompanies: Array<{
    company: (typeof eligibleCompanyRows)[number];
    quote: (typeof quoteRows)[number];
  }> = [];

  let excludedCount = 0;
  let totalEligibleMarketCap = 0;
  let totalUsableMarketCap = 0;

  for (const comp of eligibleCompanyRows) {
    const rawMc = comp.marketCap ? Number(comp.marketCap) : 0;
    if (rawMc > 0) totalEligibleMarketCap += rawMc;

    const q = quoteMap.get(comp.id);
    if (
      q &&
      q.price !== null &&
      q.price !== undefined &&
      !isNaN(Number(q.price)) &&
      q.changePct !== null &&
      q.changePct !== undefined &&
      !isNaN(Number(q.changePct))
    ) {
      usableCompanies.push({ company: comp, quote: q });
      if (rawMc > 0) totalUsableMarketCap += rawMc;
    } else {
      excludedCount++;
    }
  }

  const companiesWithUsableQuote = usableCompanies.length;
  const quoteCoverage = eligibleCompanies > 0
    ? Number((companiesWithUsableQuote / eligibleCompanies).toFixed(4))
    : 0;

  // 4. Batch fetch daily candles for usable symbols to calculate true 20d high/low and SMAs
  const usableSymbols = usableCompanies.map((u) => u.company.symbol);
  const candleRows = usableSymbols.length > 0
    ? await db
        .select({
          symbol: candles.symbol,
          high: candles.high,
          low: candles.low,
          close: candles.close,
          ts: candles.ts,
        })
        .from(candles)
        .where(
          and(
            inArray(candles.symbol, usableSymbols),
            eq(candles.timeframe, "1d")
          )
        )
        .orderBy(desc(candles.ts))
    : [];

  const candlesBySymbol = new Map<string, Array<{ high: number; low: number; close: number }>>();
  for (const c of candleRows) {
    let arr = candlesBySymbol.get(c.symbol);
    if (!arr) {
      arr = [];
      candlesBySymbol.set(c.symbol, arr);
    }
    if (arr.length < 200) {
      arr.push({
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
      });
    }
  }

  let eligible20dSessions = 0;
  let sma20Eligible = 0;
  let sma50Eligible = 0;
  let sma200Eligible = 0;

  const verifiedList: VerifiedQuoteData[] = [];

  for (const { company, quote } of usableCompanies) {
    const symCandles = candlesBySymbol.get(company.symbol) ?? [];
    let high20d: number | undefined;
    let low20d: number | undefined;
    let sma20: number | undefined;
    let sma50: number | undefined;
    let sma200: number | undefined;

    // True trailing 20 daily sessions
    if (symCandles.length >= 20) {
      eligible20dSessions++;
      const first20 = symCandles.slice(0, 20);
      high20d = Math.max(...first20.map((c) => c.high));
      low20d = Math.min(...first20.map((c) => c.low));

      sma20Eligible++;
      sma20 = first20.reduce((sum, c) => sum + c.close, 0) / 20;
    }

    if (symCandles.length >= 50) {
      sma50Eligible++;
      sma50 = symCandles.slice(0, 50).reduce((sum, c) => sum + c.close, 0) / 50;
    }

    if (symCandles.length >= 200) {
      sma200Eligible++;
      sma200 = symCandles.slice(0, 200).reduce((sum, c) => sum + c.close, 0) / 200;
    }

    const mCap = company.marketCap ? Number(company.marketCap) : undefined;

    verifiedList.push({
      symbol: company.symbol,
      name: company.name,
      sector: company.sector ?? "Other",
      marketCap: mCap && !isNaN(mCap) && mCap > 0 ? mCap : undefined,
      price: Number(quote.price),
      changePct: Number(quote.changePct),
      sma20: sma20 !== undefined ? Number(sma20.toFixed(4)) : undefined,
      sma50: sma50 !== undefined ? Number(sma50.toFixed(4)) : undefined,
      sma200: sma200 !== undefined ? Number(sma200.toFixed(4)) : undefined,
      high20d: high20d !== undefined ? Number(high20d.toFixed(4)) : undefined,
      low20d: low20d !== undefined ? Number(low20d.toFixed(4)) : undefined,
      asOf: quote.asOf ? new Date(quote.asOf).toISOString() : new Date().toISOString(),
      source: quote.source ?? "verified_quote",
    });
  }

  const dataCoverage = eligibleCompanies > 0
    ? Number((verifiedList.length / eligibleCompanies).toFixed(4))
    : 0;

  return {
    available: true,
    data: verifiedList,
    eligibleCompanies,
    companiesWithUsableQuote,
    quoteCoverage,
    totalEligibleMarketCap,
    totalUsableMarketCap,
    excludedCount,
    dataCoverage,
    eligible20dSessions,
    sma20Eligible,
    sma50Eligible,
    sma200Eligible,
  };
}
