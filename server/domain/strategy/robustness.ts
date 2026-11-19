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
 * 5. Probability of backtest overfitting by combinatorially symmetric cross-validation (CSCV).
 */

/** Grid spacing of one swept parameter; neighbours differ from the best point by about one step. */
export interface ParameterStep {
  name: string;
  step: number;
}

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
  ranges?: ParameterStep[],
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
  ranges?: ParameterStep[],
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

// ============================================================
// Probability of Backtest Overfitting (CSCV)
// ============================================================

/** Sufficient statistics of one candidate's per-period returns inside one CSCV block. */
export interface ReturnBlockStats {
  count: number;
  sum: number;
  sumSquares: number;
}

export interface PboResult {
  /** Share of IS/OOS splits whose in-sample winner ranks at or below the OOS median (logit <= 0). */
  pbo: number;
  /** Candidates (parameter sets) the in-sample winner was picked from. */
  trials: number;
  /** S: contiguous blocks the observations were cut into. */
  blocks: number;
  /** C(S, S/2): in-sample / out-of-sample splits evaluated. */
  splits: number;
  /** Median logit of the winner's OOS relative rank; > 0 means it usually beats the OOS median. */
  medianLogit: number;
}

export const DEFAULT_CSCV_BLOCKS = 16;

/** Cuts `returns` into `blocks` contiguous blocks; block b holds indices [floor(bT/S), floor((b+1)T/S)). */
export function summariseReturnBlocks(returns: readonly number[], blocks: number): ReturnBlockStats[] {
  const stats = Array.from({ length: blocks }, () => ({ count: 0, sum: 0, sumSquares: 0 }));
  returns.forEach((r, t) => {
    const b = stats[Math.floor((t * blocks) / returns.length)];
    b.count += 1;
    b.sum += r;
    b.sumSquares += r * r;
  });
  return stats;
}

/** Block sums one PBO may add up (splits x candidates x S/2): about 20 ms, cheap enough for a request. */
const CSCV_WORK_BUDGET = 3_000_000;

/**
 * Largest even block count S <= 16 that leaves `minPerBlock` observations per block and keeps
 * C(S, S/2) splits over `candidates` within the work budget; 0 when no S >= 2 qualifies.
 */
export function cscvBlockCount(observations: number, candidates: number, minPerBlock = 4): number {
  for (let s = DEFAULT_CSCV_BLOCKS; s >= 2; s -= 2) {
    let splits = 1;
    for (let k = 1; k <= s / 2; k++) splits = (splits * (s / 2 + k)) / k;
    if (observations / s >= minPerBlock && splits * candidates * (s / 2) <= CSCV_WORK_BUDGET) return s;
  }
  return 0;
}

/** Per-period Sharpe ratio (mean / sample standard deviation) from sufficient statistics. */
function sharpeFromStats(count: number, sum: number, sumSquares: number): number {
  const mean = sum / count;
  const variance = count > 1 ? Math.max(0, (sumSquares - sum * mean) / (count - 1)) : 0;
  if (variance > 0) return mean / Math.sqrt(variance);
  return mean > 0 ? Infinity : mean < 0 ? -Infinity : 0;
}

/**
 * Probability of Backtest Overfitting by combinatorially symmetric cross-validation (Bailey,
 * Borwein, López de Prado and Zhu, 2015) from per-candidate block statistics: `candidates[n][b]`
 * summarises candidate n's returns in block b, and every candidate uses the same blocks.
 *
 * For each of the C(S, S/2) ways to pick half the blocks as in-sample (the rest out of sample), the
 * candidate with the best in-sample Sharpe is found; its out-of-sample relative rank
 * w = rank / (N + 1) (rank 1 = worst, ties averaged) gives the logit l = ln(w / (1 - w)). PBO is
 * the share of splits with l <= 0. Null when there are fewer than two candidates.
 */
