import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { getNseCompanyMaster, searchNseCompanyMaster } from "../../data/sources/nse-company-master";
import { db } from "../../data/drizzle/client";
import { companies } from "../../db/schema";
import { sql } from "drizzle-orm";

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw createError({ statusCode: 400, statusMessage: `Expected an integer between 1 and ${maximum}` });
  }
  return parsed;
}

function mapRow(row: typeof companies.$inferSelect): MarketCompany {
  return {
    symbol: row.symbol,
    name: row.name,
    exchange: row.exchange,
    series: row.series,
    isin: row.isin ?? "",
    listingDate: row.listingDate?.toISOString(),
    paidUpValue: undefined,
    marketLot: row.marketLot ?? undefined,
    faceValue: undefined,
    sector: row.sector ?? undefined,
    industry: row.industry ?? undefined,
    marketCap: row.marketCap ? Number(row.marketCap) : undefined,
    pe: row.peRatio ? Number(row.peRatio) : undefined,
    pb: row.pbRatio ? Number(row.pbRatio) : undefined,
    roe: row.roe ? Number(row.roe) : undefined,
    dividendYield: row.dividendYield ? Number(row.dividendYield) : undefined,
    eps: row.eps ? Number(row.eps) : undefined,
    relVolume: undefined,
    source: "nse",
  };
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = parsePositiveInteger(query.page, 1, 100_000);
  const pageSize = parsePositiveInteger(query.limit, 25, 100);
  const search = String(query.search ?? "").trim().toLocaleLowerCase("en-IN").slice(0, 80);

  // Try DB first — it has the full 2000+ company universe + fundamentals
  try {
    let dbQuery = db.select().from(companies).where(sql`${companies.isActive} = true`);

    if (search) {
      dbQuery = dbQuery.where(
        sql`${companies.symbol} ILIKE ${`%${search}%`} OR ${companies.name} ILIKE ${`%${search}%`}`
      );
    }

    const [rows, [{ count: total }]] = await Promise.all([
      dbQuery.orderBy(companies.symbol).limit(pageSize).offset((page - 1) * pageSize),
      dbQuery.count().from(companies),
    ]);

    setResponseHeader(event, "cache-control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
    return {
      asOf: new Date().toISOString(),
      source: "nse",
      total,
      universeTotal: total,
      page,
      pageSize,
      pageCount: Math.ceil(total / pageSize),
      items: rows.map(mapRow),
    };
  } catch {
    // Fallback to NSE company master
  }

  // Fallback: NSE company master (no DB fundamentals)
  const all = await getNseCompanyMaster(query.refresh === "1");
  const matches = searchNseCompanyMaster(all, search);
  const start = (page - 1) * pageSize;

  setResponseHeader(event, "cache-control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  return {
    asOf: new Date().toISOString(),
    source: "nse",
    total: matches.length,
    universeTotal: all.length,
    page,
    pageSize,
    pageCount: Math.ceil(matches.length / pageSize),
    items: matches.slice(start, start + pageSize).map((c) => ({ ...c, pe: undefined, pb: undefined, roe: undefined, dividendYield: undefined, marketCap: undefined, eps: undefined, source: "nse" as const })),
  };
});
