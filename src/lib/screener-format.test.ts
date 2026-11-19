import { describe, expect, it } from "bun:test";
import type { MarketCompany, MarketQuote } from "@/lib/market-api";
import {
  describeMissingExclusions,
  describeProvenance,
  formatMetric,
  fundamentalsProvenance,
  isAvailableMetric,
  mergeMissingExclusions,
  PRICE_STALE_AFTER_MS,
  priceProvenance,
  sourceLabel,
  uniformProvenance,
} from "./screener-format";

const NOW = Date.parse("2026-11-06T10:15:00.000Z");

function company(fields: Partial<MarketCompany> = {}): MarketCompany {
  return {
    symbol: "INFY",
    name: "Infosys Limited",
    exchange: "NSE",
    series: "EQ",
    isin: "INE009A01021",
    marketCapBucket: "large",
    source: "database",
    ...fields,
  };
}

function quote(fields: Partial<MarketQuote> = {}): MarketQuote {
  return {
    exchange: "NSE",
    symbol: "INFY",
    price: 1475.1,
    ts: "2026-11-06T10:15:00.000Z",
    source: "angelone",
    quality: "live",
    delayed: false,
    ...fields,
  };
}

describe("isAvailableMetric", () => {
  it("accepts finite numbers, including 0 and negatives", () => {
    for (const value of [0, -0, -12.5, 1e15]) expect(isAvailableMetric(value)).toBeTrue();
  });

  it("treats null, undefined, NaN, infinities and non-numbers as missing", () => {
    for (const value of [null, undefined, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, "12", {}]) {
      expect(isAvailableMetric(value)).toBeFalse();
    }
  });
});

describe("formatMetric", () => {
  it("returns null for missing data and never formats it as 0", () => {
    for (const unit of ["inr", "inrCr", "percent", "percentPoints", "multiple", "shares", "index"] as const) {
      expect(formatMetric(null, unit)).toBeNull();
      expect(formatMetric(undefined, unit)).toBeNull();
      expect(formatMetric(Number.NaN, unit)).toBeNull();
    }
    expect(formatMetric(0, "multiple")).toBe("0.00");
  });

  it("uses Indian digit grouping with fixed decimals per unit", () => {
    expect(formatMetric(1234567.8, "inr")).toBe("12,34,567.80");
    expect(formatMetric(8_200_000, "shares")).toBe("82,00,000");
    expect(formatMetric(1_400_000.4, "shares")).toBe("14,00,000");
    expect(formatMetric(24.3, "multiple")).toBe("24.30");
    expect(formatMetric(55.25, "index")).toBe("55.3");
  });

  it("states rupee amounts in crores for ₹ Cr columns, whatever their size", () => {
    expect(formatMetric(1_250_000_00_00_000, "inrCr")).toBe("12,50,000.00");
    expect(formatMetric(42_50_00_000, "inrCr")).toBe("42.50");
    // Below one crore stays in crores rather than switching to rupees.
    expect(formatMetric(5_00_000, "inrCr")).toBe("0.05");
  });

  it("scales stored fractions to percent but leaves percentage points alone", () => {
    expect(formatMetric(0.1834, "percent")).toBe("18.34");
    expect(formatMetric(-0.05, "percent")).toBe("-5.00");
    expect(formatMetric(2.4, "percentPoints")).toBe("2.40");
  });

  it("signs positive values on request and drops the sign of values that round to zero", () => {
    expect(formatMetric(2.4, "percentPoints", { signed: true })).toBe("+2.40");
    expect(formatMetric(-1.05, "percentPoints", { signed: true })).toBe("-1.05");
    expect(formatMetric(-0.001, "percentPoints", { signed: true })).toBe("0.00");
    expect(formatMetric(0.001, "percentPoints", { signed: true })).toBe("0.00");
  });
});

