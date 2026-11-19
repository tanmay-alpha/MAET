import { describe, expect, it } from "bun:test";
import { analyseSweepRobustness, equityReturnBlocks, parameterSteps, sweepSelection, type StoredSweepResult } from "./sweep-robustness";

/** mulberry32: seeded PRNG for reproducible equity curves. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** An equity curve of `bars` points whose per-bar return is drift + uniform noise. */
function equityCurve(seed: number, bars: number, drift: number): number[] {
  const next = rng(seed);
  const out = [100_000];
  for (let i = 1; i < bars; i++) out.push(out[i - 1] * (1 + drift + (next() - 0.5) * 0.02));
  return out;
}

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

describe("sweep selection and probability of backtest overfitting", () => {
  const stored = (fast: number, equity: number[] | null, blocks = 8): StoredSweepResult => ({
    parameterValues: { fast },
    resultSummary: { ...(result(fast, 0, 1).resultSummary as object), returnBlocks: equity && equityReturnBlocks(equity, equity.length - 1, blocks) },
  });

  it("labels the best sweep result a retrospective in-sample pick and counts the trials", () => {
    const results = [1, 2, 3, 4, 5].map((fast) => stored(fast, equityCurve(fast, 400, 0)));
    const { selection } = analyseSweepRobustness([{ name: "fast", path: "a", values: [1, 2, 3, 4, 5] }], results);
    expect(selection).toMatchObject({ sample: "IN_SAMPLE", method: "RETROSPECTIVE_BEST_SHARPE", trials: 5, pboReason: null });
    expect(selection.pbo).toMatchObject({ trials: 5, blocks: 8, splits: 70 });
  });

  it("finds no overfitting when one parameter set dominates out of sample too", () => {
    for (let seed = 1; seed <= 5; seed++) {
      const results = [0, 1, 2, 3, 4, 5].map((i) => stored(i, equityCurve(seed * 10 + i, 500, i === seed % 6 ? 0.004 : 0)));
      expect(sweepSelection(results).pbo?.pbo).toBe(0);
    }
  });

  it("reports why PBO is missing instead of computing it on partial data", () => {
    expect(sweepSelection([stored(1, equityCurve(1, 400, 0))])).toMatchObject({ trials: 1, pbo: null, pboReason: expect.stringMatching(/two parameter sets/) });
    // A row stored before per-period returns were recorded.
    const legacy = sweepSelection([stored(1, equityCurve(1, 400, 0)), result(2, 0, 1)]);
    expect(legacy).toMatchObject({ trials: 2, pbo: null, pboReason: expect.stringMatching(/no per-period returns/) });
    const mismatched = sweepSelection([stored(1, equityCurve(1, 400, 0), 8), stored(2, equityCurve(2, 400, 0), 6)]);
    expect(mismatched).toMatchObject({ pbo: null, pboReason: expect.stringMatching(/same return blocks/) });
  });

  it("stores per-bar returns only when the curve covers every expected bar", () => {
    const equity = [100, 110, 99, 99, 108.9];
    expect(equityReturnBlocks(equity, 4, 2)).toEqual([
      [2, 0.1 + (99 / 110 - 1), 0.01 + (99 / 110 - 1) ** 2],
      [2, 0 + 0.1, 0 + 0.1 ** 2],
    ].map(([count, sum, sumSquares]) => [count, expect.closeTo(sum, 12), expect.closeTo(sumSquares, 12)]));
    expect(equityReturnBlocks(equity, 5, 2)).toBeNull();
    expect(equityReturnBlocks(equity, 4, 0)).toBeNull();
  });
});
