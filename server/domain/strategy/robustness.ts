/**
 * Parameter Robustness and Stability Analysis Engine — MAET P2.
 *
 * Implements rigorous diagnostic safeguards against curve-fitting and isolated parameter spikes:
 * 1. Neighbor parameter stability: Evaluates whether performance is sustained across adjacent parameter values (plateau vs fragile spike).
 * 2. Documented robustness score (0–100):
 *    - neighborStabilityScore (40%)
 *    - sampleSizeScore (25%)
 *    - drawdownStabilityScore (20%)
 *    - costDragScore (15%)
 * 3. Safeguard warning flags:
 *    - LOW_SAMPLE_SIZE (trade count < 30)
 *    - OVERFIT_RISK (isolated spike surrounded by poor neighbors)
 *    - PARAMETER_INSTABILITY (high neighbor variance or steep cliff)
 *    - HIGH_COST_DRAG (transaction costs consuming > 25% of gross profit)
 * 4. Parameter heatmap / 2D matrix projection for UI visualization.
 */

import type { SweepParameterRange } from "../../workers/sweep-worker";

export interface SweepPointResult {
  params: Record<string, number>;
  sharpe: number;
  totalReturn: number;
  maxDrawdown: number;
  tradeCount: number;
  costDragPercent?: number;
}

export interface RobustnessScoreBreakdown {
  neighborStabilityScore: number; // 0-100
  sampleSizeScore: number; // 0-100
  drawdownStabilityScore: number; // 0-100
  costDragScore: number; // 0-100
  overallRobustnessScore: number; // 0-100 weighted average
}

export type RobustnessFlag =
  | "LOW_SAMPLE_SIZE"
  | "OVERFIT_RISK"
  | "PARAMETER_INSTABILITY"
  | "HIGH_COST_DRAG";

export interface ParameterStabilityAnalysis {
  bestParams: Record<string, number>;
  bestSharpe: number;
  neighborAverageSharpe: number;
  isFragileSpike: boolean;
  neighborCount: number;
  robustnessScore: RobustnessScoreBreakdown;
  flags: RobustnessFlag[];
  heatmapMatrix?: Array<{
    paramX: number;
    paramY: number;
    sharpe: number;
    totalReturn: number;
  }>;
}

/**
 * Finds neighboring parameter combinations that differ by at most 1 step in parameter ranges.
 */
export function findNeighbors(
  targetParams: Record<string, number>,
  allPoints: SweepPointResult[],
  ranges?: SweepParameterRange[],
): SweepPointResult[] {
  const stepMap: Record<string, number> = {};
  if (ranges) {
    for (const r of ranges) {
      stepMap[r.name] = r.step > 0 ? r.step : 1;
    }
  }

  return allPoints.filter((pt) => {
    // Cannot be identical to target
    let isIdentical = true;
    let distanceCount = 0;

    for (const [key, val] of Object.entries(targetParams)) {
      const ptVal = pt.params[key];
      if (ptVal === undefined) return false;

      const step = stepMap[key] ?? 1;
      const diff = Math.abs(ptVal - val);

      if (diff > 1e-6) {
        isIdentical = false;
        // Check if within 1 step (with small float tolerance)
        if (diff <= step * 1.5) {
          distanceCount += 1;
        } else {
          return false; // too far
        }
      }
    }

    // Must not be identical, and should differ by at most 2 parameter steps
    return !isIdentical && distanceCount >= 1 && distanceCount <= 2;
  });
}

/**
 * Performs full parameter robustness and stability analysis.
 */