describe("missing-data exclusion summary", () => {
  it("is null when nothing was excluded", () => {
    expect(describeMissingExclusions({ total: 0, byField: {} })).toBeNull();
  });

  it("names each metric, most-affected first, with Indian grouping", () => {
    expect(describeMissingExclusions({ total: 1, byField: { pe: 1 } })).toBe("1 row excluded for missing data (P/E 1)");
    expect(describeMissingExclusions({ total: 1250, byField: { roe: 3, marketCap: 1200, pe: 3 } })).toBe(
      "1,250 rows excluded for missing data (Market cap 1,200, P/E 3, ROE 3)",
    );
  });

  it("merges the server's report with the live page's", () => {
    expect(mergeMissingExclusions({ total: 2, byField: { pe: 2 } }, { total: 1, byField: { price: 1, pe: 1 } })).toEqual({
      total: 3,
      byField: { pe: 3, price: 1 },
    });
  });
});

describe("provenance", () => {
  it("names composite stored sources part by part", () => {
    expect(sourceLabel("nse+angelone+yahoo_candles")).toBe("NSE + Angel One + Yahoo candles");
    expect(sourceLabel("company_snapshot")).toBe("Stored company snapshot");
    expect(sourceLabel("some_new_feed")).toBe("some_new_feed");
  });

  it("takes the price provenance from the live quote the row displays", () => {
    const provenance = priceProvenance(company({ price: 1400, quoteSource: "yahoo", quoteAsOf: "2026-10-01T10:00:00.000Z" }), quote(), NOW);
    expect(provenance).toEqual({ source: "Angel One · live", asOf: "2026-11-06T10:15:00.000Z", stale: false });
    expect(describeProvenance(provenance, "price")).toBe("Angel One · live · 06 Nov, 15:45 IST");
  });

  it("flags a price older than the staleness window and falls back to the stored snapshot", () => {
    const old = new Date(NOW - PRICE_STALE_AFTER_MS - 60_000).toISOString();
    expect(priceProvenance(company(), quote({ source: "yahoo", delayed: true, ts: old }), NOW)).toEqual({
      source: "Yahoo · delayed",
      asOf: old,
      stale: true,
    });
    expect(priceProvenance(company({ price: 1400, quoteSource: "yahoo", quoteAsOf: old }), undefined, NOW)?.stale).toBeTrue();
    // A weekend-old close is not stale.
    const friday = new Date(NOW - 3 * 86_400_000).toISOString();
    expect(priceProvenance(company(), quote({ ts: friday }), NOW)?.stale).toBeFalse();
  });

  it("has no price provenance when no price is displayed, and says when the source was not recorded", () => {
    expect(priceProvenance(company(), undefined, NOW)).toBeNull();
    expect(priceProvenance(company({ price: null } as unknown as Partial<MarketCompany>), undefined, NOW)).toBeNull();
    expect(describeProvenance(priceProvenance(company({ price: 10 }), undefined, NOW), "price")).toBe(
      "source not recorded · as-of time not recorded",
    );
    expect(describeProvenance(null, "price")).toBe("not available");
  });

  it("reports fundamentals provenance with a date and the server's staleness", () => {
    const provenance = fundamentalsProvenance(company({
      fundamentalsSource: "yahoo_quote_summary",
      fundamentalsAsOf: "2026-09-30T00:00:00.000Z",
      staleFundamentals: true,
    }));
    expect(provenance).toEqual({ source: "Yahoo Finance · quote summary", asOf: "2026-09-30T00:00:00.000Z", stale: true });
    expect(describeProvenance(provenance, "fundamentals")).toBe("Yahoo Finance · quote summary · 30 Sept 2026");
    expect(fundamentalsProvenance(company())).toBeNull();
  });

  it("is uniform only when every row displays the same provenance", () => {
    const live = priceProvenance(company(), quote(), NOW);
    const sameMinute = priceProvenance(company(), quote({ ts: "2026-11-06T10:15:40.000Z" }), NOW);
    const delayed = priceProvenance(company(), quote({ source: "yahoo", delayed: true }), NOW);
    expect(uniformProvenance([live, sameMinute], "price")).toEqual({ uniform: true, provenance: live });
    expect(uniformProvenance([live, delayed], "price")).toEqual({ uniform: false });
    expect(uniformProvenance([live, null], "price")).toEqual({ uniform: false });
    expect(uniformProvenance([], "price")).toEqual({ uniform: true, provenance: null });
  });
});
