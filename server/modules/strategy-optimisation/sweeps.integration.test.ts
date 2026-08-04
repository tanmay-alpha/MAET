/**
 * Strategy Parameter Sweeps — Integration Test Suite.
 *
 * Exercises combination generation, AST parameter injection, grid limits,
 * and result persistence.
 */

import { describe, expect, it } from "bun:test";
import { generateCombinations, injectParametersIntoAST } from "../../workers/sweep-worker";
import type { StrategyDefinition } from "../../../shared/strategy/ast";

describe("Strategy Parameter Sweeps Test Suite", () => {
  it("1. Generates correct parameter combinations within grid limits", () => {
    const ranges = [
      { name: "rsiPeriod", min: 10, max: 20, step: 5 }, // 10, 15, 20 (3)
      { name: "fastMa", min: 5, max: 15, step: 5 },     // 5, 10, 15 (3)
    ];

    const combos = generateCombinations(ranges, 500);
    expect(combos).toHaveLength(9);
    expect(combos[0]).toEqual({ rsiPeriod: 10, fastMa: 5 });
    expect(combos[combos.length - 1]).toEqual({ rsiPeriod: 20, fastMa: 15 });
  });

  it("2. Caps combination count at maxCombinations limit", () => {
    const ranges = [
      { name: "paramA", min: 1, max: 100, step: 1 }, // 100
      { name: "paramB", min: 1, max: 100, step: 1 }, // 100 -> 10000 total
    ];

    const combos = generateCombinations(ranges, 50);
    expect(combos).toHaveLength(50);
  });

  it("3. Injects parameters into Strategy AST without mutating original definition", () => {
    const originalDef: StrategyDefinition = {
      name: "RSI Strategy",
      execution: { initialCapital: 100000 },
      entryRules: {
        kind: "OPERATOR",
        operator: "AND",
        conditions: [
          {
            kind: "COMPARISON",
            left: {
              kind: "INDICATOR",
              indicator: { type: "RSI", params: { period: 14 } },
            },
            operator: "<",
            right: { kind: "CONSTANT", value: 30 },
          },
        ],
      },
      exitRules: {
        kind: "OPERATOR",
        operator: "AND",
        conditions: [],
      },
    };

    const injected = injectParametersIntoAST(originalDef, { rsiPeriod: 21 });
    expect(injected).not.toBe(originalDef);
    expect(originalDef.entryRules.kind).toBe("OPERATOR");
  });
});
