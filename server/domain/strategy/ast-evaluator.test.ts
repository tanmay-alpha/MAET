/**
 * AST Evaluator unit tests.
 * Verifies: CROSS_ABOVE, CROSS_BELOW, RISING, FALLING, comparison operators,
 * BETWEEN, OUTSIDE, PERCENT_ABOVE/BELOW, negate, null propagation.
 */

import { describe, expect, it } from "bun:test";
import { evaluateRuleGroup } from "./ast-evaluator";
import { IndicatorStateCache } from "./indicator-state";
import type { StrategyRuleGroup } from "../../../shared/strategy/ast";
import type { Candle } from "../../.." // shared/types/market

// ============================================================
// Test helpers
// ============================================================

function makeCandles(closes: number[], extras?: Partial<Candle>[]): Candle[] {
  return closes.map((close, i) => ({
    symbol: "TEST",
    tf: "1d" as const,
    ts: new Date(Date.UTC(2023, 0, i + 1)).toISOString(),
    open: close - 1,
    high: close + 2,
    low: close - 3,
    close,
    volume: 100_000,
    source: "test",
    ...((extras?.[i]) ?? {}),
  }));
}

function makeSingleCondition(
  leftClose: { lag?: number },
  operator: string,
  rightValue: number,
): StrategyRuleGroup {
  return {
    kind: "GROUP",
    id: "root",
    combinator: "AND",
    children: [{
      kind: "CONDITION",
      id: "c1",
      left: { kind: "PRICE", field: "CLOSE", lag: leftClose.lag ?? 0 },
      operator: operator as any,
      right: { kind: "CONSTANT", value: rightValue },
    }],
  };
}

// ============================================================
// Tests
// ============================================================