export function analyzeParameterStability(
  points: SweepPointResult[],
  ranges?: SweepParameterRange[],
): ParameterStabilityAnalysis {
  if (!points || points.length === 0) {
    return {
      bestParams: {},
      bestSharpe: 0,
      neighborAverageSharpe: 0,
      isFragileSpike: false,
      neighborCount: 0,
      robustnessScore: {
        neighborStabilityScore: 0,
        sampleSizeScore: 0,
        drawdownStabilityScore: 0,
        costDragScore: 0,
        overallRobustnessScore: 0,
      },
      flags: ["LOW_SAMPLE_SIZE"],
    };
  }

  // 1. Find best parameter combination by Sharpe ratio
  let best = points[0];
  for (let i = 1; i < points.length; i++) {
    if (points[i].sharpe > best.sharpe) {
      best = points[i];
    }
  }

  const flags: RobustnessFlag[] = [];

  // 2. Neighbor stability analysis
  const neighbors = findNeighbors(best.params, points, ranges);
  const neighborSharpes = neighbors.map((n) => n.sharpe);

  let neighborAvgSharpe = best.sharpe;
  let neighborVariance = 0;

  if (neighbors.length > 0) {
    neighborAvgSharpe = neighborSharpes.reduce((s, v) => s + v, 0) / neighbors.length;
    const mean = neighborAvgSharpe;
    neighborVariance = neighborSharpes.reduce((s, v) => s + Math.pow(v - mean, 2), 0) / neighbors.length;
  }

  // Fragile spike detection:
  // If best Sharpe > 1.5 but neighbors average < 0.5 or drop by more than 50%
  const isFragileSpike =
    best.sharpe > 1.0 &&
    neighbors.length > 0 &&
    (neighborAvgSharpe < 0.5 * best.sharpe || neighborAvgSharpe <= 0);

  if (isFragileSpike) {
    flags.push("OVERFIT_RISK");
    flags.push("PARAMETER_INSTABILITY");
  } else if (neighbors.length > 0 && neighborVariance > 1.0) {
    flags.push("PARAMETER_INSTABILITY");
  }

  // 3. Trade count sufficiency
  if (best.tradeCount < 30) {
    flags.push("LOW_SAMPLE_SIZE");
  }

  // 4. Cost drag check
  const costDrag = best.costDragPercent ?? 0;
  if (costDrag > 25) {
    flags.push("HIGH_COST_DRAG");
  }

  // 5. Compute Component Robustness Scores (0-100)
  // A. Neighbor stability score
  let neighborStabilityScore = 70;
  if (neighbors.length > 0) {
    if (best.sharpe > 0) {
      const retentionRatio = Math.max(0, Math.min(1.2, neighborAvgSharpe / best.sharpe));
      neighborStabilityScore = Math.round(retentionRatio * 85);
    } else {
      neighborStabilityScore = 30;
    }
    if (isFragileSpike) {
      neighborStabilityScore = Math.min(25, neighborStabilityScore);
    }
  }
  neighborStabilityScore = Math.max(0, Math.min(100, neighborStabilityScore));

  // B. Sample size score (scales up to 100 for 100+ trades)
  const sampleSizeScore = Math.max(0, Math.min(100, Math.round((best.tradeCount / 60) * 100)));

  // C. Drawdown stability score (100 for 0% DD, 0 for 50%+ DD)
  const ddPct = best.maxDrawdown * 100;
  const drawdownStabilityScore = Math.max(0, Math.min(100, Math.round(100 - ddPct * 1.5)));

  // D. Cost drag score (100 for 0% cost drag, 0 for 50%+ cost drag)
  const costDragScore = Math.max(0, Math.min(100, Math.round(100 - costDrag * 2)));

  // Overall Robustness Score: weighted average
  const overallRobustnessScore = Math.round(
    neighborStabilityScore * 0.4 +
      sampleSizeScore * 0.25 +
      drawdownStabilityScore * 0.2 +
      costDragScore * 0.15,
  );

  return {
    bestParams: best.params,
    bestSharpe: Number(best.sharpe.toFixed(4)),
    neighborAverageSharpe: Number(neighborAvgSharpe.toFixed(4)),
    isFragileSpike,
    neighborCount: neighbors.length,
    robustnessScore: {
      neighborStabilityScore,
      sampleSizeScore,
      drawdownStabilityScore,
      costDragScore,
      overallRobustnessScore,
    },
    flags,
  };
}

/**
 * Builds a 2D parameter heatmap matrix for UI visualization.
 */
export function build2DParameterHeatmap(
  points: SweepPointResult[],
  paramXName: string,
  paramYName: string,
): Array<{ paramX: number; paramY: number; sharpe: number; totalReturn: number }> {
  return points
    .filter((p) => p.params[paramXName] !== undefined && p.params[paramYName] !== undefined)
    .map((p) => ({
      paramX: p.params[paramXName],
      paramY: p.params[paramYName],
      sharpe: Number(p.sharpe.toFixed(2)),
      totalReturn: Number((p.totalReturn * 100).toFixed(2)),
    }));
}
