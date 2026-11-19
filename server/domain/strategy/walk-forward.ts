/**
 * Leakage-Free 3-Phase Walk-Forward Analysis Engine — MAET P2.
 *
 * 1. Windows (`generate3PhaseWalkForwardWindows`): each window is three adjacent calendar-day spans
 *    of the requested lengths:
 *    - Training (in sample): every parameter set of the grid is backtested and the best training
 *      Sharpe is selected. This is a retrospective best-of-N selection, so training metrics are
 *      optimistically biased.
 *    - Validation (out-of-sample holdout): vetoes the selected set if its Sharpe is below -1. It
 *      never chooses parameters.
 *    - Test (out of sample): the selected set trades only if validation accepted it.
 *    Windows advance by the test length, so test segments tile the range without overlap and the
 *    last one ends at the range end. ROLLING training keeps its length; ANCHORED training always
 *    starts at the range start.
 * 2. Zero-leakage invariants:
 *    - Training end <= Validation start; Validation end <= Test start.
 *    - Each phase sees only candles up to its own end. Up to `warmupBars` earlier candles warm up
 *      indicators (they are in the past, so no leakage) but are never traded.
 * 3. Cash-or-trade policy: a window whose parameters were rejected (or could not be selected or
 *    tested) holds cash for its test segment. It adds a flat segment to the stitched OOS curve and
 *    counts in every OOS aggregate with zero return, so rejection cannot hide losses.
 * 4. Reporting:
 *    - Per-window training (IS) / validation / test (OOS) metrics.
 *    - Stitched OOS curve metrics (return, CAGR, Sharpe, max drawdown) over all test segments.
 *    - Walk-Forward Efficiency WFE = mean OOS annualised return (all windows, cash = 0) / mean IS
 *      annualised return (windows with a selection). Undefined (null, with a reason) when the
 *      in-sample mean is <= 0 or no window selected parameters.
 *    - Performance retention = the same ratio of Sharpe ratios.
 *    - Buy-and-hold benchmark of the same symbol over the same OOS dates with the strategy's own
 *      execution and cost settings.
 */

import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { runBacktestV3, type V3BacktestRunResult, type V3TradeRecord } from "./runner-v3";
import { applyParameters, generateCombinations, MAX_SWEEP_COMBINATIONS, type SweepParameter } from "./parameter-sweep";
import { computeMetrics, type EquityPoint } from "../backtest/risk-metrics";

// ============================================================
// Contracts & Types
// ============================================================

export type WalkForwardWindowType = "ANCHORED" | "ROLLING";

/** Lengths of a window's phases, in calendar days. Windows advance by `testDays`. */
export interface WalkForwardSpans {
  trainingDays: number;
  validationDays: number;
  testDays: number;
}

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

/** What the test segment held: the selected strategy, or cash. */
export type OosPosition = "STRATEGY" | "CASH";

export interface WalkForwardWindowResult {
  windowNumber: number;
  /** Phase spans; every `to` is exclusive. */
  trainDates: { from: string; to: string };
  valDates: { from: string; to: string };
  testDates: { from: string; to: string };
  /** Best training Sharpe of the grid; null when no parameter set could be selected. */
  selectedParameters: Record<string, number> | null;
  validationAccepted: boolean;
  /** Why validation rejected the window, or why no parameters were selected. */
  rejectionReason: string | null;
  /** In-sample metrics of the retrospectively selected parameter set. */
  isMetrics: WindowMetricsSummary | null;
  valMetrics: WindowMetricsSummary | null;
  oosPosition: OosPosition;
  /** Why the test segment sat in cash; null when the strategy traded it. */
  cashReason: string | null;
  /** Test-segment metrics; a cash segment has zero return, Sharpe, drawdown and trades. */
  oosMetrics: WindowMetricsSummary;
  oosEquityCurve: EquityPoint[];
}

