import { createRouter, protectedProcedure } from "../core";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { db } from "../../../data/drizzle/client";
import { companies, fundamentals, financialStatements, candles } from "../../../db/schema";
import { eq, desc, and } from "drizzle-orm";
import { calculateAllIndicators } from "../../../domain/technical/indicators-extended";
import type { Candle } from "@shared/types";

// Fallback helper to fetch candles from Yahoo Finance
async function fetchYahooCandles(symbol: string): Promise<Candle[]> {
  try {
    const nsSymbol = symbol.toUpperCase().endsWith(".NS") ? symbol.toUpperCase() : `${symbol.toUpperCase()}.NS`;
    const response = await fetch(
      `https://query1.finance.yahoo.com/v8/finance/chart/${nsSymbol}?interval=1d&range=1y`,
      {
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; MAET/1.0)',
        },
      }
    );

    if (!response.ok) {
      throw new Error(`Yahoo Finance error: ${response.status}`);
    }

    const data = await response.json();
    const result = data.chart?.result?.[0];
    if (!result) return [];

    const timestamps = result.timestamp || [];
    const indicators = result.indicators?.quote?.[0] || {};
    const adjClose = result.indicators?.adjclose?.[0]?.adjclose || [];

    const fetchedCandles: Candle[] = [];

    for (let i = 0; i < timestamps.length; i++) {
      const openVal = indicators.open?.[i];
      const highVal = indicators.high?.[i];
      const lowVal = indicators.low?.[i];
      const closeVal = adjClose[i] || indicators.close?.[i];
      const volVal = indicators.volume?.[i];

      if (
        openVal === null || openVal === undefined ||
        highVal === null || highVal === undefined ||
        lowVal === null || lowVal === undefined ||
        closeVal === null || closeVal === undefined
      ) {
        continue;
      }

      fetchedCandles.push({
        symbol: symbol.toUpperCase(),
        timeframe: "1d",
        ts: new Date(timestamps[i] * 1000).toISOString(),
        open: openVal,
        high: highVal,
        low: lowVal,
        close: closeVal,
        volume: volVal || 0,
        source: "yahoo",
      });
    }

    // Cache the candles to database asynchronously
    if (fetchedCandles.length > 0) {
      db.insert(candles)
        .values(
          fetchedCandles.map((c) => ({
            symbol: c.symbol,
            timeframe: c.timeframe,
            ts: new Date(c.ts),
            open: c.open.toString(),
            high: c.high.toString(),
            low: c.low.toString(),
            close: c.close.toString(),
            volume: Number(c.volume),
            source: c.source,
          }))
        )
        .onConflictDoNothing()
        .catch((err) => console.error("Failed to cache candles in DB:", err));
    }

    return fetchedCandles;
  } catch (error) {
    console.error("Error fetching fallback candles from Yahoo Finance:", error);
    return [];
  }
}

