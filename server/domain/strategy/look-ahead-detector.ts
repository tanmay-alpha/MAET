/**
 * Look-Ahead Detector — verifies that a backtest engine produces no look-ahead bias.
 *
 * Method: For each bar T, mutate all candle data AFTER T, re-run the engine,
 * and assert that signals through bar T are identical. Any difference indicates
 * future data dependency.
 *
 * Used in unit tests and optional pre-run validation.
 */

import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

export interface LookAheadTestResult {
  passed: boolean;
  violatingBar?: number;
  detail?: string;
}

/** Interface for a run function that returns signal timestamps */
export type SignalRunFn = (candles: Candle[], definition: StrategyDefinition) => number[];

/**
 * Test look-ahead invariant:
 * For a random selection of pivot bars T, mutate all bars after T and verify
 * that signals through T are unchanged.
 */
export function testLookAhead(
  candles: Candle[],
  definition: StrategyDefinition,
  runFn: SignalRunFn,
  pivotBars: number[] = [],
): LookAheadTestResult {
  if (candles.length < 5) {
    return { passed: true }; // Not enough bars to test
  }

  // Default: test at 25%, 50%, 75% bar positions
  const pivotsToTest = pivotBars.length > 0
    ? pivotBars
    : [
        Math.floor(candles.length * 0.25),
        Math.floor(candles.length * 0.50),
        Math.floor(candles.length * 0.75),
      ];

  // Baseline signals on full candle series
  const baselineSignals = runFn(candles, definition);

  for (const pivotBar of pivotsToTest) {
    if (pivotBar <= 0 || pivotBar >= candles.length - 1) continue;

    // Mutate: replace all bars after pivotBar with sentinel values
    const mutatedCandles = candles.map((c, i) => {
      if (i <= pivotBar) return c;
      return {
        ...c,
        open: 99999.99,
        high: 99999.99,
        low: 99999.99,
        close: 99999.99,
        volume: 9999999,
      };
    });

    const mutatedSignals = runFn(mutatedCandles, definition);

    // Signals at or before pivotBar timestamp must be identical
    const pivotTs = new Date(candles[pivotBar].ts).getTime();

    const baselineBefore = baselineSignals.filter((ts) => ts <= pivotTs);
    const mutatedBefore = mutatedSignals.filter((ts) => ts <= pivotTs);

    if (baselineBefore.length !== mutatedBefore.length) {
      return {
        passed: false,
        violatingBar: pivotBar,
        detail: `Signal count differs at pivot bar ${pivotBar}: baseline=${baselineBefore.length}, mutated=${mutatedBefore.length}`,
      };
    }

    for (let j = 0; j < baselineBefore.length; j++) {
      if (baselineBefore[j] !== mutatedBefore[j]) {
        return {
          passed: false,
          violatingBar: pivotBar,
          detail: `Signal timestamp mismatch at index ${j}: ${baselineBefore[j]} vs ${mutatedBefore[j]}`,
        };
      }
    }
  }

  return { passed: true };
}
