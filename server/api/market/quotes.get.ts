import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import { loadQuotes } from "../../domain/market/quote-service";

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
  if (symbols.length === 0 || symbols.length > 25) {
    throw createError({ statusCode: 400, statusMessage: "Request between 1 and 25 symbols" });
  }
  if (symbols.some((symbol) => !/^[A-Z0-9&.-]+$/.test(symbol))) {
    throw createError({ statusCode: 400, statusMessage: "Invalid symbol" });
  }
  return symbols;
}

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const symbols = parseSymbols(query.symbols);
  const result = await loadQuotes(symbols, query.refresh === "1");

  setResponseHeader(event, "cache-control", "public, max-age=5, s-maxage=10, stale-while-revalidate=30");
  return {
    asOf: new Date().toISOString(),
    source: "yahoo",
    delayed: true,
    ...result,
  };
});
