import { describe, it, expect } from "bun:test";
import { getCalculator, type CalculatorInput } from "../../../domain/calculations/engine/calculator-registry";
import { CALCULATION_RESULTS_FILTERS } from "./screener";

const BARS = 120;
const closes = Array.from({ length: BARS }, (_, i) => 400 + 30 * Math.sin(i / 8) + 0.4 * i);
const input: CalculatorInput = {
  symbol: "TEST",
  closes,
  opens: closes.map((c) => c - 1),
  highs: closes.map((c, i) => c + 3 + (i % 3)),
  lows: closes.map((c, i) => c - 3 - (i % 2)),
  volumes: closes.map((_, i) => 20_000 + (i % 5) * 1_000),
  dates: closes.map((_, i) => new Date(Date.UTC(2025, 0, 1 + i)).toISOString().split("T")[0]),
};

describe("screener calculation_results fallback", () => {
  it("only filters on indicator rows the calculation engine actually stores", () => {
    for (const [field, source] of Object.entries(CALCULATION_RESULTS_FILTERS)) {
      const calc = getCalculator(source.indicatorName);
      expect({ field, registered: calc !== undefined }).toEqual({ field, registered: true });

      const [row] = calc!.calculate(input);
      for (const column of source.columns) {
        expect({ field, column, stored: row?.[column] != null }).toEqual({ field, column, stored: true });
      }
    }
  });

  it("covers MACD, Stochastic %K, Williams %R and Bollinger width", () => {
    for (const field of ["macd_value", "stoch_k", "williams_r", "bollinger_width"]) {
      expect(CALCULATION_RESULTS_FILTERS[field]).toBeDefined();
    }
  });
});
