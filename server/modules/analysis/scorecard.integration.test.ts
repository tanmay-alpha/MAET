import { describe, expect, it } from "bun:test";
import { calculateStockScorecard } from "../../domain/analysis/stock-scorecard";

describe("Stock Scorecard Deterministic Test Suite", () => {
  it("1. Missing inputs reduce confidence score without substituting zero", () => {
    const emptyScorecard = calculateStockScorecard({ asOf: "2026-07-31T00:00:00.000Z" });
    expect(emptyScorecard.qualityScore).toBeUndefined();
    expect(emptyScorecard.overallScore).toBeUndefined();
    expect(emptyScorecard.confidenceScore).toBeLessThan(0.3);
    expect(emptyScorecard.missingInputs.length).toBeGreaterThan(15);
  });

  it("2. Golden fixture produces expected scores and strengths", () => {
    const result = calculateStockScorecard({
      peRatio: 18,
      pbRatio: 2.5,
      earningsYield: 0.08,
      freeCashFlowYield: 0.06,
      roe: 0.22,
      roce: 0.25,
      revenueGrowth: 0.15,
      epsGrowth: 0.18,
      debtToEquity: 0.2,
      interestCoverage: 15,
      currentRatio: 2.0,
      netMargin: 0.18,
      asOf: "2026-07-31T00:00:00.000Z",
    });

    expect(result.methodVersion).toBe("1.0.0");
    expect(result.qualityScore).toBeGreaterThan(60);
    expect(result.strengths).toContain("High ROE");
    expect(result.strengths).toContain("Strong ROCE");
  });
});
