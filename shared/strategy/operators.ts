/**
 * Operator semantics for the Strategy AST.
 *
 * Each operator is defined precisely. CROSS_ABOVE and CROSS_BELOW require
 * two bars of data (previous + current). RISING/FALLING also require two bars.
 * Single-bar operators only need the current bar.
 */

import type { StrategyOperator } from "./ast";

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
