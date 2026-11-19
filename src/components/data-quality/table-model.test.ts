import { describe, expect, it } from "bun:test";
import type { SymbolQualityRow } from "../../../server/modules/data-quality/contracts";
import { filterRows, sortRows } from "./table-model";

function row(symbol: string, overrides: Partial<SymbolQualityRow> = {}): SymbolQualityRow {
  return {
    symbol,
    name: `${symbol} Ltd`,
    freshness: "fresh",
    latestCandleDate: "2026-11-09",
    sessionsBehind: 0,
    expectedSessions: 60,
    missingSessions: 0,
    invalidBars: 0,
    zeroVolumeBars: 0,
    invalidSamples: [],
    candleSource: "yahoo",
    lastQuoteAt: null,
    quoteSource: null,
    quoteDelayed: null,
    fundamentals: { latestPeriod: null, latestPeriodType: null, financialRows: 0, rowsMissingAvailability: 0 },
    corporateActions: { count: 0, latestExDate: null },
    ...overrides,
  };
}

const ROWS = [
  row("TCS"),
  row("INFY", { freshness: "stale", sessionsBehind: 4, missingSessions: 4, lastQuoteAt: "2026-11-09T10:00:00.000Z" }),
  row("WIPRO", { freshness: "missing", latestCandleDate: null, sessionsBehind: null, missingSessions: 60 }),
  row("HDFCBANK", { invalidBars: 2, lastQuoteAt: "2026-11-09T09:00:00.000Z", name: "HDFC Bank" }),
];

const symbols = (rows: SymbolQualityRow[]) => rows.map((r) => r.symbol);

describe("filterRows", () => {
  it("filters by freshness and invalid bars", () => {
    expect(symbols(filterRows(ROWS, "", "all"))).toEqual(["TCS", "INFY", "WIPRO", "HDFCBANK"]);
    expect(symbols(filterRows(ROWS, "", "stale"))).toEqual(["INFY"]);
    expect(symbols(filterRows(ROWS, "", "missing"))).toEqual(["WIPRO"]);
    expect(symbols(filterRows(ROWS, "", "invalid"))).toEqual(["HDFCBANK"]);
  });

  it("matches symbol or name case-insensitively", () => {
    expect(symbols(filterRows(ROWS, "  hdfc ", "all"))).toEqual(["HDFCBANK"]);
    expect(symbols(filterRows(ROWS, "bank", "all"))).toEqual(["HDFCBANK"]);
    expect(symbols(filterRows(ROWS, "tcs", "stale"))).toEqual([]);
  });
});

describe("sortRows", () => {
  it("sorts by severity of freshness", () => {
    expect(symbols(sortRows(ROWS, "freshness", "desc"))).toEqual(["WIPRO", "INFY", "HDFCBANK", "TCS"]);
    expect(symbols(sortRows(ROWS, "freshness", "asc"))).toEqual(["HDFCBANK", "TCS", "INFY", "WIPRO"]);
  });

  it("keeps rows without a value last in both directions", () => {
    expect(symbols(sortRows(ROWS, "sessionsBehind", "desc"))).toEqual(["INFY", "HDFCBANK", "TCS", "WIPRO"]);
    expect(symbols(sortRows(ROWS, "sessionsBehind", "asc"))).toEqual(["HDFCBANK", "TCS", "INFY", "WIPRO"]);
    expect(symbols(sortRows(ROWS, "lastQuoteAt", "desc"))).toEqual(["INFY", "HDFCBANK", "TCS", "WIPRO"]);
  });

  it("sorts numbers and symbols without mutating the input", () => {
    expect(symbols(sortRows(ROWS, "invalidBars", "desc"))[0]).toBe("HDFCBANK");
    expect(symbols(sortRows(ROWS, "symbol", "asc"))).toEqual(["HDFCBANK", "INFY", "TCS", "WIPRO"]);
    expect(symbols(ROWS)).toEqual(["TCS", "INFY", "WIPRO", "HDFCBANK"]);
  });
});
