import { describe, expect, it } from "bun:test";
import {
  matchesCompanyScreenerRow,
  parseCompanyScreenerParams,
  percentInRange,
  screenCompanyScreenerRows,
  type CompanyScreenerRow,
} from "./company-query";

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

describe("screenCompanyScreenerRows missing-data accounting", () => {
  const row = (symbol: string, fields: Partial<CompanyScreenerRow>): CompanyScreenerRow => ({
    symbol, name: symbol, exchange: "NSE", series: "EQ", isin: `IN${symbol}`, marketCapBucket: "large", source: "database", ...fields,
  });
  const rows = [
    row("CHEAP", { pe: 12, roe: 0.2, sector: "Energy" }),
    row("PRICEY", { pe: 45, roe: 0.25, sector: "Energy" }),
    row("NOPE", { roe: 0.3, sector: "Energy" }),
    row("NOROE", { pe: 8, sector: "Energy" }),
    row("NEITHER", { sector: "Energy" }),
    row("NOPE_LOWROE", { roe: 0.05, sector: "Energy" }),
    row("ZEROPE", { pe: 0, roe: 0.2, sector: "Energy" }),
  ];

  it("never treats a missing metric as 0 and counts rows left out only for missing data", () => {
    const input = parseCompanyScreenerParams(new URLSearchParams({ pe_max: "20", roe_min: "15" }));
    const { matches, excludedForMissingData } = screenCompanyScreenerRows(rows, input);
    // A real 0 is a value and matches; a missing P/E does not.
    expect(matches.map((match) => match.symbol)).toEqual(["CHEAP", "ZEROPE"]);
    // PRICEY fails on its data and NOPE_LOWROE fails ROE, so neither is a missing-data exclusion.
    expect(excludedForMissingData).toEqual({ total: 3, byField: { pe: 2, roe: 2 } });
  });

  it("reports nothing when no filter touches a missing metric", () => {
    const input = parseCompanyScreenerParams(new URLSearchParams({ sector_in: "energy" }));
    const { matches, excludedForMissingData } = screenCompanyScreenerRows(rows, input);
    expect(matches).toHaveLength(rows.length);
    expect(excludedForMissingData).toEqual({ total: 0, byField: {} });
  });

  it("attributes an unknown cap bucket and missing technical inputs to their metrics", () => {
    const input = parseCompanyScreenerParams(new URLSearchParams({ bucket_in: "large", golden_cross: "true", high_breakout: "true" }));
    const { matches, excludedForMissingData } = screenCompanyScreenerRows([
      row("FULL", { sma50: 110, sma200: 100, price: 120, fiftyTwoWeekHigh: 118 }),
      row("UNRANKED", { marketCapBucket: "unknown", sma50: 110, sma200: 100, price: 120, fiftyTwoWeekHigh: 118 }),
      row("NOHISTORY", { price: 120 }),
      row("DEATHCROSS", { sma200: 110, sma50: 100, price: 120 }),
    ], input);
    expect(matches.map((match) => match.symbol)).toEqual(["FULL"]);
    // DEATHCROSS fails the cross on its data, though it also lacks the 52-week high.
    expect(excludedForMissingData).toEqual({
      total: 2,
      byField: { marketCap: 1, sma50: 1, sma200: 1, fiftyTwoWeekHigh: 1 },
    });
  });
});

