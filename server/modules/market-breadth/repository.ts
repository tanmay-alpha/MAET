import { db } from "../../data/drizzle/client";
import { companies, quoteSnapshots, fundamentals } from "../../db/schema";
import { eq, desc, isNotNull } from "drizzle-orm";

export async function fetchMarketQuotesWithFundamentals(universe = "ALL_NSE") {
  const companyRows = await db
    .select({
      id: companies.id,
      symbol: companies.symbol,
      name: companies.name,
      sector: companies.sector,
      marketCap: companies.marketCap,
    })
    .from(companies)
    .limit(500);

  const results = [];
  for (const c of companyRows) {
    const [quote] = await db
      .select()
      .from(quoteSnapshots)
      .where(eq(quoteSnapshots.companyId, c.id))
      .orderBy(desc(quoteSnapshots.asOf))
      .limit(1);

    const [fund] = await db
      .select()
      .from(fundamentals)
      .where(eq(fundamentals.companyId, c.id))
      .orderBy(desc(fundamentals.periodDate))
      .limit(1);

    results.push({
      symbol: c.symbol,
      name: c.name,
      sector: c.sector ?? "Other",
      marketCap: c.marketCap ? Number(c.marketCap) : 1000000000,
      price: quote ? Number(quote.price) : 100,
      changePct: quote?.changePct ? Number(quote.changePct) : 0,
      sma20: undefined as number | undefined,
      sma50: undefined as number | undefined,
      sma200: undefined as number | undefined,
      high20d: fund?.fiftyTwoWeekHigh ? Number(fund.fiftyTwoWeekHigh) : undefined,
      low20d: fund?.fiftyTwoWeekLow ? Number(fund.fiftyTwoWeekLow) : undefined,
      asOf: quote?.asOf ? quote.asOf.toISOString() : new Date().toISOString(),
      source: quote?.source ?? "database",
    });
  }

  return results;
}
