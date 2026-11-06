import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { buildQuotesPayload, loadQuotes } from "../../domain/market/quote-service";
import { MARKET_SYMBOL_PATTERN, MAX_SYMBOLS_PER_REQUEST } from "../../domain/market/symbol";
import { tryAuth } from "../trpc/auth";

const DEFAULT_SYMBOLS = [
  "RELIANCE",
  "TCS",
  "HDFCBANK",
  "INFY",
  "ICICIBANK",
  "BHARTIARTL",
  "ITC",
  "LT",
  "SBIN",
  "AXISBANK",
  "MARUTI",
  "HINDUNILVR",
];

function parseSymbols(value: unknown): string[] {
  const symbols = String(value ?? DEFAULT_SYMBOLS.join(","))
    .split(",")
    .map((symbol) => symbol.trim().toUpperCase())
    .filter(Boolean);
  if (symbols.length === 0 || symbols.length > MAX_SYMBOLS_PER_REQUEST) {
    throw createError({ statusCode: 400, statusMessage: `Request between 1 and ${MAX_SYMBOLS_PER_REQUEST} symbols` });
  }
  if (symbols.some((symbol) => !MARKET_SYMBOL_PATTERN.test(symbol))) {
    throw createError({ statusCode: 400, statusMessage: "Invalid symbol" });
  }
  return symbols;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const symbols = parseSymbols(query.symbols);
  // refresh=1 skips the quote cache and spends broker/Yahoo quota, so only
  // signed-in callers get it; anonymous callers are served from cache.
  const force = query.refresh === "1" && (await tryAuth(event)) !== null;
  const result = await loadQuotes(symbols, force);

  setResponseHeader(event, "cache-control", "public, max-age=5, s-maxage=10, stale-while-revalidate=30");
  return buildQuotesPayload(result);
});
