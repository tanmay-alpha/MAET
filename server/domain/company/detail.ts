import { and, desc, eq } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import { candles, companies, financialStatements, fundamentals, quoteSnapshots } from "../../db/schema";
import { getCandles } from "../../data/sources/yahoo";
import { getNseCompanyMaster } from "../../data/sources/nse-company-master";
import { loadQuote } from "../market/quote-service";
import { resolveMarketSymbol } from "../market/symbol";

function numeric(value: string | number | null | undefined): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function statementRow(row: typeof financialStatements.$inferSelect) {
  return {
    id: row.id,
    periodDate: row.periodDate.toISOString(),
    periodType: row.periodType,
    statementType: row.statementType,
    fiscalYear: row.fiscalYear,
    currency: row.currency,
    revenue: numeric(row.revenue),
    costOfRevenue: numeric(row.costOfRevenue),
    operatingIncome: numeric(row.operatingIncome),
    ebitda: numeric(row.ebitda),
    ebit: numeric(row.ebit),
    interestExpense: numeric(row.interestExpense),
    taxExpense: numeric(row.taxExpense),
    netIncome: numeric(row.netIncome),
    totalAssets: numeric(row.totalAssets),
    currentAssets: numeric(row.currentAssets),
    inventory: numeric(row.inventory),
    cashAndEquivalents: numeric(row.cashAndEquivalents),
    totalLiabilities: numeric(row.totalLiabilities),
    currentLiabilities: numeric(row.currentLiabilities),
    totalDebt: numeric(row.totalDebt),
    shareholdersEquity: numeric(row.shareholdersEquity),
    operatingCashFlow: numeric(row.operatingCashFlow),
    capitalExpenditure: numeric(row.capitalExpenditure),
    dividendsPaid: numeric(row.dividendsPaid),
    sharesOutstanding: numeric(row.sharesOutstanding),
    source: row.source,
    asOf: row.asOf.toISOString(),
  };
}

async function databaseDetail(symbol: string) {
  const [company] = await db.select().from(companies).where(eq(companies.symbol, symbol)).limit(1);
  if (!company) return undefined;
  const [quoteRows, fundamentalRows, statements, storedCandles] = await Promise.all([
    db.select().from(quoteSnapshots).where(eq(quoteSnapshots.companyId, company.id)).orderBy(desc(quoteSnapshots.asOf)).limit(1),
    db.select().from(fundamentals).where(eq(fundamentals.companyId, company.id)).orderBy(desc(fundamentals.periodDate)).limit(20),
    db.select().from(financialStatements).where(eq(financialStatements.companyId, company.id)).orderBy(desc(financialStatements.periodDate)).limit(40),
    db.select().from(candles).where(and(eq(candles.symbol, symbol), eq(candles.timeframe, "1d"))).orderBy(desc(candles.ts)).limit(370),
  ]);
  const quote = quoteRows[0];
  const fund = fundamentalRows.find((row) => row.periodType !== "market") ?? fundamentalRows[0];
  const marketMetrics = fundamentalRows.find((row) => row.periodType === "market");
  return {
    company,
    quote,
    fund,
    marketMetrics,
    statements: statements.map(statementRow),
    candles: storedCandles.reverse().map((row) => ({
      symbol: row.symbol,
      tf: row.timeframe,
      ts: row.ts.toISOString(),
      open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: row.volume,
    })),
  };
}

