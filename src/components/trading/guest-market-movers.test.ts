import { describe, expect, test } from "bun:test";
import type { MarketQuote } from "@/lib/market-api";
import { marketPhaseLabel, NIFTY50_SYMBOLS, rankNiftyMovers } from "./guest-market-movers";

function quote(symbol: string, changePct?: number): MarketQuote {
  return { symbol, exchange: "NSE", price: 100, ts: "2026-11-06T10:15:00.000Z", source: "angelone", quality: "live", delayed: false, changePct };
}

describe("public market dashboard", () => {
  test("requests exactly the 50 unique NIFTY constituents", () => {
    expect(NIFTY50_SYMBOLS).toHaveLength(50);
    expect(new Set(NIFTY50_SYMBOLS).size).toBe(50);
  });

  test("ranks the top five positive and negative changes, rather than symbol order", () => {
    const quotes = new Map(NIFTY50_SYMBOLS.slice(0, 14).map((symbol, index) => [symbol, quote(symbol, index < 7 ? index + 1 : -(index - 6))]));
    const { gainers, losers } = rankNiftyMovers(quotes);
    expect(gainers.map((item) => item.changePct)).toEqual([7, 6, 5, 4, 3]);
    expect(losers.map((item) => item.changePct)).toEqual([-7, -6, -5, -4, -3]);
    expect(quotes.size).toBe(14);
  });

  test("excludes unavailable, flat, invalid and non-constituent quotes", () => {
    const quotes = new Map([
      ["RELIANCE", quote("RELIANCE", 2)],
      ["TCS", quote("TCS", -1)],
      ["INFY", quote("INFY", 0)],
      ["ITC", quote("ITC")],
      ["HDFCBANK", quote("HDFCBANK", Number.NaN)],
      ["NOTNIFTY", quote("NOTNIFTY", 100)],
    ]);
    const { gainers, losers } = rankNiftyMovers(quotes);
    expect(gainers.map((item) => item.symbol)).toEqual(["RELIANCE"]);
    expect(losers.map((item) => item.symbol)).toEqual(["TCS"]);
    expect(rankNiftyMovers(new Map())).toEqual({ gainers: [], losers: [] });
  });

  test("breaks equal percentage changes deterministically by symbol", () => {
    const { gainers } = rankNiftyMovers(new Map([["TCS", quote("TCS", 2)], ["RELIANCE", quote("RELIANCE", 2)]]));
    expect(gainers.map((item) => item.symbol)).toEqual(["RELIANCE", "TCS"]);
  });

  test.each([
    ["OPEN", "Market open"],
    ["PRE_OPEN", "Market pre-open"],
    ["CLOSED", "Market closed"],
    ["HOLIDAY", "Market closed · holiday"],
    ["AFTER_HOURS", "Market closed · after hours"],
    [undefined, "Market phase unavailable"],
    ["UNKNOWN", "Market phase unavailable"],
  ])("labels phase %s from the API without guessing", (phase, label) => {
    expect(marketPhaseLabel(phase)).toBe(label);
  });
});
