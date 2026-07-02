import { createError, defineEventHandler, getRequestURL, setResponseHeader } from "h3";
import { parseCompanyScreenerParams, queryCompanyScreener } from "../../domain/screener/company-query";

export default defineEventHandler(async (event) => {
  try {
    const input = parseCompanyScreenerParams(getRequestURL(event).searchParams);
    const result = await queryCompanyScreener(input);
    setResponseHeader(event, "cache-control", "public, max-age=30, s-maxage=60, stale-while-revalidate=300");
    return result;
  } catch (error) {
    throw createError({
      statusCode: 400,
      statusMessage: error instanceof Error ? error.message : "Invalid screener query",
    });
  }
});
