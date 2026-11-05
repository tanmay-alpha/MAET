import { describe, expect, it } from "bun:test";
import type { Candle } from "@shared/types";
import type { StrategyDefinition } from "../../../shared/strategy/ast";
import { applyParameters, generateCombinations, type SweepParameter } from "./parameter-sweep";
import { SweepParameterSchema } from "../../../shared/strategy/schemas";
import { runBacktestV3 } from "./runner-v3";

const sma = (period: number) => ({ kind: "INDICATOR" as const, indicator: "SMA" as const, params: { period }, lag: 0 });

const definition: StrategyDefinition = {
  name: "sma-cross",
  direction: "LONG_ONLY",
  entry: {
    kind: "GROUP", id: "entry", combinator: "AND",
    children: [{ kind: "CONDITION", id: "e1", left: sma(5), operator: "CROSS_ABOVE", right: sma(20) }],
  },
  exit: {
    kind: "GROUP", id: "exit", combinator: "AND",
    children: [{ kind: "CONDITION", id: "x1", left: sma(5), operator: "CROSS_BELOW", right: sma(20) }],
  },
  risk: { sizingMethod: "PERCENT_OF_EQUITY", sizeValue: 100, maximumOpenPositions: 1, allowPyramiding: false },
  execution: { fillPolicy: "NEXT_BAR_OPEN", intrabarPolicy: "CONSERVATIVE", feeModel: "NONE", slippageBps: 0, initialCapital: 100_000 },
};

// The shape the API accepts (shared SweepParameterSchema): a dot-path into the definition.
const parameters: SweepParameter[] = [
  { name: "fast", path: "entry.children.0.left.params.period", values: [3, 5, 8] },
  { name: "slow", path: "entry.children.0.right.params.period", values: [20, 30] },
];

describe("parameter sweep", () => {
  it("enumerates the cartesian product of each parameter's values, capped", () => {
    const combos = generateCombinations(parameters, 500);
    expect(combos).toHaveLength(6);
    expect(combos[0]).toEqual({ fast: 3, slow: 20 });
    expect(combos[5]).toEqual({ fast: 8, slow: 30 });
    expect(generateCombinations(parameters, 4)).toHaveLength(4);
  });

  it("writes each value at its path without mutating the base definition", () => {
    const applied = applyParameters(definition, parameters, { fast: 8, slow: 30 });
    const condition = applied.entry.children[0];
    expect(condition.kind === "CONDITION" && condition.left).toEqual(sma(8));
    expect(condition.kind === "CONDITION" && condition.right).toEqual(sma(30));
    const original = definition.entry.children[0];
    expect(original.kind === "CONDITION" && original.left).toEqual(sma(5));
  });

  it("rejects a path that does not point at a number in the definition", () => {
    expect(() =>
      applyParameters(definition, [{ name: "bad", path: "entry.children.0.left.params.length", values: [1] }], { bad: 1 }),
    ).toThrow(/entry\.children\.0\.left\.params\.length/);
  });


  it("refuses prototype paths and array lengths, leaving Array.prototype untouched", () => {
    const lengthBefore = Array.prototype.length;
    for (const path of [
      "entry.children.__proto__.length",
      "entry.constructor.prototype.x",
      "entry.children.length",
      "entry.children.0.left.params.toString",
    ]) {
      expect(() => applyParameters(definition, [{ name: "p", path, values: [7] }], { p: 7 })).toThrow();
      expect(SweepParameterSchema.safeParse({ name: "p", path, values: [7] }).success).toBe(path === "entry.children.0.left.params.toString");
    }
    expect(Array.prototype.length).toBe(lengthBefore);
    expect(Object.hasOwn(Array.prototype, "x")).toBe(false);
  });
  it("produces different backtests for different parameter values", () => {
    const candles: Candle[] = Array.from({ length: 200 }, (_, i) => {
      const p = 100 + 10 * Math.sin(i / 6) + i * 0.05;
      return { symbol: "T", tf: "1d", ts: new Date(Date.UTC(2024, 0, 1 + i)).toISOString(), open: p, high: p + 1, low: p - 1, close: p, volume: 1e5, source: "test" };
    });
    const entryBars = generateCombinations(parameters, 500).map((combo) =>
      JSON.stringify(
        runBacktestV3({ strategyVersionId: "s", definition: applyParameters(definition, parameters, combo), symbol: "T", candles })
          .trades.map((t) => t.entryBar),
      ),
    );
    expect(new Set(entryBars).size).toBeGreaterThan(1);
  });
});
