import { describe, expect, it, beforeEach } from "bun:test";
import { placePaperOrder, resetPaperAccount, usePaperAccount } from "./use-paper-account";

describe("Phase 0: Paper Order Financial Integrity Tests", () => {
  beforeEach(() => {
    resetPaperAccount();
  });

  it("1. MARKET order without market price is rejected", () => {
    const res = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 10,
      type: "MARKET",
    } as any);
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Trusted quote object is required for execution");
  });

  it("2. MARKET order never falls back to ₹1", () => {
    const res = placePaperOrder({
      symbol: "TCS",
      side: "BUY",
      qty: 5,
      type: "MARKET",
      marketPrice: undefined,
    } as any);
    expect(res.ok).toBe(false);
    expect(res.message).not.toContain("filled at ₹1");
  });

  it("3. MARKET order with stale quote is rejected", () => {
    const staleTime = new Date(Date.now() - 15000).toISOString();
    const res = placePaperOrder({
      symbol: "INFY",
      side: "BUY",
      qty: 10,
      type: "MARKET",
      marketPrice: 1500,
      quote: {
        exchange: "NSE",
        symbol: "INFY",
        price: 1500,
        ts: staleTime,
        source: "angelone",
        quality: "live",
      },
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Quote is stale");
  });

  it("4. MARKET order with synthetic quote is rejected", () => {
    const res = placePaperOrder({
      symbol: "SBIN",
      side: "BUY",
      qty: 20,
      type: "MARKET",
      marketPrice: 800,
      quote: {
        exchange: "NSE",
        symbol: "SBIN",
        price: 800,
        ts: new Date().toISOString(),
        source: "simulated",
        quality: "synthetic",
      },
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Synthetic quotes are rejected");
  });

  it("5. MARKET order with delayed quote is rejected by default", () => {
    const res = placePaperOrder({
      symbol: "TATAMOTORS",
      side: "BUY",
      qty: 15,
      type: "MARKET",
      marketPrice: 950,
      quote: {
        exchange: "NSE",
        symbol: "TATAMOTORS",
        price: 950,
        ts: new Date().toISOString(),
        source: "yahoo",
        quality: "delayed",
      },
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Delayed quotes are rejected");
  });

  it("6. MARKET order with fresh live quote fills using reference price and calculated slippage", () => {
    const res = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 10,
      type: "MARKET",
      marketPrice: 2500,
      quote: {
        exchange: "NSE",
        symbol: "RELIANCE",
        price: 2500,
        ts: new Date().toISOString(),
        source: "angelone",
        quality: "live",
      },
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("BUY filled at ₹2501.");
  });

  it("7. Invalid quantity is rejected", () => {
    const resZero = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 0,
      type: "MARKET",
      marketPrice: 2500,
    });
    expect(resZero.ok).toBe(false);
    expect(resZero.message).toContain("Quantity must be a positive whole number");

    const resNegative = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: -5,
      type: "MARKET",
      marketPrice: 2500,
    });
    expect(resNegative.ok).toBe(false);

    const resDecimal = placePaperOrder({
      symbol: "RELIANCE",
      side: "BUY",
      qty: 10.5,
      type: "MARKET",
      marketPrice: 2500,
    });
    expect(resDecimal.ok).toBe(false);
  });

  it("8. Empty symbol is rejected", () => {
    const res = placePaperOrder({
      symbol: "   ",
      side: "BUY",
      qty: 10,
      type: "MARKET",
      marketPrice: 100,
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Select a symbol");
  });
});
