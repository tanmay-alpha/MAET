import { describe, expect, test } from "bun:test";
import type { MarketQuote, MarketQuotesResponse } from "@/lib/market-api";
import { formatChange, heatmapTone, marketSummary, quoteRange } from "./market-presentation";

const quote = (overrides: Partial<MarketQuote> = {}): MarketQuote => ({
  symbol: "RELIANCE", exchange: "NSE", price: 2450, ts: "2026-11-06T10:00:00.000Z",
  source: "angelone", quality: "live", delayed: false, ...overrides,
});
const response = (overrides: Partial<MarketQuotesResponse> = {}): MarketQuotesResponse => ({
  asOf: "2026-11-06T10:00:01.000Z", source: "angelone", delayed: false,
  marketPhase: "OPEN", quotes: [quote()], errors: [], ...overrides,
});

describe("landing heatmap", () => {
  test("missing and invalid changes remain distinct from unchanged quotes", () => {
    expect(heatmapTone(undefined)).toBe(heatmapTone(Number.NaN));
    expect(heatmapTone(Infinity)).toBe(heatmapTone(undefined));
    expect(heatmapTone(0)).not.toBe(heatmapTone(undefined));
    expect(formatChange(undefined)).toBe("—");
    expect(formatChange(0)).toBe("0.00%");
  });

  test("colour buckets are stable at negative and positive boundaries", () => {
    expect(heatmapTone(-20)).toBe(heatmapTone(-2));
    expect(heatmapTone(-2)).not.toBe(heatmapTone(-1.99));
    expect(heatmapTone(-0.51)).not.toBe(heatmapTone(-0.5));
    expect(heatmapTone(-0.01)).not.toBe(heatmapTone(0));
    expect(heatmapTone(0.01)).not.toBe(heatmapTone(0));
    expect(heatmapTone(0.49)).not.toBe(heatmapTone(0.5));
    expect(heatmapTone(1.99)).not.toBe(heatmapTone(2));
    expect(heatmapTone(2)).toBe(heatmapTone(20));
  });

  test("change labels carry signs without negative rounded zero", () => {
    expect(formatChange(2.345)).toBe("+2.35%");
    expect(formatChange(-1.25)).toBe("-1.25%");
    expect(formatChange(-0.001)).toBe("0.00%");
    expect(formatChange(Infinity)).toBe("—");
  });

  test("source and freshness follow per-quote data and market session", () => {
    expect(marketSummary(response())).toBe("Angel One · Live quotes");
    expect(marketSummary(response({ source: "yahoo", delayed: true, marketPhase: "CLOSED", quotes: [quote({ source: "yahoo", quality: "delayed", delayed: true })] }))).toBe("Yahoo Finance · Market closed · last available quotes");
    expect(marketSummary(response({ quotes: [quote(), quote({ source: "yahoo", delayed: true, quality: "delayed" })] }))).toBe("Angel One + Yahoo Finance · Delayed quotes");
    expect(marketSummary(response({ quotes: [quote({ quality: "stale" })] }))).toBe("Angel One · Stale quotes");
  });

  test("freshness uses exchange quote timestamps, not response receipt time", () => {
    const first = quote();
    const later = quote({ ts: "2026-11-06T10:15:00.000Z" });
    expect(quoteRange([])).toBeUndefined();
    expect(quoteRange([first])).toContain("15:30");
    expect(quoteRange([later, first])).toContain("15:30");
    expect(quoteRange([later, first])).toContain("15:45");
    expect(quoteRange([first, first])).not.toContain(" – ");
    expect(quoteRange([first])).toEndWith("IST");
  });
});