export interface WalkForwardAnalysisInput extends WalkForwardSpans {
  strategyVersionId: string;
  definition: StrategyDefinition;
  symbol: string;
  candles: Candle[];
  parameters: SweepParameter[];
  windowType?: WalkForwardWindowType;
  /** At most this many windows, the most recent ones. Default: every window that fits. */
  maxWindows?: number;
  /** Start of the analysed range. Default: the first candle. */
  rangeStart?: Date;
  /** Exclusive end of the analysed range. Default: just after the last candle. */
  rangeEnd?: Date;
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

/** How the run was set up and what each phase's numbers mean. */
export interface WalkForwardMethodology extends WalkForwardSpans {
  windowType: WalkForwardWindowType;
  dayBasis: "CALENDAR";
  stepDays: number;
  selection: {
    sample: "IN_SAMPLE";
    method: "RETROSPECTIVE_BEST_TRAINING_SHARPE";
    /** Parameter sets backtested per window; the best of them is selected. */
    trialsPerWindow: number;
  };
  validation: { sample: "OUT_OF_SAMPLE_HOLDOUT"; rule: "VETO_IF_SHARPE_BELOW"; sharpeFloor: number };
  test: { sample: "OUT_OF_SAMPLE" };
  rejectedWindowPolicy: "CASH";
}

/** Buy-and-hold of the analysed symbol over the stitched OOS dates, with the strategy's costs. */
export interface WalkForwardBenchmark {
  kind: "BUY_AND_HOLD";
  from: string;
  to: string;
  totalReturn: number;
  annualisedReturn: number;
  sharpe: number;
  maxDrawdown: number;
  tradeCount: number;
}

export interface WalkForwardAnalysisResult {
  strategyVersionId: string;
  symbol: string;
  windowType: WalkForwardWindowType;
  /** null only for runs stored before the methodology was recorded. */
  methodology: WalkForwardMethodology | null;
  windows: WalkForwardWindowResult[];
  /** Every test segment in order: traded segments compound, cash segments stay flat. */
  aggregateOosEquityCurve: EquityPoint[];
  benchmark: WalkForwardBenchmark | null;
  benchmarkReason: string | null;
  summary: {
    /** In-sample means over windows that selected parameters (retrospective, biased upwards). */
    isReturnAvg: number;
    isAnnualisedAvg: number | null;
    isSharpeAvg: number;
    isDrawdownAvg: number;
    /** Stitched OOS curve. */
    oosReturnTotal: number;
    oosAnnualisedReturn: number | null;
    oosSharpe: number | null;
    oosDrawdownMax: number;
    /** Per-window OOS means over every window; cash windows count as 0. */
    oosAnnualisedAvg: number | null;
    oosSharpeAvg: number;
    /** mean OOS Sharpe / mean IS Sharpe; null when undefined. */
    performanceRetention: number | null;
    performanceRetentionReason: string | null;
    /** mean OOS annualised return / mean IS annualised return; null when undefined. */
    walkForwardEfficiency: number | null;
    walkForwardEfficiencyReason: string | null;
    acceptedWindowsCount: number;
    /** Windows whose test segment the strategy traded. */
    testedWindowsCount: number;
    /** Windows whose test segment sat in cash. */
    cashWindowsCount: number;
    totalWindowsCount: number;
  };
  warnings: string[];
}

/** Validation Sharpe below this rejects the window's parameters as overfit. */
export const VALIDATION_SHARPE_FLOOR = -1.0;
const DEFAULT_WARMUP_BARS = 250;
/** Combinations optimised per window: the first ones of the (at most MAX_SWEEP_COMBINATIONS) grid. */
const MAX_COMBINATIONS = 100;
/** Fewest bars a training / validation phase needs before the window selects parameters. */
const MIN_TRAINING_BARS = 20;
const MIN_VALIDATION_BARS = 5;
export const DAY_MS = 86_400_000;

const CASH_METRICS: WindowMetricsSummary = { totalReturn: 0, annualisedReturn: 0, sharpe: 0, maxDrawdown: 0, tradeCount: 0, winRate: 0 };

// ============================================================
// Window Generator
// ============================================================

function spanMs(spans: WalkForwardSpans) {
  return { train: spans.trainingDays * DAY_MS, val: spans.validationDays * DAY_MS, test: spans.testDays * DAY_MS };
}

/** Windows of the given spans that fit in a range of `rangeMs` milliseconds. */
export function countWalkForwardWindows(rangeMs: number, spans: WalkForwardSpans): number {
  const { train, val, test } = spanMs(spans);
  if (!(train > 0 && val > 0 && test > 0)) return 0;
  const first = train + val + test;
  if (!(rangeMs >= first)) return 0;
  return Math.floor((rangeMs - first) / test) + 1;
}

/** The engine range [rangeStart, rangeEnd) of an API run whose `to` date is inclusive. */
export function walkForwardRange(from: Date, toInclusive: Date): { rangeStart: Date; rangeEnd: Date } {
  return { rangeStart: from, rangeEnd: new Date(toInclusive.getTime() + 1) };
}

/**
 * The phase spans of an API run (`trainingWindowDays`, `validationWindowDays`; stored as
 * `training_days`, `validation_days`): the validation span is also the out-of-sample test span, so
 * windows step forward by it.
 */
export function walkForwardRunSpans(run: { trainingDays: number; validationDays: number }): WalkForwardSpans {
  return { trainingDays: run.trainingDays, validationDays: run.validationDays, testDays: run.validationDays };
}

/**
 * Train -> validation -> test windows over [rangeStart, rangeEnd). Test segments are `testDays`
 * long, adjacent and end at `rangeEnd`; when `maxWindows` is below what fits, the most recent
 * windows are kept.
 */
export function generate3PhaseWalkForwardWindows(
  rangeStart: Date,
  rangeEnd: Date,
  windowType: WalkForwardWindowType,
  spans: WalkForwardSpans,
  maxWindows?: number,
): WalkForward3PhaseWindow[] {
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  const fit = countWalkForwardWindows(endMs - startMs, spans);
  const count = maxWindows === undefined ? fit : Math.max(0, Math.min(fit, Math.floor(maxWindows)));
  const { train, val, test } = spanMs(spans);

  const windows: WalkForward3PhaseWindow[] = [];
  for (let i = 0; i < count; i++) {
    const testEnd = endMs - (count - 1 - i) * test;
    const testStart = testEnd - test;
    const valStart = testStart - val;
    const trainStart = windowType === "ANCHORED" ? startMs : valStart - train;
    windows.push({
      windowNumber: i + 1,
      trainStart: new Date(trainStart),
      trainEnd: new Date(valStart),
      valStart: new Date(valStart),
      valEnd: new Date(testStart),
      testStart: new Date(testStart),
      testEnd: new Date(testEnd),
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

/**
 * The strategy's own execution and cost settings, fully invested long from the first bar to the
 * last, with no stops or exits.
 */
export function buyAndHoldDefinition(definition: StrategyDefinition): StrategyDefinition {
  return {
    name: `${definition.name} buy-and-hold`,
    direction: "LONG_ONLY",
    timeframe: definition.timeframe,
    entry: {
      kind: "GROUP", id: "buy-and-hold-entry", combinator: "AND",
      children: [{ kind: "CONDITION", id: "always", left: { kind: "PRICE", field: "CLOSE" }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 0 } }],
    },
    exit: { kind: "GROUP", id: "buy-and-hold-exit", combinator: "OR", children: [] },
    risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
    execution: definition.execution,
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

  const spans: WalkForwardSpans = { trainingDays: input.trainingDays, validationDays: input.validationDays, testDays: input.testDays };
  const windowType = input.windowType ?? "ROLLING";
  const warmupBars = input.warmupBars ?? DEFAULT_WARMUP_BARS;
  const initialCap = input.initialCapital ?? definition.execution?.initialCapital ?? 100000;

  const rangeStart = input.rangeStart ?? new Date(sortedMs[0]);
  const rangeEnd = input.rangeEnd ?? new Date(sortedMs[sortedMs.length - 1] + 1);
  const windows = generate3PhaseWalkForwardWindows(rangeStart, rangeEnd, windowType, spans, input.maxWindows);
  if (windows.length === 0) {
    throw new Error(
      `Date range is too short for one walk-forward window of ${spans.trainingDays} training + ${spans.validationDays} validation + ${spans.testDays} test days`,
    );
  }
  // Grids above MAX_SWEEP_COMBINATIONS throw; of an accepted grid only the first MAX_COMBINATIONS
  // are optimised (the run dialog tells the user so).
  const combinations = generateCombinations(parameters, MAX_SWEEP_COMBINATIONS).slice(0, MAX_COMBINATIONS);
  // Invalid parameter paths throw here, before any window runs.
  const candidates = combinations.map((combo) => ({ combo, definition: applyParameters(definition, parameters, combo) }));

  /** Index of the first candle at or after `ms` (sorted.length when none). */
  const firstAtOrAfter = (ms: number) => {
    const i = sortedMs.findIndex((t) => t >= ms);
    return i === -1 ? sorted.length : i;
  };
  /** Backtests [fromMs, toMs) with up to warmupBars of earlier history. */
  const runPhase = (def: StrategyDefinition, fromMs: number, toMs: number, capital?: number) => {
    const firstIdx = firstAtOrAfter(fromMs);
    const endIdx = firstAtOrAfter(toMs);
    return runBacktestV3({
      strategyVersionId: input.strategyVersionId,
      definition: def,
      symbol,
      candles: sorted.slice(Math.max(0, firstIdx - warmupBars), endIdx),
      overrideCapital: capital,
      timeframe: input.timeframe,
      tradeFrom: sortedMs[firstIdx],
    });
  };

  const windowResults: WalkForwardWindowResult[] = [];
  const allOosPoints: EquityPoint[] = [];
  const allOosTrades: V3TradeRecord[] = [];
  let runningOosEquity = initialCap;

  for (const w of windows) {
    const trainStartMs = w.trainStart.getTime();
    const valStartMs = w.valStart.getTime();
    const testStartMs = w.testStart.getTime();
    const testEndMs = w.testEnd.getTime();
    const between = (from: number, to: number) => sorted.filter((_, i) => sortedMs[i] >= from && sortedMs[i] < to);

    const trainCandles = between(trainStartMs, valStartMs);
    const valCandles = between(valStartMs, testStartMs);
    const testCandles = between(testStartMs, testEndMs);

    // Guard against look-ahead data leakage
    assertNoDataLeakage(trainCandles, valCandles, testCandles);

    if (testCandles.length === 0) {
      warnings.push(`Window ${w.windowNumber} skipped: no candles in its test segment`);
      continue;
    }

    let best: { combo: Record<string, number>; definition: StrategyDefinition; metrics: WindowMetricsSummary } | null = null;
    let valMetrics: WindowMetricsSummary | null = null;
    let rejectionReason: string | null = null;

    if (trainCandles.length < MIN_TRAINING_BARS || valCandles.length < MIN_VALIDATION_BARS) {
      rejectionReason = `too few candles to select parameters (${trainCandles.length} training, ${valCandles.length} validation; need ${MIN_TRAINING_BARS} and ${MIN_VALIDATION_BARS})`;
    } else {
      // 1. Training: pick the parameter set with the best in-sample Sharpe
      const trainErrors: string[] = [];
      for (const candidate of candidates) {
        try {
          const metrics = summarise(runPhase(candidate.definition, trainStartMs, valStartMs));
          if (!best || metrics.sharpe > best.metrics.sharpe) best = { ...candidate, metrics };
        } catch (err) {
          trainErrors.push(errorMessage(err));
        }
        await yieldControl();
      }
      if (!best) {
        rejectionReason = `every training run failed (${trainErrors[0] ?? "no parameter combinations"})`;
      } else {
        if (trainErrors.length > 0) {
          warnings.push(`Window ${w.windowNumber}: ${trainErrors.length} of ${candidates.length} training runs failed (${trainErrors[0]})`);
        }
        // 2. Validation: reject parameters that collapse on unseen data
        try {
          valMetrics = summarise(runPhase(best.definition, valStartMs, testStartMs));
          if (valMetrics.sharpe < VALIDATION_SHARPE_FLOOR) {
            rejectionReason = `validation Sharpe ${valMetrics.sharpe.toFixed(2)} is below ${VALIDATION_SHARPE_FLOOR}`;
          }
        } catch (err) {
          rejectionReason = `validation run failed: ${errorMessage(err)}`;
        }
        await yieldControl();
      }
    }
    if (rejectionReason) warnings.push(`Window ${w.windowNumber} rejected: ${rejectionReason}; its test segment holds cash`);

    // 3. Test: accepted parameters trade out of sample; anything else holds cash
    let cashReason = rejectionReason;
    let oosMetrics = CASH_METRICS;
    let oosCurve: EquityPoint[] = [];
    if (best && !rejectionReason) {
      try {
        const testRes = runPhase(best.definition, testStartMs, testEndMs, runningOosEquity);
        oosMetrics = summarise(testRes);
        oosCurve = testRes.equityCurve;
        allOosTrades.push(...testRes.trades);
      } catch (err) {
        cashReason = `out-of-sample run failed: ${errorMessage(err)}`;
        warnings.push(`Window ${w.windowNumber}: ${cashReason}; its test segment holds cash`);
      }
      await yieldControl();
    }
    if (cashReason) {
      // Flat at the running equity on every test bar, starting from the as-of mark before it.
      const firstIdx = firstAtOrAfter(testStartMs);
      const markMs = firstIdx > 0 ? sortedMs[firstIdx - 1] : null;
      oosCurve = [
        ...(markMs === null ? [] : [{ timestamp: markMs, equity: runningOosEquity }]),
        ...testCandles.map((c) => ({ timestamp: new Date(c.ts).getTime(), equity: runningOosEquity })),
      ];
    }
    runningOosEquity = oosCurve[oosCurve.length - 1].equity;
    // The first point is the as-of mark before the segment; later segments continue the curve.
    allOosPoints.push(...(allOosPoints.length === 0 ? oosCurve : oosCurve.slice(1)));

    windowResults.push({
      windowNumber: w.windowNumber,
      trainDates: { from: w.trainStart.toISOString(), to: w.trainEnd.toISOString() },
      valDates: { from: w.valStart.toISOString(), to: w.valEnd.toISOString() },
      testDates: { from: w.testStart.toISOString(), to: w.testEnd.toISOString() },
      selectedParameters: best?.combo ?? null,
      validationAccepted: best !== null && rejectionReason === null,
      rejectionReason,
      isMetrics: best?.metrics ?? null,
      valMetrics,
      oosPosition: cashReason ? "CASH" : "STRATEGY",
      cashReason,
      oosMetrics,
      oosEquityCurve: oosCurve,
    });
  }

  // 4. Benchmark: buy-and-hold over exactly the stitched OOS dates, same costs and capital
  let benchmark: WalkForwardBenchmark | null = null;
  let benchmarkReason: string | null = null;
  if (windowResults.length === 0) {
    benchmarkReason = "No test segment had candles";
  } else {
    const fromMs = new Date(windowResults[0].testDates.from).getTime();
    const toMs = new Date(windowResults[windowResults.length - 1].testDates.to).getTime();
    try {
      const bh = runPhase(buyAndHoldDefinition(definition), fromMs, toMs, initialCap);
      benchmark = {
        kind: "BUY_AND_HOLD",
        from: new Date(fromMs).toISOString(),
        to: new Date(toMs).toISOString(),
        totalReturn: bh.metrics.totalReturn,
        annualisedReturn: bh.metrics.annualisedReturn,
        sharpe: bh.metrics.sharpe,
        maxDrawdown: bh.metrics.maxDrawdown,
        tradeCount: bh.tradeCount,
      };
    } catch (err) {
      benchmarkReason = `buy-and-hold run failed: ${errorMessage(err)}`;
    }
    await yieldControl();
  }

  // 5. Summary. In-sample over windows that selected parameters; out of sample over every window.
  const selected = windowResults.filter((w): w is WalkForwardWindowResult & { isMetrics: WindowMetricsSummary } => w.isMetrics !== null);
  const isReturnAvg = average(selected.map((w) => w.isMetrics.totalReturn));
  const isAnnualisedAvg = average(selected.map((w) => w.isMetrics.annualisedReturn));
  const isSharpeAvg = average(selected.map((w) => w.isMetrics.sharpe));
  const isDrawdownAvg = average(selected.map((w) => w.isMetrics.maxDrawdown));
  const oosAnnualisedAvg = average(windowResults.map((w) => w.oosMetrics.annualisedReturn));
  const oosSharpeAvg = average(windowResults.map((w) => w.oosMetrics.sharpe));
  const stitched = computeMetrics(allOosPoints, allOosTrades, undefined, input.timeframe ?? "1d");
  const oosReturnTotal = (runningOosEquity - initialCap) / initialCap;

  let walkForwardEfficiency: number | null = null;
  let walkForwardEfficiencyReason: string | null = null;
  let performanceRetention: number | null = null;
  let performanceRetentionReason: string | null = null;
  if (selected.length === 0) {
    walkForwardEfficiencyReason = "No window selected parameters: there is no in-sample result to compare against";
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

  const testedWindowsCount = windowResults.filter((w) => w.oosPosition === "STRATEGY").length;
  return {
    strategyVersionId: input.strategyVersionId,
    symbol,
    windowType,
    methodology: {
      windowType,
      ...spans,
      dayBasis: "CALENDAR",
      stepDays: spans.testDays,
      selection: { sample: "IN_SAMPLE", method: "RETROSPECTIVE_BEST_TRAINING_SHARPE", trialsPerWindow: candidates.length },
      validation: { sample: "OUT_OF_SAMPLE_HOLDOUT", rule: "VETO_IF_SHARPE_BELOW", sharpeFloor: VALIDATION_SHARPE_FLOOR },
      test: { sample: "OUT_OF_SAMPLE" },
      rejectedWindowPolicy: "CASH",
    },
    windows: windowResults,
    aggregateOosEquityCurve: allOosPoints,
    benchmark,
    benchmarkReason,
    summary: {
      isReturnAvg,
      isAnnualisedAvg: selected.length > 0 ? isAnnualisedAvg : null,
      isSharpeAvg,
      isDrawdownAvg,
      oosReturnTotal,
      oosAnnualisedReturn: allOosPoints.length >= 2 ? stitched.annualisedReturn : null,
      oosSharpe: allOosPoints.length >= 2 ? stitched.sharpe : null,
      oosDrawdownMax: stitched.maxDrawdown,
      oosAnnualisedAvg: windowResults.length > 0 ? oosAnnualisedAvg : null,
      oosSharpeAvg,
      performanceRetention,
      performanceRetentionReason,
      walkForwardEfficiency,
      walkForwardEfficiencyReason,
      acceptedWindowsCount: windowResults.filter((w) => w.validationAccepted).length,
      testedWindowsCount,
      cashWindowsCount: windowResults.length - testedWindowsCount,
      totalWindowsCount: windowResults.length,
    },
    warnings,
  };
}
