import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import type { Candle } from "@shared/types";
import { loadMarketCandles } from "../../domain/market/candle-service";

const TIMEFRAMES: Candle["tf"][] = ["1m", "5m", "15m", "1h", "1d", "1wk"];
const RANGE_MS: Record<string, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "5d": 5 * 24 * 60 * 60 * 1000,
  "10d": 10 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "3mo": 90 * 24 * 60 * 60 * 1000,
  "6mo": 180 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
  "2y": 730 * 24 * 60 * 60 * 1000,
  "5y": 1825 * 24 * 60 * 60 * 1000,
  "max": 50 * 365 * 24 * 60 * 60 * 1000, // ~50 years, Yahoo returns max available
};

export default defineEventHandler(async (event) => {
  const query = getQuery(event);
  const symbol = String(query.symbol ?? "RELIANCE").trim().toUpperCase();
  const tf = String(query.tf ?? "5m") as Candle["tf"];
  const requestedRange = String(query.range ?? (tf === "1d" || tf === "1wk" ? "1y" : "5d"));

  if (!/^[A-Z0-9&.-]+$/.test(symbol)) {
    throw createError({ statusCode: 400, statusMessage: "Invalid symbol" });
  }
  if (!TIMEFRAMES.includes(tf)) {
    throw createError({ statusCode: 400, statusMessage: "Unsupported timeframe" });
  }
  if (!(requestedRange in RANGE_MS)) {
    throw createError({ statusCode: 400, statusMessage: "Unsupported range" });
  }

  let range = requestedRange;

  // Handle special cases for timeframes
  if (tf === "1m") {
    if (requestedRange !== "1d" && requestedRange !== "5d") {
      range = "5d";
    }
  }

  // For "max" range, start from a reasonable historical date
  const to = new Date();
  let from: Date;
  if (range === "max") {
    // Start from 1990 for "max" range
    from = new Date("1990-01-01");
  } else {
    from = new Date(to.getTime() - RANGE_MS[range]);
  }
  let result;
  try {
    result = await loadMarketCandles(symbol, tf, from, to);
  } catch {
    throw createError({ statusCode: 503, statusMessage: "Market history temporarily unavailable" });
  }

  setResponseHeader(event, "cache-control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  return {
    symbol,
    timeframe: tf,
    range,
    source: result.source,
    delayed: true,
    asOf: new Date().toISOString(),
    persisted: result.persisted,
    candles: result.candles,
  };
});
