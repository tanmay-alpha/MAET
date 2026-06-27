import { describe, it, expect } from "bun:test";
import nifty50 from "../../../shared/symbols/nifty50.json";
import { resolveMarketSymbol, SYMBOLS, lookupSymbol, yahooTicker } from "./symbol";

describe("symbol domain", () => {
  it("bundle contains at least 50 NSE symbols", () => {
    expect(SYMBOLS.length).toBeGreaterThanOrEqual(50);
    expect(SYMBOLS.every((q) => q.exchange === "NSE" || q.exchange === "BSE")).toBe(true);
  });

  it("lookupSymbol returns the same record for RELIANCE", () => {
    const q = lookupSymbol("NSE", "RELIANCE");
    expect(q).toBeDefined();
    expect(q!.yahooTicker).toBe("RELIANCE.NS");
  });

  it("lookupSymbol returns undefined for unknown", () => {
    expect(lookupSymbol("NSE", "ZZZZZ")).toBeUndefined();
  });

  it("yahooTicker appends .NS for NSE and .BO for BSE", () => {
    expect(yahooTicker({ exchange: "NSE", symbol: "X", name: "X", token: "1", yahooTicker: "X", isActive: true })).toBe("X.NS");
    expect(yahooTicker({ exchange: "BSE", symbol: "X", name: "X", token: "1", yahooTicker: "X", isActive: true })).toBe("X.BO");
  });

  it("bundle file matches the inferred types", () => {
    expect(nifty50.length).toBeGreaterThan(0);
  });

  it("maps public index names to Yahoo index tickers", () => {
    expect(resolveMarketSymbol("NIFTY50")).toEqual({
      symbol: "NIFTY50",
      ticker: "^NSEI",
      exchange: "NSE",
    });
    expect(resolveMarketSymbol("sensex")).toEqual({
      symbol: "SENSEX",
      ticker: "^BSESN",
      exchange: "BSE",
    });
  });
});
