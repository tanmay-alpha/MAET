/**
 * Scorecard service.
 *
 * Fetches stored data, maps it to the scorecard input shape, and delegates to
 * the pure domain calculation. This layer is the only I/O boundary.
 */

import { calculateStockScorecard, type ScorecardInputs } from "../../domain/analysis/stock-scorecard";
import { db } from "../../data/drizzle/client";
import { companies, fundamentals } from "../../db/schema";
import { eq, desc } from "drizzle-orm";
import { TRPCError } from "@trpc/server";

export async function getStockScorecard(symbol: string) {
  const company = await db.select().from(companies).where(eq(companies.symbol, symbol.toUpperCase())).limit(1);

  if (!company[0]) {
    throw new TRPCError({ code: "NOT_FOUND", message: `Company not found: ${symbol}` });
  }

  const [fund] = await db
    .select()
    .from(fundamentals)
    .where(eq(fundamentals.companyId, company[0].id))
    .orderBy(desc(fundamentals.periodDate))
    .limit(1);

  const inputs: ScorecardInputs = {
    peRatio: fund?.peRatio ? Number(fund.peRatio) : undefined,
    pbRatio: fund?.pbRatio ? Number(fund.pbRatio) : undefined,
    earningsYield: fund?.earningsYield ? Number(fund.earningsYield) : undefined,
    freeCashFlowYield: fund?.freeCashFlowYield ? Number(fund.freeCashFlowYield) : undefined,
    roe: fund?.roe ? Number(fund.roe) : undefined,
    roce: fund?.roce ? Number(fund.roce) : undefined,
    revenueGrowth: fund?.revenueGrowth ? Number(fund.revenueGrowth) : undefined,
    epsGrowth: fund?.epsGrowth ? Number(fund.epsGrowth) : undefined,
    debtToEquity: fund?.debtToEquity ? Number(fund.debtToEquity) : undefined,
    interestCoverage: fund?.interestCoverage ? Number(fund.interestCoverage) : undefined,
    currentRatio: fund?.currentRatio ? Number(fund.currentRatio) : undefined,
    netMargin: fund?.netMargin ? Number(fund.netMargin) : undefined,
    grossMargin: fund?.grossMargin ? Number(fund.grossMargin) : undefined,
    freeCashFlow: fund?.freeCashFlow ? Number(fund.freeCashFlow) : undefined,
    marketCap: company[0].marketCap ? Number(company[0].marketCap) : undefined,
    sector: company[0].sector ?? undefined,
  };

  const result = calculateStockScorecard(inputs);
  return {
    symbol: company[0].symbol,
    name: company[0].name,
    ...result,
  };
}