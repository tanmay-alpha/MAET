import { describe, expect, it } from "bun:test";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";

describe("Paper Trading Service Integration Test Suite", () => {
  it("1. Idempotency quote fingerprint evaluation is deterministic", () => {
    const nowIso = new Date().toISOString();
    const quote1: ExecutionQuote = {
      exchange: "NSE",
      symbol: "TCS",
      price: 3400,
      volume: 50,
      ts: nowIso,
      source: "angelone",
      quality: "live",
    };

    const quote2: ExecutionQuote = {
      exchange: "NSE",
      symbol: "TCS",
      price: 3400,
      volume: 50,
      ts: nowIso,
      source: "angelone",
      quality: "live",
    };

    const eval1 = evaluateExecutionQuote(quote1, "TCS");
    const eval2 = evaluateExecutionQuote(quote2, "TCS");

    expect(eval1.executable).toBe(true);
    expect(eval2.executable).toBe(true);
  });

  it("2. Rejects order placement with mismatched quotes", () => {
    const quote: ExecutionQuote = {
      exchange: "NSE",
      symbol: "INFY",
      price: 1500,
      volume: 100,
      ts: new Date().toISOString(),
      source: "angelone",
      quality: "live",
    };

    const evalResult = evaluateExecutionQuote(quote, "RELIANCE");
    expect(evalResult.executable).toBe(false);
    expect(evalResult.reason).toContain("Quote symbol mismatch");
  });
});
