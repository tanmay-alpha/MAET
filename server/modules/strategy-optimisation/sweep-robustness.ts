/**
 * Robustness analysis of a finished parameter sweep, as returned by strategyOptimisation.getSweep.
 */

import {
  analyzeParameterStability,
  build2DParameterHeatmap,
  type ParameterStabilityAnalysis,
  type ParameterStep,
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
}

export interface SweepRobustness {
  analysis: ParameterStabilityAnalysis;
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
    }];
  });
}

/** Robustness analysis of a sweep's results; the heatmap covers the first two parameters. */
export function analyseSweepRobustness(parameters: readonly SweepParameter[], results: readonly StoredSweepResult[]): SweepRobustness {
  const points = sweepStabilityPoints(results);
  const analysis = analyzeParameterStability(points, parameterSteps(parameters));
  if (parameters.length < 2) return { analysis };
  const [x, y] = parameters;
  return { analysis: { ...analysis, heatmapMatrix: build2DParameterHeatmap(points, x.name, y.name) }, paramX: x.name, paramY: y.name };
}