export const analysisRouter = createRouter({
  // Get advanced technical analysis containing 100+ indicators
  getTechnicalAnalysis: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();

      // Fetch candles from Supabase database
      const dbCandles = await db
        .select()
        .from(candles)
        .where(
          and(
            eq(candles.symbol, symbol),
            eq(candles.timeframe, "1d")
          )
        )
        .orderBy(desc(candles.ts))
        .limit(260); // Fetch ~1 year of daily trading candles

      let formattedCandles: Candle[] = dbCandles.map((c) => ({
        symbol: c.symbol,
        timeframe: c.timeframe,
        ts: c.ts.toISOString(),
        open: Number(c.open),
        high: Number(c.high),
        low: Number(c.low),
        close: Number(c.close),
        volume: c.volume || 0,
        source: c.source,
      }));

      // Fallback: If not enough local candles, fetch from Yahoo Finance
      if (formattedCandles.length < 50) {
        console.log(`Insufficient candles in DB (${formattedCandles.length}), falling back to Yahoo...`);
        const yCandles = await fetchYahooCandles(symbol);
        if (yCandles.length > 0) {
          formattedCandles = yCandles;
        }
      }

      if (formattedCandles.length === 0) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No candles found for symbol: ${symbol} to perform technical analysis.`,
        });
      }

      // Sort chronological for technical indicators (oldest to newest)
      formattedCandles.sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());

      // Calculate all 100+ indicators
      try {
        const indicators = calculateAllIndicators(formattedCandles);
        return {
          symbol,
          candleCount: formattedCandles.length,
          lastPrice: formattedCandles[formattedCandles.length - 1].close,
          lastUpdated: formattedCandles[formattedCandles.length - 1].ts,
          indicators,
        };
      } catch (err: any) {
        console.error("Technical calculation failure:", err);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to calculate indicators: ${err.message}`,
        });
      }
    }),

  // Get comprehensive fundamental analysis & financials
  getFundamentalAnalysis: protectedProcedure
    .input(z.object({
      symbol: z.string().min(1),
    }))
    .query(async ({ input }) => {
      const symbol = input.symbol.toUpperCase();

      // Retrieve company master profile
      const [company] = await db
        .select()
        .from(companies)
        .where(eq(companies.symbol, symbol))
        .limit(1);

      if (!company) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Company details not found for symbol: ${symbol}`,
        });
      }

      // Fetch fundamentals snapshot
      const [fund] = await db
        .select()
        .from(fundamentals)
        .where(eq(fundamentals.companyId, company.id))
        .orderBy(desc(fundamentals.periodDate))
        .limit(1);

      // Fetch financial statements (income sheet, balance sheet, cash flows)
      const statements = await db
        .select()
        .from(financialStatements)
        .where(eq(financialStatements.companyId, company.id))
        .orderBy(desc(financialStatements.periodDate))
        .limit(8); // Last 8 periods (quarters/years)

      return {
        company: {
          id: company.id,
          symbol: company.symbol,
          name: company.name,
          exchange: company.exchange,
          sector: company.sector,
          industry: company.industry,
          marketCap: company.marketCap,
          peRatio: company.peRatio,
          pbRatio: company.pbRatio,
          roe: company.roe,
          dividendYield: company.dividendYield,
          eps: company.eps,
          debtToEquity: company.debtToEquity,
          faceValue: company.faceValue,
        },
        fundamentalsSnapshot: fund ? {
          peRatio: fund.peRatio,
          pbRatio: fund.pbRatio,
          roe: fund.roe,
          marketCap: fund.marketCap,
          dividendYield: fund.dividendYield,
          eps: fund.eps,
          debtToEquity: fund.debtToEquity,
          grossMargin: fund.grossMargin,
          operatingMargin: fund.operatingMargin,
          ebitdaMargin: fund.ebitdaMargin,
          netMargin: fund.netMargin,
          returnOnAssets: fund.returnOnAssets,
          returnOnInvestedCapital: fund.returnOnInvestedCapital,
          currentRatio: fund.currentRatio,
          quickRatio: fund.quickRatio,
          interestCoverage: fund.interestCoverage,
          freeCashFlow: fund.freeCashFlow,
          freeCashFlowMargin: fund.freeCashFlowMargin,
          revenueGrowth: fund.revenueGrowth,
          netIncomeGrowth: fund.netIncomeGrowth,
          fiftyTwoWeekHigh: fund.fiftyTwoWeekHigh,
          fiftyTwoWeekLow: fund.fiftyTwoWeekLow,
          isStale: fund.isStale,
        } : null,
        financialStatements: statements.map(s => ({
          periodDate: s.periodDate.toISOString(),
          periodType: s.periodType,
          fiscalYear: s.fiscalYear,
          currency: s.currency,
          revenue: s.revenue,
          operatingIncome: s.operatingIncome,
          ebitda: s.ebitda,
          netIncome: s.netIncome,
          totalAssets: s.totalAssets,
          totalLiabilities: s.totalLiabilities,
          totalDebt: s.totalDebt,
          shareholdersEquity: s.shareholdersEquity,
          operatingCashFlow: s.operatingCashFlow,
          capitalExpenditure: s.capitalExpenditure,
          dividendsPaid: s.dividendsPaid,
          sharesOutstanding: s.sharesOutstanding,
          statementType: s.statementType,
        })),
      };
    }),
});
