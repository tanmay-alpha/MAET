import { createError, defineEventHandler, getQuery, setResponseHeader } from "h3";
import type { Candle } from "@shared/types";
import { getCandles } from "../../data/sources/yahoo";
import { resolveMarketSymbol } from "../../domain/market/symbol";

const TIMEFRAMES: Candle["tf"][] = ["1m", "5m", "15m", "1h", "1d", "1wk"];
const RANGE_MS: Record<string, number> = {
  "1d": 24 * 60 * 60 * 1000,
  "5d": 5 * 24 * 60 * 60 * 1000,
  "1mo": 30 * 24 * 60 * 60 * 1000,
  "3mo": 90 * 24 * 60 * 60 * 1000,
  "1y": 365 * 24 * 60 * 60 * 1000,
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

  const range = tf === "1m" && requestedRange !== "1d" && requestedRange !== "5d"
    ? "5d"
    : requestedRange;
  const to = new Date();
  const from = new Date(to.getTime() - RANGE_MS[range]);
  const resolved = resolveMarketSymbol(symbol);
  const candles = (await getCandles(resolved.ticker, from, to, tf)).map((candle) => ({
    ...candle,
    symbol: resolved.symbol,
  }));

  setResponseHeader(event, "cache-control", "public, max-age=15, s-maxage=30, stale-while-revalidate=60");
  return {
    symbol: resolved.symbol,
    timeframe: tf,
    range,
    source: "yahoo",
    delayed: true,
    asOf: new Date().toISOString(),
    candles,
  };
});
