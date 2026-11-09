import { describe, expect, it } from "bun:test";
import { analyseSweepRobustness, parameterSteps, type StoredSweepResult } from "./sweep-robustness";

const result = (fast: number, slow: number, sharpe: number): StoredSweepResult => ({
  parameterValues: { fast, slow },
  resultSummary: { sharpe: sharpe.toFixed(4), sortino: "0", totalReturn: "0.100000", maxDrawdown: "0.050000", winRate: "0.5", profitFactor: null, tradeCount: 40 },
});

describe("sweep robustness", () => {
  it("derives each parameter's grid step from its values", () => {
    expect(parameterSteps([
      { name: "fast", path: "a", values: [3, 5, 7] },
      { name: "slow", path: "b", values: [30, 20, 40, 50] },
      { name: "single", path: "c", values: [9] },
    ])).toEqual([{ name: "fast", step: 2 }, { name: "slow", step: 10 }, { name: "single", step: 1 }]);
  });

  it("finds the best combination and builds a heatmap over the first two parameters", () => {
    const parameters = [{ name: "fast", path: "a", values: [3, 5] }, { name: "slow", path: "b", values: [20, 30] }];
    const { analysis, paramX, paramY } = analyseSweepRobustness(parameters, [result(3, 20, 0.5), result(3, 30, 0.8), result(5, 20, 1.2), result(5, 30, 0.9)]);
    expect(analysis.bestParams).toEqual({ fast: 5, slow: 20 });
    expect(analysis.neighborCount).toBe(3);
    expect(analysis.heatmapMatrix).toContainEqual({ paramX: 5, paramY: 20, sharpe: 1.2, totalReturn: 10 });
    expect(analysis.heatmapMatrix).toHaveLength(4);
    expect([paramX, paramY]).toEqual(["fast", "slow"]);
  });

  it("has no heatmap for a one-parameter sweep and skips rows without results", () => {
    const { analysis, paramX } = analyseSweepRobustness(
      [{ name: "fast", path: "a", values: [3, 5] }],
      [result(3, 0, 1), { parameterValues: { fast: 5 }, resultSummary: null }],
    );
    expect(analysis.heatmapMatrix).toBeUndefined();
    expect(analysis.bestParams).toEqual({ fast: 3, slow: 0 });
    expect(paramX).toBeUndefined();
  });

  it("carries the stored cost drag into the robustness score", () => {
    const parameters = [{ name: "fast", path: "a", values: [3, 5] }];
    const highCost = (fast: number, sharpe: number): StoredSweepResult => {
      const base = result(fast, 0, sharpe);
      return { ...base, resultSummary: { ...(base.resultSummary as object), costDragPercent: "30.0000" } };
    };
    const { analysis } = analyseSweepRobustness(parameters, [highCost(3, 1), highCost(5, 0.9)]);
    expect(analysis.flags).toContain("HIGH_COST_DRAG");
    expect(analysis.robustnessScore.costDragScore).toBe(40);
  });
});
