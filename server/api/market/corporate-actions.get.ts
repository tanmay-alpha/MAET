import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { AppError } from "@shared/types";
import { loadCorporateActions } from "../../domain/market/corporate-action-service";
import { isCataloguedMarketSymbol } from "../../domain/market/symbol";
import { isMarketSymbol } from "../../domain/market/symbol-pattern";
import { getLogger } from "../../infra/logger";

export default defineEventHandler(async (event) => {
  const symbol = String(getQuery(event).symbol ?? "").trim().toUpperCase();
  if (!isMarketSymbol(symbol)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid symbol" });
  }
  // Anonymous callers must not make the server look up arbitrary tickers on Yahoo.
  if (!isCataloguedMarketSymbol(symbol)) {
    throw createError({ statusCode: 400, statusMessage: "Unknown symbol" });
  }

  try {
    const payload = await loadCorporateActions(symbol);
    // A stale copy is re-checked soon; a fresh one is good for the server TTL.
    setResponseHeader(
      event,
      "cache-control",
      payload.stale ? "public, max-age=60" : "public, max-age=3600, s-maxage=3600, stale-while-revalidate=86400"
    );
    return payload;
  } catch (error) {
    const reason = error instanceof AppError ? error.code : "INTERNAL";
    getLogger().error(
      { symbol, reason, err: error instanceof Error ? `${error.name}: ${error.message}` : String(error) },
      "corporate actions unavailable from Yahoo"
    );
    throw createError({ statusCode: 503, statusMessage: "Corporate actions temporarily unavailable", data: { reason } });
  }
});
