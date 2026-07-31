import { db } from "../../data/drizzle/client";
import { companies, quoteSnapshots, fundamentals, candles } from "../../db/schema";
import { eq, desc, and, sql, inArray } from "drizzle-orm";

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
  excludedCount: number;
  dataCoverage: number;
}

export async function fetchMarketQuotesWithFundamentals(universe = "ALL_NSE"): Promise<FetchQuotesResult> {
  // Index membership check
  if (universe !== "ALL_NSE") {
    // Check if membership exists for specific Nifty index
    const [indexCheck] = await db
      .select({ count: sql<number>`count(*)` })
      .from(companies)
      .where(sql`metadata->>'indexMembership' LIKE ${`%${universe}%`}`);

    const count = Number(indexCheck?.count ?? 0);
    if (count === 0) {
      return {
        available: false,
        reason: `Verified index membership unavailable for ${universe}`,
        data: [],
        excludedCount: 0,
        dataCoverage: 0,
      };
    }
  }

  // Single-pass CTE joining latest quote and latest fundamentals for each company
  const rows = await db.execute(sql`
    WITH LatestQuotes AS (
      SELECT DISTINCT ON (company_id)
        company_id, price, change_pct, source, as_of
      FROM public.quote_snapshots
      WHERE as_of >= NOW() - INTERVAL '7 days'
      ORDER BY company_id, as_of DESC
    ),
    LatestFundamentals AS (
      SELECT DISTINCT ON (company_id)
        company_id, fifty_two_week_high, fifty_two_week_low
      FROM public.fundamentals
      ORDER BY company_id, period_date DESC
    )
    SELECT
      c.symbol,
      c.name,
      c.sector,
      c.market_cap as "marketCap",
      q.price,
      q.change_pct as "changePct",
      q.source,
      q.as_of as "asOf",
      f.fifty_two_week_high as "high20d",
      f.fifty_two_week_low as "low20d"
    FROM public.companies c
    INNER JOIN LatestQuotes q ON q.company_id = c.id
    LEFT JOIN LatestFundamentals f ON f.company_id = c.id
    LIMIT 500;
  `);

  const rawList = (rows as any).rows ?? rows ?? [];

  // Exclude companies without verified quotes
  const verifiedList: VerifiedQuoteData[] = [];
  let excludedCount = 0;

  // Batch calculate real SMA 20/50/200 from candles
  const symbols = rawList.map((r: any) => r.symbol);
  const candleMap: Record<string, { sma20?: number; sma50?: number; sma200?: number }> = {};

  if (symbols.length > 0) {
    const candleRows = await db
      .select({
        symbol: candles.symbol,
        close: candles.close,
        ts: candles.ts,
      })
      .from(candles)
      .where(and(inArray(candles.symbol, symbols), eq(candles.timeframe, "1d")))
      .orderBy(desc(candles.ts));

    const candleBySymbol: Record<string, number[]> = {};
    for (const row of candleRows) {
      if (!candleBySymbol[row.symbol]) candleBySymbol[row.symbol] = [];
      if (candleBySymbol[row.symbol].length < 200) {
        candleBySymbol[row.symbol].push(Number(row.close));
      }
    }

    for (const [sym, closes] of Object.entries(candleBySymbol)) {
      if (closes.length >= 20) {
        const slice20 = closes.slice(0, 20);
        const sma20 = slice20.reduce((a, b) => a + b, 0) / 20;
        const sma50 = closes.length >= 50 ? closes.slice(0, 50).reduce((a, b) => a + b, 0) / 50 : undefined;
        const sma200 = closes.length >= 200 ? closes.slice(0, 200).reduce((a, b) => a + b, 0) / 200 : undefined;
        candleMap[sym] = { sma20, sma50, sma200 };
      }
    }
  }

  for (const r of rawList) {
    if (r.price === null || r.price === undefined || r.changePct === null || r.changePct === undefined) {
      excludedCount++;
      continue;
    }

    const cData = candleMap[r.symbol];
    verifiedList.push({
      symbol: r.symbol,
      name: r.name,
      sector: r.sector ?? "Other",
      marketCap: r.marketCap ? Number(r.marketCap) : undefined,
      price: Number(r.price),
      changePct: Number(r.changePct),
      sma20: cData?.sma20,
      sma50: cData?.sma50,
      sma200: cData?.sma200,
      high20d: r.high20d ? Number(r.high20d) : undefined,
      low20d: r.low20d ? Number(r.low20d) : undefined,
      asOf: r.asOf ? new Date(r.asOf).toISOString() : new Date().toISOString(),
      source: r.source ?? "verified_quote",
    });
  }

  const total = rawList.length;
  const dataCoverage = total > 0 ? Math.round((verifiedList.length / total) * 100) / 100 : 0;

  return {
    available: true,
    data: verifiedList,
    excludedCount,
    dataCoverage,
  };
}
