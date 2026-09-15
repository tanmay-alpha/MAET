import { describe, it, expect } from "bun:test";
import {
  analyzeParameterStability,
  build2DParameterHeatmap,
  findNeighbors,
  type SweepPointResult,
} from "./robustness";
import type { SweepParameterRange } from "../../workers/sweep-worker";

describe("P2 Parameter Robustness & Stability Analysis (Commit 8)", () => {
  const ranges: SweepParameterRange[] = [
    { name: "fastMa", min: 10, max: 30, step: 5 },
    { name: "slowMa", min: 40, max: 80, step: 10 },
  ];

  it("1. Stable Plateau: high neighbor stability scores, no overfit risk", () => {
    // A robust plateau around (20, 50)
    const plateauPoints: SweepPointResult[] = [
      { params: { fastMa: 20, slowMa: 50 }, sharpe: 2.10, totalReturn: 0.25, maxDrawdown: 0.10, tradeCount: 65, costDragPercent: 5 },
      { params: { fastMa: 15, slowMa: 50 }, sharpe: 2.05, totalReturn: 0.24, maxDrawdown: 0.11, tradeCount: 62, costDragPercent: 5 },
      { params: { fastMa: 25, slowMa: 50 }, sharpe: 2.00, totalReturn: 0.23, maxDrawdown: 0.12, tradeCount: 60, costDragPercent: 5 },
      { params: { fastMa: 20, slowMa: 40 }, sharpe: 1.95, totalReturn: 0.22, maxDrawdown: 0.13, tradeCount: 64, costDragPercent: 5 },
      { params: { fastMa: 20, slowMa: 60 }, sharpe: 1.98, totalReturn: 0.23, maxDrawdown: 0.11, tradeCount: 61, costDragPercent: 5 },
    ];

    const analysis = analyzeParameterStability(plateauPoints, ranges);

    expect(analysis.bestSharpe).toBe(2.10);
    expect(analysis.isFragileSpike).toBe(false);
    expect(analysis.neighborAverageSharpe).toBeGreaterThan(1.9);
    expect(analysis.flags).not.toContain("OVERFIT_RISK");
    expect(analysis.flags).not.toContain("PARAMETER_INSTABILITY");
    expect(analysis.robustnessScore.overallRobustnessScore).toBeGreaterThanOrEqual(70);
  });

  it("2. Fragile Spike (Overfit): isolated peak surrounded by poor neighbors flags OVERFIT_RISK", () => {
    // Magical isolated peak at (20, 50) = 4.5, but neighbors are negative
    const fragilePoints: SweepPointResult[] = [
      { params: { fastMa: 20, slowMa: 50 }, sharpe: 4.50, totalReturn: 0.50, maxDrawdown: 0.08, tradeCount: 50, costDragPercent: 5 },
      { params: { fastMa: 15, slowMa: 50 }, sharpe: -0.20, totalReturn: -0.05, maxDrawdown: 0.25, tradeCount: 45, costDragPercent: 5 },
      { params: { fastMa: 25, slowMa: 50 }, sharpe: -0.10, totalReturn: -0.02, maxDrawdown: 0.22, tradeCount: 48, costDragPercent: 5 },
      { params: { fastMa: 20, slowMa: 40 }, sharpe: -0.50, totalReturn: -0.08, maxDrawdown: 0.30, tradeCount: 52, costDragPercent: 5 },
      { params: { fastMa: 20, slowMa: 60 }, sharpe: 0.10, totalReturn: 0.01, maxDrawdown: 0.20, tradeCount: 47, costDragPercent: 5 },
    ];

    const analysis = analyzeParameterStability(fragilePoints, ranges);

    expect(analysis.bestSharpe).toBe(4.50);
    expect(analysis.isFragileSpike).toBe(true);
    expect(analysis.flags).toContain("OVERFIT_RISK");
    expect(analysis.flags).toContain("PARAMETER_INSTABILITY");
    expect(analysis.robustnessScore.neighborStabilityScore).toBeLessThanOrEqual(25);
  });

  it("3. Safeguards: raises LOW_SAMPLE_SIZE and HIGH_COST_DRAG flags", () => {
    const sparseHighCostPoints: SweepPointResult[] = [
      { params: { fastMa: 10, slowMa: 40 }, sharpe: 1.5, totalReturn: 0.15, maxDrawdown: 0.10, tradeCount: 12, costDragPercent: 35 },
    ];

    const analysis = analyzeParameterStability(sparseHighCostPoints, ranges);

    expect(analysis.flags).toContain("LOW_SAMPLE_SIZE");
    expect(analysis.flags).toContain("HIGH_COST_DRAG");
  });

  it("4. 2D Parameter Heatmap projection: formats matrix for visualization", () => {
    const points: SweepPointResult[] = [
      { params: { fastMa: 10, slowMa: 40 }, sharpe: 1.2, totalReturn: 0.10, maxDrawdown: 0.05, tradeCount: 50 },
      { params: { fastMa: 10, slowMa: 50 }, sharpe: 1.4, totalReturn: 0.12, maxDrawdown: 0.05, tradeCount: 50 },
      { params: { fastMa: 20, slowMa: 40 }, sharpe: 1.8, totalReturn: 0.18, maxDrawdown: 0.05, tradeCount: 50 },
    ];

    const heatmap = build2DParameterHeatmap(points, "fastMa", "slowMa");

    expect(heatmap).toHaveLength(3);
    expect(heatmap[0].paramX).toBe(10);
    expect(heatmap[0].paramY).toBe(40);
    expect(heatmap[0].sharpe).toBe(1.2);
    expect(heatmap[0].totalReturn).toBe(10.0);
  });
});
