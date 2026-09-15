/**
 * Leakage-Free 3-Phase Walk-Forward Analysis Engine — MAET P2.
 *
 * Implements an institutional-grade 3-phase rolling/anchored walk-forward engine:
 * 1. Window Partitioning:
 *    - Training: parameter optimization
 *    - Validation: parameter selection / overfit rejection
 *    - Test: out-of-sample performance evaluation
 * 2. Strict Zero-Leakage Invariants:
 *    - Training end timestamp <= Validation start timestamp
 *    - Validation end timestamp <= Test start timestamp
 *    - No test candle can ever enter training or validation indicator caches or parameter sweeps.
 * 3. In-Sample vs Out-of-Sample Reporting:
 *    - IS return vs OOS return
 *    - IS Sharpe vs OOS Sharpe
 *    - IS drawdown vs OOS drawdown
 *    - Performance retention ratio (OOS Sharpe / IS Sharpe)
 *    - Walk-Forward Efficiency (WFE) ratio
 * 4. Aggregate OOS concatenated equity curve.
 */

import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3 } from "./runner-v3";
import { generateCombinations, injectParametersIntoAST, type SweepParameterRange } from "../../workers/sweep-worker";
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
  isMetrics: WindowMetricsSummary;
  valMetrics: WindowMetricsSummary;
  oosMetrics: WindowMetricsSummary;
  oosEquityCurve: EquityPoint[];
}

export interface WalkForwardAnalysisInput {
  strategyVersionId: string;
  definition: StrategyDefinition;
  symbol: string;
  candles: Candle[];
  parameterRanges: SweepParameterRange[];
  numWindows?: number;
  windowType?: "ANCHORED" | "ROLLING";
  trainRatio?: number; // e.g. 0.6
  valRatio?: number;   // e.g. 0.2
  timeframe?: string;
  initialCapital?: number;
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
    performanceRetention: number; // oosSharpe / isSharpe
    walkForwardEfficiency: number; // oosReturn / isReturn
    acceptedWindowsCount: number;
    totalWindowsCount: number;
  };
  warnings: string[];
}

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

  const testRatio = Math.max(0.1, 1 - trainRatio - valRatio);
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

