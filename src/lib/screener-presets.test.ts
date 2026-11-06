import { describe, expect, it } from "bun:test";
import type { MarketCompany, MarketQuote } from "@/lib/market-api";
import {
  activeScreenerPreset,
  applyScreenerPreset,
  arrangeLivePage,
  DEFAULT_SCREENER_SORT,
  type ScreenerSort,
} from "./screener-presets";

/** An NSE-fallback row: identity only, no stored quote fields. */
function company(symbol: string, stored: Partial<MarketCompany> = {}): MarketCompany {
  return {
    symbol,
    name: `${symbol} Limited`,
    exchange: "NSE",
    series: "EQ",
    isin: `INE${symbol}`,
    marketCapBucket: "unknown",
    source: "nse",
    ...stored,
  };
}

function quote(symbol: string, changePct: number | undefined): MarketQuote {
  return {
    exchange: "NSE",
    symbol,
    price: 100,
    volume: 1_000,
    ts: "2026-11-06T10:15:00.000Z",
    source: "angelone",
    quality: "live",
    changePct,
    delayed: false,
  } as MarketQuote;
}

const byMarketCap: ScreenerSort = { sortBy: "market_cap", sortDir: "desc" };

describe("screener presets", () => {
  it("Gainers sorts by change % descending", () => {
    expect(applyScreenerPreset("gainers", DEFAULT_SCREENER_SORT)).toEqual({
      filters: { change_pct_min: "0.01" },
      sort: { sortBy: "change_pct", sortDir: "desc" },
    });
  });

  it("Losers sorts by change % ascending", () => {
    expect(applyScreenerPreset("losers", byMarketCap)).toEqual({
      filters: { change_pct_max: "-0.01" },
      sort: { sortBy: "change_pct", sortDir: "asc" },
    });
  });

  it("All stocks resets the sort; filter-only presets keep the current one", () => {
    expect(applyScreenerPreset("all", byMarketCap).sort).toEqual(DEFAULT_SCREENER_SORT);
    expect(applyScreenerPreset("high-volume", byMarketCap)).toEqual({
      filters: { volume_min: "1000000" },
      sort: byMarketCap,
    });
  });

  it("recognises the active preset from its filters, ignoring blank inputs", () => {
    expect(activeScreenerPreset({})).toBe("all");
    expect(activeScreenerPreset({ price_min: " " })).toBe("all");
    expect(activeScreenerPreset({ change_pct_min: "0.01" })).toBe("gainers");
    expect(activeScreenerPreset({ pb_max: "3", pe_max: "20" })).toBe("value");
    expect(activeScreenerPreset({ change_pct_min: "0.01", price_min: "1000" })).toBeNull();
  });
});

describe("arrangeLivePage", () => {
  // Alphabetical, as the NSE fallback returns them.
  const page = ["AAA", "BBB", "CCC", "DDD", "EEE", "FFF"].map((symbol) => company(symbol));
  const quotes = new Map(
    [
      quote("AAA", 1.2),
      quote("BBB", -0.4),
      quote("CCC", 3.4),
      quote("DDD", undefined),
      quote("EEE", -2.5),
      quote("FFF", 0.6),
    ].map((entry) => [entry.symbol, entry]),
  );

  it("NSE fallback: Gainers keeps the risers, biggest change first", () => {
    const { filters, sort } = applyScreenerPreset("gainers", DEFAULT_SCREENER_SORT);
    const rows = arrangeLivePage(page, quotes, { filters, sort, filterLive: true });
    expect(rows.map((row) => row.symbol)).toEqual(["CCC", "AAA", "FFF"]);
  });

  it("NSE fallback: Losers keeps the fallers, biggest fall first", () => {
    const { filters, sort } = applyScreenerPreset("losers", DEFAULT_SCREENER_SORT);
    const rows = arrangeLivePage(page, quotes, { filters, sort, filterLive: true });
    expect(rows.map((row) => row.symbol)).toEqual(["EEE", "BBB"]);
  });

  it("database mode: orders the page by the live value the row shows, missing values last", () => {
    const stored = [
      company("AAA", { changePct: 9 }),
      company("DDD", { changePct: undefined }),
      company("BBB", { changePct: 5 }),
      company("GGG", { changePct: 0.1 }),
    ];
    const rows = arrangeLivePage(stored, quotes, {
      filters: {},
      sort: { sortBy: "change_pct", sortDir: "desc" },
      filterLive: false,
    });
    // AAA and BBB use their live change (1.2, -0.4); GGG has no quote, so its stored 0.1 counts.
    expect(rows.map((row) => row.symbol)).toEqual(["AAA", "GGG", "BBB", "DDD"]);
  });

  it("leaves the server order alone for sorts the quotes cannot answer", () => {
    const rows = arrangeLivePage([page[2], page[0], page[1]], quotes, {
      filters: {},
      sort: byMarketCap,
      filterLive: false,
    });
    expect(rows.map((row) => row.symbol)).toEqual(["CCC", "AAA", "BBB"]);
  });
});
