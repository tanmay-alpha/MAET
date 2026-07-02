import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { getCompanyDetail } from "../../domain/company/detail";

export default defineEventHandler(async (event) => {
  try {
    const symbol = String(getQuery(event).symbol ?? "");
    const result = await getCompanyDetail(symbol);
    setResponseHeader(event, "cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
    return result;
  } catch (error) {
    throw createError({ statusCode: 404, statusMessage: error instanceof Error ? error.message : "Company not found" });
  }
});
