import { describe, expect, it } from "bun:test";
import {
  cscvBlockCount,
  pboFromBlockStats,
  probabilityOfBacktestOverfitting,
  summariseReturnBlocks,
} from "./robustness";

/** mulberry32: small seeded PRNG so every property loop is reproducible. */
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

function normal(next: () => number): number {
  const u = Math.max(next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * next());
}

/** T x N matrix: returns[t][n] = drift[n] + 0.01 * noise. */
function matrix(seed: number, periods: number, drifts: number[]): number[][] {
  const next = rng(seed);
  return Array.from({ length: periods }, () => drifts.map((d) => d + 0.01 * normal(next)));
}

/** Straight from the definition: concatenate raw returns per split and rank sample Sharpe ratios. */
function naivePbo(returns: number[][], blocks: number): number {
  const t = returns.length;
  const n = returns[0].length;
  const blockOf = (i: number) => Math.floor((i * blocks) / t);
  const sharpe = (xs: number[]) => {
    const m = xs.reduce((s, x) => s + x, 0) / xs.length;
    const v = xs.reduce((s, x) => s + (x - m) ** 2, 0) / (xs.length - 1);
    return m / Math.sqrt(v);
  };
  let overfit = 0;
  let splits = 0;
  for (let mask = 0; mask < 1 << blocks; mask++) {
    let bits = 0;
    for (let b = 0; b < blocks; b++) if (mask & (1 << b)) bits++;
    if (bits !== blocks / 2) continue;
    splits++;
    const is = (i: number) => (mask & (1 << blockOf(i))) !== 0;
    const isPerf = Array.from({ length: n }, (_, c) => sharpe(returns.filter((_, i) => is(i)).map((row) => row[c])));
    const oosPerf = Array.from({ length: n }, (_, c) => sharpe(returns.filter((_, i) => !is(i)).map((row) => row[c])));
    const best = isPerf.indexOf(Math.max(...isPerf));
    const rank = 1 + oosPerf.filter((p) => p < oosPerf[best]).length;
    if (Math.log(rank / (n + 1) / (1 - rank / (n + 1))) <= 0) overfit++;
  }
  return overfit / splits;
}

