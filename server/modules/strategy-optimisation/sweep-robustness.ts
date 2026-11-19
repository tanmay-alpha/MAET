/**
 * Robustness analysis of a finished parameter sweep, as returned by strategyOptimisation.getSweep:
 * parameter-neighbourhood stability plus the probability of backtest overfitting (CSCV) of picking
 * the best of the sweep's parameter sets.
 */

import {
  analyzeParameterStability,
  build2DParameterHeatmap,
  pboFromBlockStats,
  type ParameterStabilityAnalysis,
  type ParameterStep,
  type PboResult,
  type ReturnBlockStats,
  summariseReturnBlocks,
  type SweepPointResult,
} from "../../domain/strategy/robustness";
import type { SweepParameter } from "../../domain/strategy/parameter-sweep";

/** A stored strategy_sweep_results row (summary numbers are stored as fixed-point strings). */
export interface StoredSweepResult {
  parameterValues: unknown;
  resultSummary: unknown;
}

interface StoredSummary {
  sharpe: string;
  totalReturn: string;
  maxDrawdown: string;
  tradeCount: number;
  costDragPercent?: string;
  /** [count, sum, sumSquares] of per-bar returns per CSCV block; absent on older rows. */
  returnBlocks?: StoredReturnBlocks | null;
}

/** A result's per-bar returns per CSCV block, stored as [count, sum, sumSquares] triples. */
export type StoredReturnBlocks = Array<[number, number, number]>;

/**
 * The sweep job's stored form of an equity curve's per-bar returns cut into `blocks` CSCV blocks.
 * Null when the curve does not cover the expected bars (blocks would not line up across
 * combinations) or there are too few bars for CSCV (`blocks` is 0).
 */
export function equityReturnBlocks(equity: readonly number[], expectedReturns: number, blocks: number): StoredReturnBlocks | null {
  if (blocks === 0 || equity.length - 1 !== expectedReturns) return null;
  const returns = equity.slice(1).map((e, i) => (equity[i] > 0 ? e / equity[i] - 1 : 0));
  return summariseReturnBlocks(returns, blocks).map((b) => [b.count, b.sum, b.sumSquares]);
}

/**
 * How the sweep's "best" parameter set was chosen. Every sweep result is in sample: the best is a
 * retrospective pick of the highest Sharpe over the whole range among `trials` parameter sets, so its
 * metrics overstate what it would earn going forward.
 */
export interface SweepSelection {
  sample: "IN_SAMPLE";
  method: "RETROSPECTIVE_BEST_SHARPE";
  trials: number;
  /** Probability of backtest overfitting (CSCV); null with `pboReason` when it cannot be computed. */
  pbo: PboResult | null;
  pboReason: string | null;
}

export interface SweepRobustness {
  analysis: ParameterStabilityAnalysis;
  selection: SweepSelection;
  /** Parameters on the heatmap's axes (the first two swept); absent for a one-parameter sweep. */
  paramX?: string;
  paramY?: string;
}

/** Grid spacing of each swept parameter: the smallest gap between its distinct values. */
export function parameterSteps(parameters: readonly SweepParameter[]): ParameterStep[] {
  return parameters.map((p) => {
    const sorted = [...new Set(p.values)].sort((a, b) => a - b);
    const gaps = sorted.slice(1).map((v, i) => v - sorted[i]);
    return { name: p.name, step: gaps.length > 0 ? Math.min(...gaps) : 1 };
  });
}

/** Sweep results as robustness points; rows without a summary are skipped. */
export function sweepStabilityPoints(results: readonly StoredSweepResult[]): SweepPointResult[] {
  return results.flatMap((r) => {
    // Written by the sweep job (server/workers/sweep-worker.ts) in this shape.
    const summary = r.resultSummary as StoredSummary | null;
    if (!summary) return [];
    return [{
      params: r.parameterValues as Record<string, number>,
      sharpe: Number(summary.sharpe),
      totalReturn: Number(summary.totalReturn),
      maxDrawdown: Number(summary.maxDrawdown),
      tradeCount: summary.tradeCount,
      // Absent on rows written before the sweep job stored cost drag.
      costDragPercent: summary.costDragPercent == null ? undefined : Number(summary.costDragPercent),
    }];
  });
}

/** CSCV probability of backtest overfitting over the stored results' per-block returns. */
export function sweepSelection(results: readonly StoredSweepResult[]): SweepSelection {
  const summaries = results.flatMap((r) => (r.resultSummary ? [r.resultSummary as StoredSummary] : []));
  const base = { sample: "IN_SAMPLE", method: "RETROSPECTIVE_BEST_SHARPE", trials: summaries.length } as const;
  if (summaries.length < 2) return { ...base, pbo: null, pboReason: "PBO needs at least two parameter sets" };

  const blocks = summaries.flatMap((s) => (s.returnBlocks ? [s.returnBlocks] : []));
  if (blocks.length < summaries.length) {
    return { ...base, pbo: null, pboReason: "Some results have no per-period returns (too few bars, or stored before PBO was recorded)" };
  }
  const stats: ReturnBlockStats[][] = blocks.map((b) => b.map(([count, sum, sumSquares]) => ({ count, sum, sumSquares })));
  const layout = stats[0].map((b) => b.count).join(",");
  if (stats.some((s) => s.map((b) => b.count).join(",") !== layout)) {
    return { ...base, pbo: null, pboReason: "Results do not share the same return blocks" };
  }
  return { ...base, pbo: pboFromBlockStats(stats), pboReason: null };
}

/** Robustness analysis of a sweep's results; the heatmap covers the first two parameters. */
export function analyseSweepRobustness(parameters: readonly SweepParameter[], results: readonly StoredSweepResult[]): SweepRobustness {
  const points = sweepStabilityPoints(results);
  const analysis = analyzeParameterStability(points, parameterSteps(parameters));
  const selection = sweepSelection(results);
  if (parameters.length < 2) return { analysis, selection };
  const [x, y] = parameters;
  return { analysis: { ...analysis, heatmapMatrix: build2DParameterHeatmap(points, x.name, y.name) }, selection, paramX: x.name, paramY: y.name };
}
