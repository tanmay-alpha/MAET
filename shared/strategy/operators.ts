/**
 * Operator semantics for the Strategy AST.
 *
 * Each operator is defined precisely. CROSS_ABOVE and CROSS_BELOW require
 * two bars of data (previous + current). RISING/FALLING also require two bars.
 * Single-bar operators only need the current bar.
 */

import type { StrategyOperator, CrossOperator, TrendOperator } from "./ast";

/** Operators that require exactly two bars of resolved values */
export const TWO_BAR_OPERATORS: ReadonlySet<StrategyOperator> = new Set<StrategyOperator>([
  "CROSS_ABOVE",
  "CROSS_BELOW",
  "RISING",
  "FALLING",
]);

/** Operators requiring a rightHigh operand (range tests) */
export const RANGE_OPERATORS: ReadonlySet<StrategyOperator> = new Set<StrategyOperator>([
  "BETWEEN",
  "OUTSIDE",
]);

/** Operators requiring a percentValue field */
export const PERCENT_OPERATORS: ReadonlySet<StrategyOperator> = new Set<StrategyOperator>([
  "PERCENT_ABOVE",
  "PERCENT_BELOW",
]);

/**
 * Evaluate CROSS_ABOVE: previous left <= previous right AND current left > current right.
 * This is the canonical 2-bar cross definition. Do not use only current bar.
 */
export function evalCrossAbove(
  prevLeft: number, prevRight: number,
  currLeft: number, currRight: number,
): boolean {
  return prevLeft <= prevRight && currLeft > currRight;
}

/**
 * Evaluate CROSS_BELOW: previous left >= previous right AND current left < current right.
 */
export function evalCrossBelow(
  prevLeft: number, prevRight: number,
  currLeft: number, currRight: number,
): boolean {
  return prevLeft >= prevRight && currLeft < currRight;
}

/**
 * Evaluate RISING: current value > previous value.
 */
export function evalRising(prevValue: number, currValue: number): boolean {
  return currValue > prevValue;
}

/**
 * Evaluate FALLING: current value < previous value.
 */
export function evalFalling(prevValue: number, currValue: number): boolean {
  return currValue < prevValue;
}

/**
 * Evaluate BETWEEN: left > low AND left < high.
 */
export function evalBetween(left: number, low: number, high: number): boolean {
  return left > low && left < high;
}

/**
 * Evaluate OUTSIDE: left < low OR left > high.
 */
export function evalOutside(left: number, low: number, high: number): boolean {
  return left < low || left > high;
}

/**
 * Evaluate PERCENT_ABOVE: left > right * (1 + pct / 100).
 */
export function evalPercentAbove(left: number, right: number, pct: number): boolean {
  return left > right * (1 + pct / 100);
}

/**
 * Evaluate PERCENT_BELOW: left < right * (1 - pct / 100).
 */
export function evalPercentBelow(left: number, right: number, pct: number): boolean {
  return left < right * (1 - pct / 100);
}

/**
 * Evaluate EQUAL_WITH_TOLERANCE: |left - right| <= right * 0.001 (0.1% tolerance).
 */
export function evalEqualWithTolerance(left: number, right: number, tolerance = 0.001): boolean {
  if (right === 0) return left === 0;
  return Math.abs(left - right) <= Math.abs(right) * tolerance;
}

/**
 * Evaluate any single-bar operator (except cross/rising/falling which need two bars).
 */
export function evalSingleBarOperator(
  op: Exclude<StrategyOperator, CrossOperator | TrendOperator>,
  left: number,
  right: number,
  rightHigh?: number,
  pct?: number,
): boolean {
  switch (op) {
    case "GREATER_THAN": return left > right;
    case "GREATER_THAN_OR_EQUAL": return left >= right;
    case "LESS_THAN": return left < right;
    case "LESS_THAN_OR_EQUAL": return left <= right;
    case "EQUAL_WITH_TOLERANCE": return evalEqualWithTolerance(left, right);
    case "BETWEEN": return evalBetween(left, right, rightHigh ?? right);
    case "OUTSIDE": return evalOutside(left, right, rightHigh ?? right);
    case "PERCENT_ABOVE": return evalPercentAbove(left, right, pct ?? 0);
    case "PERCENT_BELOW": return evalPercentBelow(left, right, pct ?? 0);
    default: return false;
  }
}