describe("probability of backtest overfitting (CSCV)", () => {
  it("is about one half when every candidate is independent noise with the same distribution", () => {
    const pbos = Array.from({ length: 12 }, (_, seed) => probabilityOfBacktestOverfitting(matrix(seed + 1, 480, Array(10).fill(0)), 16)!.pbo);
    const mean = pbos.reduce((s, p) => s + p, 0) / pbos.length;
    expect(mean).toBeGreaterThan(0.35);
    expect(mean).toBeLessThan(0.65);
  });

  it("is zero when one candidate dominates, wherever it sits in the grid", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const n = 10;
      const winner = Math.floor(rng(seed * 7)() * n);
      const drifts = Array.from({ length: n }, (_, i) => (i === winner ? 0.006 : 0));
      const result = probabilityOfBacktestOverfitting(matrix(seed, 480, drifts), 16)!;
      expect(result.pbo).toBe(0);
      // The in-sample winner is the best out of sample in every split: rank N, logit ln(N).
      expect(result.medianLogit).toBeCloseTo(Math.log(n), 10);
      expect(result).toMatchObject({ trials: n, blocks: 16, splits: 12870 });
    }
  });

  it("approaches one when in-sample winners are out-of-sample losers", () => {
    // Each candidate's block means sum to zero: whatever wins in sample loses out of sample.
    const next = rng(42);
    const n = 8;
    const blocks = 8;
    const perBlock = 30;
    const blockMeans = Array.from({ length: n }, () => {
      const raw = Array.from({ length: blocks }, () => normal(next) * 0.01);
      const mean = raw.reduce((s, x) => s + x, 0) / blocks;
      return raw.map((x) => x - mean);
    });
    const returns = Array.from({ length: blocks * perBlock }, (_, t) =>
      blockMeans.map((means) => means[Math.floor(t / perBlock)] + 0.001 * normal(next)));
    expect(probabilityOfBacktestOverfitting(returns, blocks)!.pbo).toBeGreaterThan(0.9);
  });

  it("matches a direct computation on raw returns for random matrices", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const next = rng(seed * 101);
      const n = 2 + Math.floor(next() * 5);
      const blocks = [2, 4, 6][Math.floor(next() * 3)];
      const periods = blocks * 3 + Math.floor(next() * 40);
      const drifts = Array.from({ length: n }, () => (next() - 0.5) * 0.004);
      const returns = matrix(seed, periods, drifts);
      expect(probabilityOfBacktestOverfitting(returns, blocks)!.pbo).toBeCloseTo(naivePbo(returns, blocks), 12);
    }
  });

  it("does not change when candidates are rescaled or reordered", () => {
    for (let seed = 1; seed <= 10; seed++) {
      const next = rng(seed * 13);
      const returns = matrix(seed, 160, Array.from({ length: 6 }, () => (next() - 0.5) * 0.002));
      const base = probabilityOfBacktestOverfitting(returns, 8)!.pbo;
      const scales = returns[0].map(() => 0.1 + next() * 10);
      const order = returns[0].map((_, i) => i).sort(() => next() - 0.5);
      const transformed = returns.map((row) => order.map((c) => row[c] * scales[c]));
      expect(probabilityOfBacktestOverfitting(transformed, 8)!.pbo).toBeCloseTo(base, 12);
    }
  });

  it("puts identical candidates exactly at the out-of-sample median (logit 0, counted as overfit)", () => {
    const column = matrix(3, 64, [0.001]).map((row) => row[0]);
    const result = probabilityOfBacktestOverfitting(column.map((r) => [r, r, r]), 4)!;
    expect(result).toEqual({ pbo: 1, trials: 3, blocks: 4, splits: 6, medianLogit: 0 });
  });

  it("needs two candidates, an even block count and the same blocks for every candidate", () => {
    expect(probabilityOfBacktestOverfitting(matrix(1, 40, [0]), 4)).toBeNull();
    expect(() => probabilityOfBacktestOverfitting(matrix(1, 40, [0, 0]), 3)).toThrow(RangeError);
    expect(() => probabilityOfBacktestOverfitting(matrix(1, 3, [0, 0]), 4)).toThrow(RangeError);
    const a = summariseReturnBlocks([0.01, 0.02, -0.01, 0.03, 0.0, 0.01], 2);
    const b = summariseReturnBlocks([0.01, 0.02, -0.01, 0.03, 0.0], 2);
    expect(() => pboFromBlockStats([a, b])).toThrow(/same non-empty blocks/);
  });
});

describe("CSCV blocks", () => {
  it("cuts returns into contiguous blocks whose sizes differ by at most one and whose totals add up", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const next = rng(seed);
      const blocks = 2 * (1 + Math.floor(next() * 8));
      const returns = Array.from({ length: blocks + Math.floor(next() * 200) }, () => normal(next) * 0.01);
      const stats = summariseReturnBlocks(returns, blocks);
      const counts = stats.map((s) => s.count);
      expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
      expect(counts.reduce((s, c) => s + c, 0)).toBe(returns.length);
      expect(stats.reduce((s, b) => s + b.sum, 0)).toBeCloseTo(returns.reduce((s, r) => s + r, 0), 12);
      // Contiguity: block b starts where block b - 1 ended.
      let start = 0;
      for (const s of stats) {
        expect(s.sum).toBeCloseTo(returns.slice(start, start + s.count).reduce((acc, r) => acc + r, 0), 12);
        start += s.count;
      }
    }
  });

  it("uses the largest even block count up to 16 that leaves four observations per block", () => {
    expect([7, 8, 15, 16, 63, 64, 1000].map((t) => cscvBlockCount(t, 2))).toEqual([0, 2, 2, 4, 14, 16, 16]);
  });

  it("uses fewer blocks for large grids so one PBO stays cheap", () => {
    // C(16,8) = 12870 splits x 8 blocks per side: 29 candidates fit the budget, 30 do not.
    expect([29, 30, 124, 125, 500].map((n) => cscvBlockCount(1000, n))).toEqual([16, 14, 14, 12, 12]);
  });
});
