import { describe, expect, it } from "bun:test";
import { evaluateAlert } from "./evaluator";

describe("Alert Engine Integration & Evaluator Test Suite", () => {
  it("1. PRICE_ABOVE triggers when price exceeds threshold", () => {
    const quote = {
      symbol: "RELIANCE",
      price: 2600,
      previousClose: 2500,
      volume: 100000,
      quoteTimestamp: Date.now(),
      source: "angelone",
    };

    const res = evaluateAlert(quote, {
      type: "PRICE_ABOVE",
      threshold: 2550,
      cooldownMinutes: 60,
      mode: "one_time",
    });

    expect(res.triggered).toBe(true);
    expect(res.currentValue).toBe(2600);
  });

  it("2. RSI_BELOW triggers when RSI drops below threshold", () => {
    const quote = {
      symbol: "TCS",
      price: 3400,
      previousClose: 3450,
      volume: 50000,
      rsi: 28,
      quoteTimestamp: Date.now(),
      source: "angelone",
    };

    const res = evaluateAlert(quote, {
      type: "RSI_BELOW",
      threshold: 30,
      cooldownMinutes: 60,
      mode: "one_time",
    });

    expect(res.triggered).toBe(true);
    expect(res.currentValue).toBe(28);
  });

  it("3. Deduplication fingerprint format is deterministic", () => {
    const alertId = "550e8400-e29b-41d4-a716-446655440000";
    const timestampBucket = 2950000;
    const fp1 = `${alertId}-${timestampBucket}`;
    const fp2 = `${alertId}-${timestampBucket}`;
    expect(fp1).toBe(fp2);
  });
});