export function runWalkForwardAnalysis(input: WalkForwardAnalysisInput): WalkForwardAnalysisResult {
  const { definition, candles, symbol, parameterRanges } = input;
  const sorted = [...candles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const warnings: string[] = [];

  if (sorted.length < 90) {
    throw new Error(`Insufficient history for 3-phase walk-forward analysis: required at least 90 bars, got ${sorted.length}`);
  }

  const numWindows = input.numWindows ?? 4;
  const windowType = input.windowType ?? "ROLLING";
  const trainRatio = input.trainRatio ?? 0.6;
  const valRatio = input.valRatio ?? 0.2;
  const initialCap = input.initialCapital ?? definition.execution?.initialCapital ?? 100000;

  const startDate = new Date(sorted[0].ts);
  const endDate = new Date(sorted[sorted.length - 1].ts);
  const windows = generate3PhaseWalkForwardWindows(startDate, endDate, windowType, numWindows, trainRatio, valRatio);
  const combinations = generateCombinations(parameterRanges, 100);

  const windowResults: WalkForwardWindowResult[] = [];
  const allOosPoints: EquityPoint[] = [];
  let runningOosEquity = initialCap;

  for (let i = 0; i < windows.length; i++) {
    const w = windows[i];
    const trainStartMs = w.trainStart.getTime();
    const trainEndMs = w.trainEnd.getTime();
    const valStartMs = w.valStart.getTime();
    const valEndMs = w.valEnd.getTime();
    const testStartMs = w.testStart.getTime();
    const testEndMs = w.testEnd.getTime();

    // Slice candles strictly
    const trainCandles = sorted.filter((c) => {
      const t = new Date(c.ts).getTime();
      return t >= trainStartMs && t < trainEndMs;
    });

    const valCandles = sorted.filter((c) => {
      const t = new Date(c.ts).getTime();
      return t >= valStartMs && t < valEndMs;
    });

    const testCandles = sorted.filter((c) => {
      const t = new Date(c.ts).getTime();
      return t >= testStartMs && t <= testEndMs;
    });

    // Guard against look-ahead data leakage
    assertNoDataLeakage(trainCandles, valCandles, testCandles);

    if (trainCandles.length < 20 || valCandles.length < 10 || testCandles.length < 10) {
      warnings.push(`Window ${w.windowNumber} skipped due to sparse candles in window partition`);
      continue;
    }

    // 1. Training Phase: Sweep and optimize parameters on trainCandles only
    let bestTrainSharpe = -Infinity;
    let bestParams: Record<string, number> = {};
    let bestTrainMetrics: WindowMetricsSummary = { totalReturn: 0, sharpe: 0, maxDrawdown: 0, tradeCount: 0, winRate: 0 };

    for (const combo of combinations) {
      const modDef = injectParametersIntoAST(definition, combo);
      try {
        const trainRes = runBacktestV3({
          strategyVersionId: input.strategyVersionId,
          definition: modDef,
          symbol,
          candles: trainCandles,
          timeframe: input.timeframe,
        });

        if (trainRes.metrics.sharpe > bestTrainSharpe) {
          bestTrainSharpe = trainRes.metrics.sharpe;
          bestParams = combo;
          bestTrainMetrics = {
            totalReturn: trainRes.metrics.totalReturn,
            sharpe: trainRes.metrics.sharpe,
            maxDrawdown: trainRes.metrics.maxDrawdown,
            tradeCount: trainRes.tradeCount,
            winRate: trainRes.metrics.winRate,
          };
        }
      } catch {
        // Skip combo if insufficient history inside window
      }
    }

    // 2. Validation Phase: Evaluate selected bestParams on valCandles
    const selectedDef = injectParametersIntoAST(definition, bestParams);
    let valMetrics: WindowMetricsSummary = { totalReturn: 0, sharpe: 0, maxDrawdown: 0, tradeCount: 0, winRate: 0 };
    let validationAccepted = true;

    try {
      const valRes = runBacktestV3({
        strategyVersionId: input.strategyVersionId,
        definition: selectedDef,
        symbol,
        candles: valCandles,
        timeframe: input.timeframe,
      });

      valMetrics = {
        totalReturn: valRes.metrics.totalReturn,
        sharpe: valRes.metrics.sharpe,
        maxDrawdown: valRes.metrics.maxDrawdown,
        tradeCount: valRes.tradeCount,
        winRate: valRes.metrics.winRate,
      };

      // Overfit rejection: if validation performance is catastrophically negative, reject window
      if (valRes.metrics.sharpe < -1.0) {
        validationAccepted = false;
        warnings.push(`Window ${w.windowNumber} rejected: validation Sharpe (${valRes.metrics.sharpe.toFixed(2)}) failed threshold`);
      }
    } catch {
      validationAccepted = false;
    }

    // 3. Test Phase: Evaluate strictly out-of-sample on testCandles
    let oosMetrics: WindowMetricsSummary = { totalReturn: 0, sharpe: 0, maxDrawdown: 0, tradeCount: 0, winRate: 0 };
    let oosCurve: EquityPoint[] = [];

    try {
      const testRes = runBacktestV3({
        strategyVersionId: input.strategyVersionId,
        definition: selectedDef,
        symbol,
        candles: testCandles,
        overrideCapital: runningOosEquity,
        timeframe: input.timeframe,
      });

      oosMetrics = {
        totalReturn: testRes.metrics.totalReturn,
        sharpe: testRes.metrics.sharpe,
        maxDrawdown: testRes.metrics.maxDrawdown,
        tradeCount: testRes.tradeCount,
        winRate: testRes.metrics.winRate,
      };

      oosCurve = testRes.equityCurve;
      if (oosCurve.length > 0) {
        runningOosEquity = oosCurve[oosCurve.length - 1].equity;
        // Append points for aggregate OOS equity curve
        for (const pt of oosCurve) {
          allOosPoints.push(pt);
        }
      }
    } catch {
      // Test window error
    }

    windowResults.push({
      windowNumber: w.windowNumber,
      trainDates: { from: w.trainStart.toISOString(), to: w.trainEnd.toISOString() },
      valDates: { from: w.valStart.toISOString(), to: w.valEnd.toISOString() },
      testDates: { from: w.testStart.toISOString(), to: w.testEnd.toISOString() },
      selectedParameters: bestParams,
      validationAccepted,
      isMetrics: bestTrainMetrics,
      valMetrics,
      oosMetrics,
      oosEquityCurve: oosCurve,
    });
  }

  // Summary aggregation
  const validWindows = windowResults.filter((w) => w.oosMetrics.tradeCount > 0 || w.oosMetrics.totalReturn !== 0);
  const isReturnAvg = validWindows.length > 0
    ? validWindows.reduce((s, w) => s + w.isMetrics.totalReturn, 0) / validWindows.length
    : 0;
  const oosReturnTotal = runningOosEquity > 0 ? (runningOosEquity - initialCap) / initialCap : 0;
  const isSharpeAvg = validWindows.length > 0
    ? validWindows.reduce((s, w) => s + w.isMetrics.sharpe, 0) / validWindows.length
    : 0;
  const oosSharpeAvg = validWindows.length > 0
    ? validWindows.reduce((s, w) => s + w.oosMetrics.sharpe, 0) / validWindows.length
    : 0;
  const isDrawdownAvg = validWindows.length > 0
    ? validWindows.reduce((s, w) => s + w.isMetrics.maxDrawdown, 0) / validWindows.length
    : 0;
  const oosDrawdownMax = validWindows.length > 0
    ? Math.max(...validWindows.map((w) => w.oosMetrics.maxDrawdown))
    : 0;

  const performanceRetention = isSharpeAvg !== 0 ? oosSharpeAvg / Math.max(0.01, isSharpeAvg) : 0;
  const walkForwardEfficiency = isReturnAvg !== 0 ? oosReturnTotal / Math.max(0.001, isReturnAvg) : 0;

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
      walkForwardEfficiency,
      acceptedWindowsCount: windowResults.filter((w) => w.validationAccepted).length,
      totalWindowsCount: windowResults.length,
    },
    warnings,
  };
}
