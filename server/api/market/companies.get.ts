import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { getNseCompanyMaster, searchNseCompanyMaster } from "../../data/sources/nse-company-master";

function parsePositiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw createError({ statusCode: 400, statusMessage: `Expected an integer between 1 and ${maximum}` });
  }
  return parsed;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const page = parsePositiveInteger(query.page, 1, 100_000);
  const pageSize = parsePositiveInteger(query.limit, 25, 100);
  const search = String(query.search ?? "").trim().toLocaleLowerCase("en-IN").slice(0, 80);
  const companies = await getNseCompanyMaster(query.refresh === "1");
  const matches = searchNseCompanyMaster(companies, search);
  const start = (page - 1) * pageSize;

  setResponseHeader(event, "cache-control", "public, max-age=300, s-maxage=3600, stale-while-revalidate=86400");
  return {
    asOf: new Date().toISOString(),
    source: "nse",
    total: matches.length,
    universeTotal: companies.length,
    page,
    pageSize,
    pageCount: Math.ceil(matches.length / pageSize),
    items: matches.slice(start, start + pageSize),
  };
});