export function pboFromBlockStats(candidates: readonly (readonly ReturnBlockStats[])[]): PboResult | null {
  const n = candidates.length;
  if (n < 2) return null;
  const s = candidates[0].length;
  if (s < 2 || s % 2 !== 0 || s > 24) throw new RangeError(`CSCV needs an even block count between 2 and 24, got ${s}`);
  for (const blocks of candidates) {
    if (blocks.length !== s) throw new RangeError("Every candidate must have the same number of blocks");
    blocks.forEach((b, i) => {
      if (b.count !== candidates[0][i].count || b.count < 1) throw new RangeError("Candidates must share the same non-empty blocks");
    });
  }

  // Blocks are shared, so a split's observation counts are the same for every candidate.
  const blockCounts = candidates[0].map((b) => b.count);
  const totalCount = blockCounts.reduce((t, c) => t + c, 0);
  const sums = new Float64Array(n * s);
  const squares = new Float64Array(n * s);
  const totalSums = new Float64Array(n);
  const totalSquares = new Float64Array(n);
  candidates.forEach((blocks, c) => blocks.forEach((b, i) => {
    sums[c * s + i] = b.sum;
    squares[c * s + i] = b.sumSquares;
    totalSums[c] += b.sum;
    totalSquares[c] += b.sumSquares;
  }));
  const isSharpe = new Float64Array(n);
  const oosSharpe = new Float64Array(n);
  const logits: number[] = [];
  const chosen: number[] = [];

  for (let mask = 0; mask < 1 << s; mask++) {
    chosen.length = 0;
    for (let b = 0; b < s; b++) if (mask & (1 << b)) chosen.push(b);
    if (chosen.length !== s / 2) continue;
    let count = 0;
    for (const b of chosen) count += blockCounts[b];

    let best = 0;
    for (let c = 0; c < n; c++) {
      let sum = 0;
      let sumSquares = 0;
      for (const b of chosen) {
        sum += sums[c * s + b];
        sumSquares += squares[c * s + b];
      }
      isSharpe[c] = sharpeFromStats(count, sum, sumSquares);
      oosSharpe[c] = sharpeFromStats(totalCount - count, totalSums[c] - sum, totalSquares[c] - sumSquares);
      if (isSharpe[c] > isSharpe[best]) best = c;
    }

    let below = 0;
    let ties = 0;
    for (let c = 0; c < n; c++) {
      if (c === best) continue;
      if (oosSharpe[c] < oosSharpe[best]) below += 1;
      else if (oosSharpe[c] === oosSharpe[best]) ties += 1;
    }
    const omega = (1 + below + ties / 2) / (n + 1);
    logits.push(Math.log(omega / (1 - omega)));
  }

  const sorted = [...logits].sort((a, b) => a - b);
  const mid = sorted.length / 2;
  return {
    pbo: logits.filter((l) => l <= 0).length / logits.length,
    trials: n,
    blocks: s,
    splits: logits.length,
    medianLogit: sorted.length % 2 === 1 ? sorted[Math.floor(mid)] : (sorted[mid - 1] + sorted[mid]) / 2,
  };
}

/**
 * PBO of a T x N matrix of per-period returns (`returns[t][n]`: period t of candidate n), split into
 * `blocks` contiguous blocks of (near-)equal length. Null when there are fewer than two candidates.
 */
export function probabilityOfBacktestOverfitting(
  returns: readonly (readonly number[])[],
  blocks: number = DEFAULT_CSCV_BLOCKS,
): PboResult | null {
  const t = returns.length;
  const n = t > 0 ? returns[0].length : 0;
  if (t < blocks) throw new RangeError(`CSCV needs at least one observation per block: ${t} observations, ${blocks} blocks`);
  if (returns.some((row) => row.length !== n)) throw new RangeError("Every period must have a return for every candidate");
  const perCandidate = Array.from({ length: n }, (_, c) => summariseReturnBlocks(returns.map((row) => row[c]), blocks));
  return pboFromBlockStats(perCandidate);
}
