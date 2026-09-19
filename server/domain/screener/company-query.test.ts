import { describe, expect, it } from "bun:test";
import { matchesCompanyScreenerRow, parseCompanyScreenerParams, percentInRange } from "./company-query";

describe("company screener query parser", () => {
  it("accepts full-universe search, pagination, filters, buckets and safe sorting", () => {
    const input = parseCompanyScreenerParams(new URLSearchParams({
      q: "INE002A01018",
      page: "2",
      limit: "50",
      pe_max: "25",
      bucket_in: "large,mid",
      sortBy: "market_cap",
      sortDir: "desc",
    }));
    expect(input.q).toBe("INE002A01018");
    expect(input.page).toBe(2);
    expect(input.numbers.pe_max).toBe(25);
    expect(input.buckets).toEqual(["large", "mid"]);
    expect(input.sortDir).toBe("desc");
  });

  it("rejects untrusted sort columns", () => {
    expect(() => parseCompanyScreenerParams(new URLSearchParams({ sortBy: "drop table" }))).toThrow("Unsupported sortBy");
  });

  it("treats user-entered percentage filters as percentages and sector names case-insensitively", () => {
    const input = parseCompanyScreenerParams(new URLSearchParams({
      roe_min: "15",
      dividend_yield_min: "1",
      sector_in: "technology",
    }));
    expect(matchesCompanyScreenerRow({
      symbol: "INFY", name: "Infosys", exchange: "NSE", series: "EQ", isin: "INE009A01021",
      marketCapBucket: "large", roe: 0.18, dividendYield: 0.025, sector: "Technology", source: "database",
    }, input)).toBeTrue();
  });
});

describe("percentInRange ratio boundary evaluation", () => {
  it("evaluates 0% correctly", () => {
    expect(percentInRange(0, 0, 10)).toBeTrue();
    expect(percentInRange(0, -5, 5)).toBeTrue();
    expect(percentInRange(0, 1, 10)).toBeFalse();
  });

  it("evaluates negative percentages correctly", () => {
    // -15% stored as -0.15
    expect(percentInRange(-0.15, -20, -10)).toBeTrue();
    expect(percentInRange(-0.15, -10, 0)).toBeFalse();
    expect(percentInRange(-0.15, -30, -20)).toBeFalse();
  });

  it("evaluates sub-1% percentages without precision confusion", () => {
    // 0.5% stored as 0.005
    expect(percentInRange(0.005, 0.2, 0.8)).toBeTrue();
    expect(percentInRange(0.005, 0.6, 1.0)).toBeFalse();
  });

  it("evaluates standard 20% ratios", () => {
    // 20% stored as 0.20
    expect(percentInRange(0.20, 15, 25)).toBeTrue();
    expect(percentInRange(0.20, 25, 35)).toBeFalse();
  });

  it("evaluates 100% ratios", () => {
    // 100% stored as 1.00
    expect(percentInRange(1.0, 90, 110)).toBeTrue();
    expect(percentInRange(1.0, 100, 100)).toBeTrue();
  });

  it("evaluates high-growth ratios exceeding 100% without heuristic magnitude bugs", () => {
    // 120% stored as 1.20, previously failed because 1.2 > 1 so bound was NOT divided by 100
    expect(percentInRange(1.20, 15, 150)).toBeTrue();
    expect(percentInRange(1.20, 100, 200)).toBeTrue();
    expect(percentInRange(1.20, 130, 200)).toBeFalse();
  });

  it("evaluates severe negative ratios beyond -100%", () => {
    // -120% stored as -1.20
    expect(percentInRange(-1.20, -150, -100)).toBeTrue();
    expect(percentInRange(-1.20, -100, 0)).toBeFalse();
  });

  it("handles missing/undefined/NaN values safely", () => {
    expect(percentInRange(undefined, 10, 20)).toBeFalse();
    expect(percentInRange(NaN, 10, 20)).toBeFalse();
    expect(percentInRange(0.15, undefined, undefined)).toBeTrue();
  });
});

describe("matchesCompanyScreenerRow with technical and breakout filters", () => {
  const baseRow = {
    symbol: "TCS",
    name: "Tata Consultancy Services",
    exchange: "NSE" as const,
    series: "EQ" as const,
    isin: "INE467B01029",
    marketCapBucket: "large" as const,
    source: "database" as const,
    price: 3500,
    fiftyTwoWeekHigh: 3600,
    fiftyTwoWeekLow: 3000,
    sma50: 3400,
    sma200: 3200,
    rsi14: 55,
    priceAboveSma200: true,
    priceAboveSma50: true,
  };

  it("filters 52-week high breakouts strictly", () => {
    const breakoutParams = parseCompanyScreenerParams(new URLSearchParams({ high_breakout: "true" }));
    // When price (3500) < fiftyTwoWeekHigh (3600) -> false
    expect(matchesCompanyScreenerRow(baseRow, breakoutParams)).toBeFalse();

    // When price (3650) >= fiftyTwoWeekHigh (3600) -> true
    expect(matchesCompanyScreenerRow({ ...baseRow, price: 3650 }, breakoutParams)).toBeTrue();

    // When price is missing -> false
    expect(matchesCompanyScreenerRow({ ...baseRow, price: undefined }, breakoutParams)).toBeFalse();
  });

  it("filters near 52-week low strictly (within 5% of low)", () => {
    const nearLowParams = parseCompanyScreenerParams(new URLSearchParams({ low_near: "true" }));
    // Low is 3000, threshold is 3000 * 1.05 = 3150.
    // Price 3500 > 3150 -> false
    expect(matchesCompanyScreenerRow(baseRow, nearLowParams)).toBeFalse();

    // Price 3100 <= 3150 -> true
    expect(matchesCompanyScreenerRow({ ...baseRow, price: 3100 }, nearLowParams)).toBeTrue();
  });

  it("filters technical conditions: goldenCross, rsiOversold, and rsiOverbought", () => {
    const gcParams = parseCompanyScreenerParams(new URLSearchParams({ golden_cross: "true" }));
    // sma50 (3400) > sma200 (3200) -> true
    expect(matchesCompanyScreenerRow(baseRow, gcParams)).toBeTrue();
    // Death cross: sma50 (3100) < sma200 (3200) -> false
    expect(matchesCompanyScreenerRow({ ...baseRow, sma50: 3100 }, gcParams)).toBeFalse();

    const oversoldParams = parseCompanyScreenerParams(new URLSearchParams({ rsi_oversold: "true" }));
    expect(matchesCompanyScreenerRow(baseRow, oversoldParams)).toBeFalse();
    expect(matchesCompanyScreenerRow({ ...baseRow, rsi14: 25 }, oversoldParams)).toBeTrue();

    const overboughtParams = parseCompanyScreenerParams(new URLSearchParams({ rsi_overbought: "true" }));
    expect(matchesCompanyScreenerRow(baseRow, overboughtParams)).toBeFalse();
    expect(matchesCompanyScreenerRow({ ...baseRow, rsi14: 75 }, overboughtParams)).toBeTrue();
  });
});

