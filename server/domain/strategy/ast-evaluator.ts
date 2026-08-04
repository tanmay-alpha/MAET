/**
 * Strategy AST Evaluator for Backtest Engine V3.
 *
 * Evaluates StrategyRuleGroup trees against an IndicatorStateCache at a specific bar.
 * Strictly no future bar access — all indexing bounded to currentBarIndex.
 * Cross/trend operators require two bars (i and i-1).
 */

import type {
  StrategyRuleGroup,
  StrategyCondition,
  StrategyOperand,
  StrategyOperator,
} from "../../../shared/strategy/ast";
import { TWO_BAR_OPERATORS, RANGE_OPERATORS, PERCENT_OPERATORS } from "../../../shared/strategy/operators";
import type { IndicatorStateCache } from "./indicator-state";

// ============================================================
// Resolve operand value at a specific bar
// ============================================================

function resolveOperand(
  operand: StrategyOperand,
  cache: IndicatorStateCache,
  barIndex: number,
  lag = 0,
): number | null {
  const effectiveLag = (operand.kind !== "CONSTANT" ? (operand.lag ?? 0) : 0) + lag;
  switch (operand.kind) {
    case "CONSTANT":
      return operand.value;
    case "PRICE":
      return cache.resolvePrice(operand.field, barIndex, effectiveLag);
    case "MARKET":
      return cache.resolveMarket(operand.field, barIndex, effectiveLag);
    case "INDICATOR":
      return cache.resolve(operand.indicator, operand.params, barIndex, effectiveLag);
  }
}

// ============================================================
// Evaluate condition at barIndex
// ============================================================

function evalCondition(
  condition: StrategyCondition,
  cache: IndicatorStateCache,
  barIndex: number,
): boolean {
  const op = condition.operator;

  if (TWO_BAR_OPERATORS.has(op)) {
    // Need both current and previous bar values
    if (barIndex < 1) return false;

    const currLeft = resolveOperand(condition.left, cache, barIndex, 0);
    const currRight = resolveOperand(condition.right, cache, barIndex, 0);
    const prevLeft = resolveOperand(condition.left, cache, barIndex, 1);
    const prevRight = resolveOperand(condition.right, cache, barIndex, 1);

    if (currLeft === null || currRight === null || prevLeft === null || prevRight === null) return false;

    switch (op as "CROSS_ABOVE" | "CROSS_BELOW" | "RISING" | "FALLING") {
      case "CROSS_ABOVE": return prevLeft <= prevRight && currLeft > currRight;
      case "CROSS_BELOW": return prevLeft >= prevRight && currLeft < currRight;
      case "RISING": return currLeft > prevLeft;
      case "FALLING": return currLeft < prevLeft;
    }
  }

  const left = resolveOperand(condition.left, cache, barIndex, 0);
  const right = resolveOperand(condition.right, cache, barIndex, 0);

  if (left === null || right === null) return false;

  if (RANGE_OPERATORS.has(op)) {
    const rightHigh = condition.rightHigh
      ? resolveOperand(condition.rightHigh, cache, barIndex, 0)
      : right;
    if (rightHigh === null) return false;
    if (op === "BETWEEN") return left > right && left < rightHigh;
    if (op === "OUTSIDE") return left < right || left > rightHigh;
    return false;
  }

  if (PERCENT_OPERATORS.has(op)) {
    const pct = condition.percentValue ?? 0;
    if (op === "PERCENT_ABOVE") return left > right * (1 + pct / 100);
    if (op === "PERCENT_BELOW") return left < right * (1 - pct / 100);
    return false;
  }

  switch (op as Exclude<StrategyOperator, "CROSS_ABOVE" | "CROSS_BELOW" | "RISING" | "FALLING" | "BETWEEN" | "OUTSIDE" | "PERCENT_ABOVE" | "PERCENT_BELOW">) {
    case "GREATER_THAN": return left > right;
    case "GREATER_THAN_OR_EQUAL": return left >= right;
    case "LESS_THAN": return left < right;
    case "LESS_THAN_OR_EQUAL": return left <= right;
    case "EQUAL_WITH_TOLERANCE": {
      if (right === 0) return left === 0;
      return Math.abs(left - right) <= Math.abs(right) * 0.001;
    }
    default: return false;
  }
}

// ============================================================
// Evaluate rule group (recursive)
// ============================================================

function evalGroup(
  group: StrategyRuleGroup,
  cache: IndicatorStateCache,
  barIndex: number,
): boolean {
  const results = group.children.map((child) => {
    if (child.kind === "CONDITION") return evalCondition(child, cache, barIndex);
    return evalGroup(child, cache, barIndex);
  });

  let combined: boolean;
  if (group.combinator === "AND") {
    combined = results.every(Boolean);
  } else {
    combined = results.some(Boolean);
  }

  return group.negate ? !combined : combined;
}

// ============================================================
// Public API
// ============================================================

export interface AstEvalResult {
  matched: boolean;
  barIndex: number;
}

/**
 * Evaluate an entry or exit rule group at bar index i.
 * No future bars are ever accessed.
 */
export function evaluateRuleGroup(
  group: StrategyRuleGroup,
  cache: IndicatorStateCache,
  barIndex: number,
): AstEvalResult {
  const matched = evalGroup(group, cache, barIndex);
  return { matched, barIndex };
}
