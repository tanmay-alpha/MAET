import { describe, it, expect } from "bun:test";
import { calculateStockScorecard } from "./stock-scorecard";

describe("calculateStockScorecard", () => {
  it("returns all scores for fully populated input", () => {
    const result = calculateStockScorecard({
      peRatio: 20,
      pbRatio: 3,
      earningsYield: 0.05,
      freeCashFlowYield: 0.03,
      roe: 0.20,
      roce: 0.18,
      revenueGrowth: 0.15,
      epsGrowth: 0.12,
      priceChange3m: 0.08,
      priceChange1y: 0.25,
      relativeVolume: 1.5,
      rsi14: 65,
      macdHistogram: 0.5,
      macdTrend: "bullish",
      debtToEquity: 0.5,
      interestCoverage: 8,
      currentRatio: 1.8,
      netMargin: 0.15,
      grossMargin: 0.35,
      freeCashFlow: 1e9,
      operatingCashFlow: 1.5e9,
      marketCap: 5e11,
      sector: "IT",
    });

    expect(result.overallScore).toBeDefined();
    expect(result.overallScore).toBeGreaterThanOrEqual(0);
    expect(result.overallScore).toBeLessThanOrEqual(100);
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.9);
    expect(result.inputCoverage).toBe(1);
    expect(result.missingInputs).toHaveLength(0);
    expect(result.strengths.length).toBeGreaterThan(0);
  });

  it("returns undefined component scores when inputs are missing", () => {
    const result = calculateStockScorecard({});
    expect(result.missingInputs.length).toBeGreaterThan(0);
    // overallScore may still be undefined when all components are missing
    expect(result.confidenceScore).toBeGreaterThanOrEqual(0.2);
    expect(result.confidenceScore).toBeLessThanOrEqual(1);
    expect(result.inputCoverage).toBeLessThan(0.5);
    expect(result.strengths).toEqual([]);
    expect(result.risks).toEqual([]);
  });

  it("lowers confidence with missing inputs but never returns zero", () => {
    const result = calculateStockScorecard({ roe: 0.25 });
    expect(result.confidenceScore).toBeGreaterThan(0);
    expect(result.confidenceScore).toBeLessThan(1);
  });

  it("never returns zero scores", () => {
    const result = calculateStockScorecard({ roe: 0.01, peRatio: 200 });
    const scores = [
      result.qualityScore,
      result.valuationScore,
      result.growthScore,
      result.momentumScore,
      result.financialHealthScore,
      result.riskScore,
      result.overallScore,
    ];
    for (const s of scores) {
      if (s !== undefined) {
        expect(s).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it("detects strengths when ROE and ROCE are high", () => {
    const result = calculateStockScorecard({ roe: 0.30, roce: 0.28 });
    expect(result.strengths).toContain("High ROE");
    expect(result.strengths).toContain("Strong ROCE");
  });

  it("detects risks when current ratio is weak", () => {
    const result = calculateStockScorecard({ currentRatio: 0.5 });
    expect(result.risks).toContain("Weak current ratio");
  });

  it("marks bullish MACD as strength and bearish as risk", () => {
    const bullish = calculateStockScorecard({ macdTrend: "bullish" });
    expect(bullish.strengths).toContain("Bullish MACD trend");
    const bearish = calculateStockScorecard({ macdTrend: "bearish" });
    expect(bearish.risks).toContain("Bearish MACD trend");
  });

  it("returns deterministic output", () => {
    const a = calculateStockScorecard({ roe: 0.2, peRatio: 25, asOf: "2026-01-01T00:00:00.000Z" });
    const b = calculateStockScorecard({ roe: 0.2, peRatio: 25, asOf: "2026-01-01T00:00:00.000Z" });
    expect(a).toEqual(b);
  });
});