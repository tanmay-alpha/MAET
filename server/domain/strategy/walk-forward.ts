/**
 * Leakage-Free 3-Phase Walk-Forward Analysis Engine — MAET P2.
 *
 * 1. Window Partitioning: each window is split into
 *    - Training: parameter optimisation (best Sharpe across the sweep grid)
 *    - Validation: overfit rejection of the selected parameters
 *    - Test: out-of-sample evaluation, only for windows that pass validation
 * 2. Zero-leakage invariants:
 *    - Training end <= Validation start; Validation end <= Test start.
 *    - Each phase sees only candles up to its own end. Up to `warmupBars` earlier candles warm up
 *      indicators (they are in the past, so no leakage) but are never traded.
 * 3. Reporting:
 *    - Per-window IS / validation / OOS metrics.
 *    - Walk-Forward Efficiency WFE = mean OOS annualised return / mean IS annualised return over
 *      tested windows (annualised so phases of different lengths compare). Undefined (null, with a
 *      reason) when the in-sample return is <= 0 or no window was tested.
 *    - Performance retention = mean OOS Sharpe / mean IS Sharpe, undefined when IS Sharpe <= 0.
 * 4. Aggregate OOS equity curve: tested windows compound; a rejected window sits in cash.
 */

import type { Candle } from "@shared/types";
import { DEFAULT_INITIAL_CAPITAL_INR, type StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3, type V3BacktestRunResult } from "./runner-v3";
import { applyParameters, generateCombinations, type SweepParameter } from "./parameter-sweep";
import type { EquityPoint } from "../backtest/risk-metrics";

// ============================================================
// Contracts & Types
// ============================================================

export interface WalkForward3PhaseWindow {
  windowNumber: number;
  trainStart: Date;
  trainEnd: Date;
  valStart: Date;
  valEnd: Date;
  testStart: Date;
  testEnd: Date;
}

export interface WindowMetricsSummary {
  totalReturn: number;
  annualisedReturn: number;
  sharpe: number;
  maxDrawdown: number;
  tradeCount: number;
  winRate: number;
}

export interface WalkForwardWindowResult {
  windowNumber: number;
  trainDates: { from: string; to: string };
  valDates: { from: string; to: string };
  testDates: { from: string; to: string };
  selectedParameters: Record<string, number>;
  validationAccepted: boolean;
  /** Why validation rejected the window (threshold breach or validation run error). */
  rejectionReason: string | null;
  isMetrics: WindowMetricsSummary;
  valMetrics: WindowMetricsSummary | null;
  /** null when the window was not tested out of sample (rejected, or the test run failed). */
  oosMetrics: WindowMetricsSummary | null;
  oosEquityCurve: EquityPoint[];
}

export interface WalkForwardAnalysisInput {
  strategyVersionId: string;
  definition: StrategyDefinition;
  symbol: string;
  candles: Candle[];
  parameters: SweepParameter[];
  numWindows?: number;
  windowType?: "ANCHORED" | "ROLLING";
  trainRatio?: number; // e.g. 0.6
  valRatio?: number;   // e.g. 0.2
  timeframe?: string;
  initialCapital?: number;
  /** Earlier candles used only to warm up indicators at the start of each phase. Default 250. */
  warmupBars?: number;
}

export interface WalkForwardRunOptions {
  /**
   * Awaited after every backtest (outside the per-run error handling) so a caller sharing the
   * process with an API server can hand control back to the event loop, and can abort the
   * analysis by throwing.
   */
  yieldControl?: () => Promise<void>;
}

export interface WalkForwardAnalysisResult {
  strategyVersionId: string;
  symbol: string;
  windowType: "ANCHORED" | "ROLLING";
  windows: WalkForwardWindowResult[];
  aggregateOosEquityCurve: EquityPoint[];
  summary: {
    isReturnAvg: number;
    oosReturnTotal: number;
    isSharpeAvg: number;
    oosSharpeAvg: number;
    isDrawdownAvg: number;
    oosDrawdownMax: number;
    /** mean OOS Sharpe / mean IS Sharpe; null when IS Sharpe <= 0 or nothing was tested. */
    performanceRetention: number | null;
    performanceRetentionReason: string | null;
    /** mean OOS annualised return / mean IS annualised return; null when undefined. */
    walkForwardEfficiency: number | null;
    walkForwardEfficiencyReason: string | null;
    acceptedWindowsCount: number;
    testedWindowsCount: number;
    totalWindowsCount: number;
  };
  warnings: string[];
}

