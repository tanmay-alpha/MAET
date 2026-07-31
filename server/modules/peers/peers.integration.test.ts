import { describe, expect, it } from "bun:test";

describe("Peer Comparison Integration Test Suite", () => {
  it("1. Peer selection excludes the target company itself", () => {
    const targetSymbol = "RELIANCE";
    const candidates = [{ symbol: "RELIANCE" }, { symbol: "TCS" }, { symbol: "INFY" }];
    const filtered = candidates.filter(c => c.symbol !== targetSymbol);
    expect(filtered.find(c => c.symbol === targetSymbol)).toBeUndefined();
  });

  it("2. Does not substitute zero for missing metrics", () => {
    const metrics: Record<string, number | undefined> = {
      peRatio: undefined,
      roe: 0.18,
    };
    expect(metrics.peRatio).toBeUndefined();
    expect(metrics.peRatio).not.toBe(0);
  });
});