export async function getCompanyDetail(symbolInput: string) {
  const symbol = symbolInput.trim().toUpperCase();
  if (!/^[A-Z0-9&.-]+$/u.test(symbol)) throw new Error("Invalid symbol");

  let stored: Awaited<ReturnType<typeof databaseDetail>>;
  try {
    stored = await databaseDetail(symbol);
  } catch {
    stored = undefined;
  }

  let master = stored?.company;
  if (!master) {
    const companyMaster = await getNseCompanyMaster();
    const fallback = companyMaster.find((company) => company.symbol === symbol);
    if (!fallback) throw new Error("Company not found");
    master = {
      id: fallback.symbol,
      symbol: fallback.symbol,
      name: fallback.name,
      exchange: fallback.exchange,
      series: fallback.series,
      isin: fallback.isin || null,
      listingDate: fallback.listingDate ? new Date(`${fallback.listingDate}T00:00:00Z`) : null,
      marketLot: fallback.marketLot ?? null,
      sector: null, industry: null, bseCode: null, yahooSymbol: `${fallback.symbol}.NS`,
      exchangePrimary: "NSE", marketCapBucket: "unknown", marketCap: null, peRatio: null, pbRatio: null,
      roe: null, dividendYield: null, eps: null, debtToEquity: null, faceValue: fallback.faceValue?.toString() ?? null,
      isActive: true, dataSource: "nse", lastMasterUpdate: null, lastFundamentalsUpdate: null,
      createdAt: null, updatedAt: null,
    };
  }

  let quote = stored?.quote ? {
    price: Number(stored.quote.price),
    changePct: numeric(stored.quote.changePct),
    volume: stored.quote.volume ?? undefined,
    marketCap: numeric(stored.quote.marketCap),
    asOf: stored.quote.asOf.toISOString(),
    source: stored.quote.source,
  } : undefined;
  if (!quote) {
    try {
      const live = await loadQuote(symbol);
      quote = {
        price: live.price, changePct: live.changePct, volume: live.volume,
        marketCap: numeric(master.marketCap), asOf: live.ts, source: live.source,
      };
      try {
        await db.insert(quoteSnapshots).values({
          companyId: master.id, price: String(live.price), changePct: live.changePct?.toString(),
          volume: live.volume, marketCap: master.marketCap, asOf: new Date(live.ts), source: live.source,
        }).onConflictDoNothing();
      } catch {
        // The public endpoint remains available when the optional database is offline.
      }
    } catch {
      // Quote availability is described explicitly below.
    }
  }

  let history = stored?.candles ?? [];
  if (history.length === 0) {
    try {
      const resolved = resolveMarketSymbol(symbol);
      const to = new Date();
      const from = new Date(to.getTime() - 370 * 86_400_000);
      history = await getCandles(resolved.ticker, from, to, "1d");
    } catch {
      history = [];
    }
  }

  const fund = stored?.fund;
  const marketMetrics = stored?.marketMetrics;
  const fundamentalsResult = fund ? {
    asOf: fund.periodDate.toISOString(), source: fund.source, stale: fund.isStale,
    marketCap: numeric(fund.marketCap ?? master.marketCap), trailingPe: numeric(fund.peRatio ?? master.peRatio),
    forwardPe: numeric(fund.forwardPe), pb: numeric(fund.pbRatio ?? master.pbRatio), epsTtm: numeric(fund.eps ?? master.eps),
    bookValuePerShare: numeric(fund.bookValuePerShare), dividendYield: numeric(fund.dividendYield ?? master.dividendYield),
    roe: numeric(fund.roe ?? master.roe), roce: numeric(fund.roce), roa: numeric(fund.returnOnAssets),
    debtToEquity: numeric(fund.debtToEquity ?? master.debtToEquity), currentRatio: numeric(fund.currentRatio),
    salesGrowth: numeric(fund.revenueGrowth), profitGrowth: numeric(fund.netIncomeGrowth),
    operatingMargin: numeric(fund.operatingMargin), netMargin: numeric(fund.netMargin),
    fiftyTwoWeekHigh: numeric(marketMetrics?.fiftyTwoWeekHigh ?? fund.fiftyTwoWeekHigh),
    fiftyTwoWeekLow: numeric(marketMetrics?.fiftyTwoWeekLow ?? fund.fiftyTwoWeekLow),
    average20DayVolume: marketMetrics?.average20DayVolume ?? fund.average20DayVolume ?? undefined,
    relVolume: numeric(marketMetrics?.relativeVolume ?? fund.relativeVolume),
  } : undefined;
  const statements = stored?.statements ?? [];
  const has = (value: unknown) => value !== undefined && value !== null;

  return {
    generatedAt: new Date().toISOString(),
    master: {
      symbol: master.symbol, name: master.name, exchange: master.exchange, series: master.series,
      isin: master.isin ?? "", bseCode: master.bseCode ?? undefined, yahooSymbol: master.yahooSymbol ?? `${symbol}.NS`,
      sector: master.sector ?? undefined, industry: master.industry ?? undefined,
      marketCapBucket: master.marketCapBucket ?? "unknown", listingDate: master.listingDate?.toISOString(),
    },
    quote,
    fundamentals: fundamentalsResult,
    statements: {
      annual: statements.filter((row) => row.periodType === "annual"),
      quarterly: statements.filter((row) => row.periodType === "quarterly"),
    },
    candles: history,
    availability: {
      quote: { available: has(quote?.price), source: quote?.source, reason: "No persisted or reachable quote source" },
      fundamentals: { available: Boolean(fundamentalsResult), source: fundamentalsResult?.source, reason: "No verified stored fundamentals snapshot" },
      balanceSheet: { available: statements.some((row) => row.statementType === "balance_sheet" || has(row.totalAssets)), source: statements[0]?.source, reason: "Balance sheet unavailable from the verified source for this symbol" },
      incomeStatement: { available: statements.some((row) => row.statementType === "income_statement" || has(row.revenue)), source: statements[0]?.source, reason: "Profit & loss statement unavailable from the verified source for this symbol" },
      cashFlow: { available: statements.some((row) => row.statementType === "cash_flow" || has(row.operatingCashFlow)), source: statements[0]?.source, reason: "Cash flow statement unavailable from the verified source for this symbol" },
      history: { available: history.length > 0, source: stored?.candles.length ? "database" : "Yahoo Finance", reason: "Historical candles are unavailable" },
    },
  };
}