/** Validation Sharpe below this rejects the window's parameters as overfit. */
const VALIDATION_SHARPE_FLOOR = -1.0;
const DEFAULT_WARMUP_BARS = 250;
const MAX_COMBINATIONS = 100;

// ============================================================
// Window Generator
// ============================================================

export function generate3PhaseWalkForwardWindows(
  startDate: Date,
  endDate: Date,
  windowType: "ANCHORED" | "ROLLING",
  numWindows: number,
  trainRatio = 0.6,
  valRatio = 0.2,
): WalkForward3PhaseWindow[] {
  const totalMs = endDate.getTime() - startDate.getTime();
  if (totalMs <= 0 || numWindows <= 0) return [];

  const windowSpanMs = Math.floor(totalMs / numWindows);
  const windows: WalkForward3PhaseWindow[] = [];

  for (let i = 0; i < numWindows; i++) {
    const windowStart = windowType === "ANCHORED"
      ? startDate
      : new Date(startDate.getTime() + i * windowSpanMs);

    const windowEnd = new Date(startDate.getTime() + (i + 1) * windowSpanMs);
    const windowDuration = windowEnd.getTime() - windowStart.getTime();

    const trainDuration = Math.floor(windowDuration * trainRatio);
    const valDuration = Math.floor(windowDuration * valRatio);

    const trainStart = windowStart;
    const trainEnd = new Date(windowStart.getTime() + trainDuration);
    const valStart = trainEnd;
    const valEnd = new Date(valStart.getTime() + valDuration);
    const testStart = valEnd;
    const testEnd = windowEnd;

    windows.push({
      windowNumber: i + 1,
      trainStart,
      trainEnd,
      valStart,
      valEnd,
      testStart,
      testEnd,
    });
  }

  return windows;
}

// ============================================================
// Leakage Detection Guard
// ============================================================

export function assertNoDataLeakage(
  trainCandles: Candle[],
  valCandles: Candle[],
  testCandles: Candle[],
): void {
  if (trainCandles.length === 0 || valCandles.length === 0 || testCandles.length === 0) return;

  const trainMaxTs = new Date(trainCandles[trainCandles.length - 1].ts).getTime();
  const valMinTs = new Date(valCandles[0].ts).getTime();
  const valMaxTs = new Date(valCandles[valCandles.length - 1].ts).getTime();
  const testMinTs = new Date(testCandles[0].ts).getTime();

  if (trainMaxTs > valMinTs) {
    throw new Error(
      `DATA LEAKAGE DETECTED: Training candle (${new Date(trainMaxTs).toISOString()}) is newer than validation start (${new Date(valMinTs).toISOString()})`,
    );
  }

  if (valMaxTs > testMinTs) {
    throw new Error(
      `DATA LEAKAGE DETECTED: Validation candle (${new Date(valMaxTs).toISOString()}) is newer than test start (${new Date(testMinTs).toISOString()})`,
    );
  }
}

// ============================================================
// Walk-Forward Execution Engine
// ============================================================

function summarise(result: V3BacktestRunResult): WindowMetricsSummary {
  return {
    totalReturn: result.metrics.totalReturn,
    annualisedReturn: result.metrics.annualisedReturn,
    sharpe: result.metrics.sharpe,
    maxDrawdown: result.metrics.maxDrawdown,
    tradeCount: result.tradeCount,
    winRate: result.metrics.winRate,
  };
}

const average = (values: number[]) => (values.length > 0 ? values.reduce((s, v) => s + v, 0) / values.length : 0);
const errorMessage = (err: unknown) => (err instanceof Error ? err.message : String(err));

