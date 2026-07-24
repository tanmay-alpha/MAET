import { describe, expect, it, beforeEach } from "bun:test";
import { placePaperOrder, resetPaperAccount } from "./use-paper-account";

const liveQuote = (symbol: string, price: number, overrides: object = {}) => ({
  exchange: "NSE" as const,
  symbol,
  price,
  volume: 1000,
  ts: new Date().toISOString(),
  source: "angelone" as const,
  quality: "live" as const,
  ...overrides,
});

describe("Phase 0.3: v3 Paper Account Integrity Tests", () => {
  beforeEach(() => {
    resetPaperAccount();
  });

  it("1. MARKET order without quote is rejected", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
    } as any);
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/rejected/i);
  });

  it("2. MARKET order with stale quote is rejected", () => {
    const staleTime = new Date(Date.now() - 15000).toISOString();
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "INFY",
      side: "BUY",
      quantity: 10,
      quote: liveQuote("INFY", 1500, { ts: staleTime }),
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("stale");
  });

  it("3. MARKET order with synthetic quote is rejected", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "SBIN",
      side: "BUY",
      quantity: 20,
      quote: liveQuote("SBIN", 800, { source: "simulated", quality: "synthetic" }),
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Synthetic quotes are rejected");
  });

  it("4. MARKET order with delayed quote is rejected", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "TATAMOTORS",
      side: "BUY",
      quantity: 15,
      quote: liveQuote("TATAMOTORS", 950, { source: "yahoo", quality: "delayed" }),
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Delayed quotes are rejected");
  });

  it("5. MARKET order with fresh live quote fills with slippage", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote: liveQuote("RELIANCE", 2500),
    });
    expect(res.ok).toBe(true);
    expect(res.message).toMatch(/BUY filled at ₹/);
  });

  it("6. MARKET order with symbol mismatch is rejected", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10,
      quote: liveQuote("INFY", 2500), // wrong symbol
    });
    expect(res.ok).toBe(false);
    expect(res.message).toMatch(/mismatch|symbol/i);
  });

  it("7. Invalid quantity is rejected", () => {
    const resZero = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 0,
      quote: liveQuote("RELIANCE", 2500),
    });
    expect(resZero.ok).toBe(false);
    expect(resZero.message).toContain("Quantity must be a positive whole number");

    const resNegative = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: -5,
      quote: liveQuote("RELIANCE", 2500),
    });
    expect(resNegative.ok).toBe(false);

    const resDecimal = placePaperOrder({
      type: "MARKET",
      symbol: "RELIANCE",
      side: "BUY",
      quantity: 10.5,
      quote: liveQuote("RELIANCE", 2500),
    });
    expect(resDecimal.ok).toBe(false);
  });

  it("8. Empty symbol is rejected", () => {
    const res = placePaperOrder({
      type: "MARKET",
      symbol: "   ",
      side: "BUY",
      quantity: 10,
      quote: liveQuote("   ", 100),
    });
    expect(res.ok).toBe(false);
    expect(res.message).toContain("Select a symbol");
  });

  it("9. LIMIT order is queued without a quote", () => {
    const res = placePaperOrder({
      type: "LIMIT",
      symbol: "TCS",
      side: "BUY",
      quantity: 5,
      limitPrice: 3500,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("queued");
  });

  it("10. STOP_LOSS_LIMIT order is queued", () => {
    const res = placePaperOrder({
      type: "STOP_LOSS_LIMIT",
      symbol: "HDFCBANK",
      side: "SELL",
      quantity: 5,
      stopPrice: 1400,
      limitPrice: 1395,
    });
    expect(res.ok).toBe(true);
    expect(res.message).toContain("queued");
  });
});