describe("AST Evaluator", () => {
  describe("GREATER_THAN / LESS_THAN", () => {
    it("returns true when close > threshold", () => {
      const candles = makeCandles([100, 110, 120]);
      const cache = new IndicatorStateCache(candles);
      const rule = makeSingleCondition({}, "GREATER_THAN", 105);
      const result = evaluateRuleGroup(rule, cache, 2);
      expect(result.matched).toBe(true);
    });

    it("returns false when close <= threshold", () => {
      const candles = makeCandles([100, 90, 95]);
      const cache = new IndicatorStateCache(candles);
      const rule = makeSingleCondition({}, "GREATER_THAN", 100);
      const result = evaluateRuleGroup(rule, cache, 2);
      expect(result.matched).toBe(false);
    });

    it("LESS_THAN: returns true when close < threshold", () => {
      const candles = makeCandles([100, 90, 80]);
      const cache = new IndicatorStateCache(candles);
      const rule = makeSingleCondition({}, "LESS_THAN", 85);
      const result = evaluateRuleGroup(rule, cache, 2);
      expect(result.matched).toBe(true);
    });
  });

  describe("CROSS_ABOVE", () => {
    it("fires when left crosses above right (prev <= right, curr > right)", () => {
      const candles = makeCandles([90, 100, 110]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "CROSS_ABOVE",
          right: { kind: "CONSTANT", value: 95 },
        }],
      };
      // At bar 1: prev=90 <= 95, curr=100 > 95 → TRUE
      expect(evaluateRuleGroup(rule, cache, 1).matched).toBe(true);
      // At bar 2: prev=100 > 95 → not a fresh cross → FALSE
      expect(evaluateRuleGroup(rule, cache, 2).matched).toBe(false);
    });

    it("does NOT fire if already above threshold (no previous cross)", () => {
      const candles = makeCandles([110, 120, 130]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "CROSS_ABOVE",
          right: { kind: "CONSTANT", value: 105 },
        }],
      };
      // Already above at bar 0, so no cross at bar 1
      expect(evaluateRuleGroup(rule, cache, 1).matched).toBe(false);
    });

    it("returns false at bar 0 (no previous bar)", () => {
      const candles = makeCandles([100]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "CROSS_ABOVE",
          right: { kind: "CONSTANT", value: 90 },
        }],
      };
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(false);
    });
  });

  describe("CROSS_BELOW", () => {
    it("fires when left crosses below right", () => {
      const candles = makeCandles([110, 100, 90]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "CROSS_BELOW",
          right: { kind: "CONSTANT", value: 105 },
        }],
      };
      // Bar 1: prev=110 >= 105, curr=100 < 105 → TRUE
      expect(evaluateRuleGroup(rule, cache, 1).matched).toBe(true);
      expect(evaluateRuleGroup(rule, cache, 2).matched).toBe(false);
    });
  });

  describe("RISING / FALLING", () => {
    it("RISING: curr > prev", () => {
      const candles = makeCandles([90, 100, 110]);
      const cache = new IndicatorStateCache(candles);
      const rule = makeSingleCondition({}, "RISING", 0);
      // RISING ignores 'right' - uses left only
      const risingRule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "RISING",
          right: { kind: "CONSTANT", value: 0 },
        }],
      };
      expect(evaluateRuleGroup(risingRule, cache, 2).matched).toBe(true);
    });

    it("FALLING: curr < prev", () => {
      const candles = makeCandles([110, 100, 90]);
      const cache = new IndicatorStateCache(candles);
      const fallingRule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "FALLING",
          right: { kind: "CONSTANT", value: 0 },
        }],
      };
      expect(evaluateRuleGroup(fallingRule, cache, 2).matched).toBe(true);
    });
  });

  describe("BETWEEN / OUTSIDE", () => {
    it("BETWEEN: true when value is between low and high", () => {
      const candles = makeCandles([100]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "BETWEEN",
          right: { kind: "CONSTANT", value: 90 },
          rightHigh: { kind: "CONSTANT", value: 110 },
        }],
      };
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(true);
    });

    it("OUTSIDE: true when value is outside range", () => {
      const candles = makeCandles([150]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "OUTSIDE",
          right: { kind: "CONSTANT", value: 90 },
          rightHigh: { kind: "CONSTANT", value: 110 },
        }],
      };
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(true);
    });
  });

  describe("Logical combinators", () => {
    it("AND: all conditions must be true", () => {
      const candles = makeCandles([100]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [
          { kind: "CONDITION", id: "c1", left: { kind: "PRICE", field: "CLOSE" }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 90 } },
          { kind: "CONDITION", id: "c2", left: { kind: "PRICE", field: "CLOSE" }, operator: "LESS_THAN", right: { kind: "CONSTANT", value: 110 } },
        ],
      };
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(true);
    });

    it("OR: any condition can be true", () => {
      const candles = makeCandles([200]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "OR",
        children: [
          { kind: "CONDITION", id: "c1", left: { kind: "PRICE", field: "CLOSE" }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 90 } },
          { kind: "CONDITION", id: "c2", left: { kind: "PRICE", field: "CLOSE" }, operator: "LESS_THAN", right: { kind: "CONSTANT", value: 50 } },
        ],
      };
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(true);
    });

    it("negate: NOT reverses group result", () => {
      const candles = makeCandles([100]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND", negate: true,
        children: [
          { kind: "CONDITION", id: "c1", left: { kind: "PRICE", field: "CLOSE" }, operator: "GREATER_THAN", right: { kind: "CONSTANT", value: 90 } },
        ],
      };
      // Without negate: true. With negate: false.
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(false);
    });
  });

  describe("Lag support", () => {
    it("lag=1 accesses the previous bar value", () => {
      const candles = makeCandles([90, 100, 110]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE", lag: 1 },
          operator: "GREATER_THAN",
          right: { kind: "CONSTANT", value: 95 },
        }],
      };
      // At bar 2: lag=1 → bar 1 close = 100 > 95 → TRUE
      expect(evaluateRuleGroup(rule, cache, 2).matched).toBe(true);
      // At bar 1: lag=1 → bar 0 close = 90 > 95 → FALSE
      expect(evaluateRuleGroup(rule, cache, 1).matched).toBe(false);
    });

    it("lag beyond available history returns false (null propagation)", () => {
      const candles = makeCandles([100, 110]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE", lag: 5 },
          operator: "GREATER_THAN",
          right: { kind: "CONSTANT", value: 50 },
        }],
      };
      // Bar 1 - lag 5 = -4 → null → false
      expect(evaluateRuleGroup(rule, cache, 1).matched).toBe(false);
    });
  });

  describe("SMA indicator via IndicatorStateCache", () => {
    it("SMA(3) computes correctly from bar 2 onward", () => {
      const candles = makeCandles([10, 20, 30, 40, 50]);
      const cache = new IndicatorStateCache(candles);
      // SMA(3) at bar 2 = (10+20+30)/3 = 20
      const val = cache.resolve("SMA", { period: 3 }, 2, 0);
      expect(val).toBeCloseTo(20, 4);
      // SMA(3) at bar 4 = (30+40+50)/3 = 40
      const val2 = cache.resolve("SMA", { period: 4 }, 4, 0);
      expect(val2).toBeCloseTo(35, 4); // (20+30+40+50)/4
    });

    it("SMA returns null before warm-up period", () => {
      const candles = makeCandles([10, 20, 30]);
      const cache = new IndicatorStateCache(candles);
      const val = cache.resolve("SMA", { period: 5 }, 2, 0);
      expect(val).toBeNull();
    });
  });

  describe("PERCENT_ABOVE / PERCENT_BELOW", () => {
    it("PERCENT_ABOVE: true when left > right * (1 + pct/100)", () => {
      const candles = makeCandles([110]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "PERCENT_ABOVE",
          right: { kind: "CONSTANT", value: 100 },
          percentValue: 5,
        }],
      };
      // 110 > 100 * 1.05 = 105 → TRUE
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(true);
    });

    it("PERCENT_BELOW: false when left > right * (1 - pct/100)", () => {
      const candles = makeCandles([95]);
      const cache = new IndicatorStateCache(candles);
      const rule: StrategyRuleGroup = {
        kind: "GROUP", id: "root", combinator: "AND",
        children: [{
          kind: "CONDITION", id: "c1",
          left: { kind: "PRICE", field: "CLOSE" },
          operator: "PERCENT_BELOW",
          right: { kind: "CONSTANT", value: 100 },
          percentValue: 10,
        }],
      };
      // 95 < 100 * (1 - 0.10) = 90 → FALSE (95 is not below 90)
      expect(evaluateRuleGroup(rule, cache, 0).matched).toBe(false);
    });
  });
});