export async function runWalkForwardAnalysis(
  input: WalkForwardAnalysisInput,
  options: WalkForwardRunOptions = {},
): Promise<WalkForwardAnalysisResult> {
  const yieldControl = options.yieldControl ?? (async () => {});
  const { definition, candles, symbol, parameters } = input;
  const sorted = [...candles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const sortedMs = sorted.map((c) => new Date(c.ts).getTime());
  const warnings: string[] = [];

  if (sorted.length < 90) {
    throw new Error(`Insufficient history for 3-phase walk-forward analysis: required at least 90 bars, got ${sorted.length}`);
  }

  const numWindows = input.numWindows ?? 4;
  const windowType = input.windowType ?? "ROLLING";
  const trainRatio = input.trainRatio ?? 0.6;
  const valRatio = input.valRatio ?? 0.2;
  const warmupBars = input.warmupBars ?? DEFAULT_WARMUP_BARS;
  const initialCap = input.initialCapital ?? definition.execution?.initialCapital ?? DEFAULT_INITIAL_CAPITAL_INR;

  const startDate = new Date(sortedMs[0]);
  const endDate = new Date(sortedMs[sortedMs.length - 1]);
  const windows = generate3PhaseWalkForwardWindows(startDate, endDate, windowType, numWindows, trainRatio, valRatio);
  const combinations = generateCombinations(parameters, MAX_COMBINATIONS);
  // Invalid parameter paths throw here, before any window runs.
  const candidates = combinations.map((combo) => ({ combo, definition: applyParameters(definition, parameters, combo) }));

  /** Backtests [fromMs, toMs) (or [fromMs, toMs] when `inclusiveEnd`) with up to warmupBars of history. */
  const runPhase = (def: StrategyDefinition, fromMs: number, toMs: number, inclusiveEnd: boolean, capital?: number) => {
    const firstIdx = sortedMs.findIndex((t) => t >= fromMs);
    const endIdx = sortedMs.findIndex((t) => (inclusiveEnd ? t > toMs : t >= toMs));
    const phaseCandles = sorted.slice(Math.max(0, firstIdx - warmupBars), endIdx === -1 ? sorted.length : endIdx);
    return runBacktestV3({
      strategyVersionId: input.strategyVersionId,
      definition: def,
      symbol,
      candles: phaseCandles,
      overrideCapital: capital,
      timeframe: input.timeframe,
      tradeFrom: sortedMs[firstIdx],
    });
  };

  const windowResults: WalkForwardWindowResult[] = [];
  const allOosPoints: EquityPoint[] = [];
  let runningOosEquity = initialCap;

  for (const w of windows) {
    const trainStartMs = w.trainStart.getTime();
    const trainEndMs = w.trainEnd.getTime();
    const valStartMs = w.valStart.getTime();
    const valEndMs = w.valEnd.getTime();
    const testStartMs = w.testStart.getTime();
    const testEndMs = w.testEnd.getTime();

    const trainCandles = sorted.filter((_, i) => sortedMs[i] >= trainStartMs && sortedMs[i] < trainEndMs);
    const valCandles = sorted.filter((_, i) => sortedMs[i] >= valStartMs && sortedMs[i] < valEndMs);
    const testCandles = sorted.filter((_, i) => sortedMs[i] >= testStartMs && sortedMs[i] <= testEndMs);

    // Guard against look-ahead data leakage
    assertNoDataLeakage(trainCandles, valCandles, testCandles);

    if (trainCandles.length < 20 || valCandles.length < 10 || testCandles.length < 10) {
      warnings.push(`Window ${w.windowNumber} skipped due to sparse candles in window partition`);
      continue;
    }

    // 1. Training: pick the parameter set with the best in-sample Sharpe
    let best: { combo: Record<string, number>; definition: StrategyDefinition; metrics: WindowMetricsSummary } | null = null;
    const trainErrors: string[] = [];
    for (const candidate of candidates) {
      try {
        const metrics = summarise(runPhase(candidate.definition, trainStartMs, trainEndMs, false));
        if (!best || metrics.sharpe > best.metrics.sharpe) best = { ...candidate, metrics };
      } catch (err) {
        trainErrors.push(errorMessage(err));
      }
      await yieldControl();
    }
    if (!best) {
      warnings.push(`Window ${w.windowNumber} skipped: every training run failed (${trainErrors[0] ?? "no parameter combinations"})`);
      continue;
    }
    if (trainErrors.length > 0) {
      warnings.push(`Window ${w.windowNumber}: ${trainErrors.length} of ${candidates.length} training runs failed (${trainErrors[0]})`);
    }

    // 2. Validation: reject parameters that collapse on unseen data
    let valMetrics: WindowMetricsSummary | null = null;
    let rejectionReason: string | null = null;
    try {
      valMetrics = summarise(runPhase(best.definition, valStartMs, valEndMs, false));
      if (valMetrics.sharpe < VALIDATION_SHARPE_FLOOR) {
        rejectionReason = `validation Sharpe ${valMetrics.sharpe.toFixed(2)} is below ${VALIDATION_SHARPE_FLOOR}`;
      }
    } catch (err) {
      rejectionReason = `validation run failed: ${errorMessage(err)}`;
    }
    await yieldControl();
    if (rejectionReason) warnings.push(`Window ${w.windowNumber} rejected: ${rejectionReason}`);

    // 3. Test: only accepted parameters trade out of sample; a rejected window stays in cash
    let oosMetrics: WindowMetricsSummary | null = null;
    let oosCurve: EquityPoint[] = [];
    if (!rejectionReason) {
      try {
        const testRes = runPhase(best.definition, testStartMs, testEndMs, true, runningOosEquity);
        oosMetrics = summarise(testRes);
        oosCurve = testRes.equityCurve;
        runningOosEquity = oosCurve[oosCurve.length - 1].equity;
        // The first point is the as-of mark before the window; later windows continue the curve.
        allOosPoints.push(...(allOosPoints.length === 0 ? oosCurve : oosCurve.slice(1)));
      } catch (err) {
        warnings.push(`Window ${w.windowNumber}: out-of-sample run failed (${errorMessage(err)})`);
      }
      await yieldControl();
    }

    windowResults.push({
      windowNumber: w.windowNumber,
      trainDates: { from: w.trainStart.toISOString(), to: w.trainEnd.toISOString() },
      valDates: { from: w.valStart.toISOString(), to: w.valEnd.toISOString() },
      testDates: { from: w.testStart.toISOString(), to: w.testEnd.toISOString() },
      selectedParameters: best.combo,
      validationAccepted: rejectionReason === null,
      rejectionReason,
      isMetrics: best.metrics,
      valMetrics,
      oosMetrics,
      oosEquityCurve: oosCurve,
    });
  }

  // Summary over windows that were actually tested out of sample
  const tested = windowResults.filter((w): w is WalkForwardWindowResult & { oosMetrics: WindowMetricsSummary } => w.oosMetrics !== null);
  const isReturnAvg = average(tested.map((w) => w.isMetrics.totalReturn));
  const isAnnualisedAvg = average(tested.map((w) => w.isMetrics.annualisedReturn));
  const oosAnnualisedAvg = average(tested.map((w) => w.oosMetrics.annualisedReturn));
  const isSharpeAvg = average(tested.map((w) => w.isMetrics.sharpe));
  const oosSharpeAvg = average(tested.map((w) => w.oosMetrics.sharpe));
  const isDrawdownAvg = average(tested.map((w) => w.isMetrics.maxDrawdown));
  const oosDrawdownMax = tested.length > 0 ? Math.max(...tested.map((w) => w.oosMetrics.maxDrawdown)) : 0;
  const oosReturnTotal = (runningOosEquity - initialCap) / initialCap;

  let walkForwardEfficiency: number | null = null;
  let walkForwardEfficiencyReason: string | null = null;
  let performanceRetention: number | null = null;
  let performanceRetentionReason: string | null = null;
  if (tested.length === 0) {
    walkForwardEfficiencyReason = "No window passed validation and was tested out of sample";
    performanceRetentionReason = walkForwardEfficiencyReason;
  } else {
    if (isAnnualisedAvg > 0) {
      walkForwardEfficiency = oosAnnualisedAvg / isAnnualisedAvg;
    } else {
      walkForwardEfficiencyReason = `In-sample annualised return is ${(isAnnualisedAvg * 100).toFixed(2)}% (<= 0): efficiency is undefined`;
    }
    if (isSharpeAvg > 0) {
      performanceRetention = oosSharpeAvg / isSharpeAvg;
    } else {
      performanceRetentionReason = `In-sample Sharpe is ${isSharpeAvg.toFixed(2)} (<= 0): retention is undefined`;
    }
  }

  return {
    strategyVersionId: input.strategyVersionId,
    symbol,
    windowType,
    windows: windowResults,
    aggregateOosEquityCurve: allOosPoints,
    summary: {
      isReturnAvg,
      oosReturnTotal,
      isSharpeAvg,
      oosSharpeAvg,
      isDrawdownAvg,
      oosDrawdownMax,
      performanceRetention,
      performanceRetentionReason,
      walkForwardEfficiency,
      walkForwardEfficiencyReason,
      acceptedWindowsCount: windowResults.filter((w) => w.validationAccepted).length,
      testedWindowsCount: tested.length,
      totalWindowsCount: windowResults.length,
    },
    warnings,
  };
}
