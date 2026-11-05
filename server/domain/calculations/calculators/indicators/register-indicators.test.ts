import { describe, it, expect } from "bun:test";
import {
  computeATR,
  computeEMA,
  computeMACD,
  computeSMA,
} from "@shared/indicators";
import {
  getCalculatorsByCategory,
  getCalculator,
  type CalculatorInput,
  type CalculatorOutput,
} from "../../engine/calculator-registry";

const BARS = 260;

function buildInput(): CalculatorInput {
  const closes: number[] = [];
  const highs: number[] = [];
  const lows: number[] = [];
  const opens: number[] = [];
  const volumes: number[] = [];
  const dates: string[] = [];
  for (let i = 0; i < BARS; i++) {
    const close = 200 + 25 * Math.sin(i / 9) + 0.3 * i + (i % 4) * 1.5;
    closes.push(close);
    opens.push(close - 1);
    highs.push(close + 2 + (i % 3));
    lows.push(close - 2 - (i % 5) * 0.5);
    volumes.push(10_000 + (i % 7) * 1_000);
    dates.push(new Date(Date.UTC(2024, 0, 1 + i)).toISOString().split("T")[0]);
  }
  return { symbol: "TEST", closes, opens, highs, lows, volumes, dates };
}

function runOne(name: string, input: CalculatorInput): CalculatorOutput {
  const calc = getCalculator(name);
  expect(calc).toBeDefined();
  const outputs = calc!.calculate(input);
  expect(outputs.length).toBe(1);
  return outputs[0];
}

describe("indicator calculators — canonical parity and date alignment", () => {
  const input = buildInput();
  const dates = input.dates!;
  const closes = input.closes!;
  const candles = closes.map((close, i) => ({ high: input.highs![i], low: input.lows![i], close }));

  it("stores the MACD value, signal and histogram of bar D under date D", () => {
    const out = runOne("MACD", input);
    const d = dates.indexOf(out.date);
    expect(d).toBeGreaterThanOrEqual(0);

    const canonical = computeMACD(closes, 12, 26, 9);
    expect(out.value).toBeCloseTo(canonical.macd[d]!, 10);
    expect(out.signal).toBeCloseTo(canonical.signal[d]!, 10);
    expect(out.hist).toBeCloseTo(canonical.histogram[d]!, 10);
  });

  it("stores the ATR of bar D under date D", () => {
    const out = runOne("ATR_14", input);
    const d = dates.indexOf(out.date);
    expect(d).toBeGreaterThanOrEqual(0);
    expect(out.value).toBeCloseTo(computeATR(candles, 14)[d]!, 10);
  });

  it("seeds EMA from the SMA of the first `period` closes (canonical), not from closes[0]", () => {
    for (const period of [12, 20, 26, 50]) {
      // Short series so the seed still dominates the final value.
      const short: CalculatorInput = { ...input, closes: closes.slice(0, period + 3), dates: dates.slice(0, period + 3) };
      const out = runOne(`EMA_${period}`, short);
      expect(out.date).toBe(short.dates![short.dates!.length - 1]);
      expect(out.value).toBeCloseTo(computeEMA(short.closes!, period).at(-1)!, 10);
    }
  });

  it("matches canonical SMA at the last bar", () => {
    for (const period of [20, 50, 200]) {
      const out = runOne(`SMA_${period}`, input);
      expect(out.value).toBeCloseTo(computeSMA(closes, period).at(-1)!, 10);
    }
  });

  it("dates every technical calculator output with a bar date from the input series", () => {
    const technical = (["trend", "momentum", "volatility", "volume", "oscillators", "custom"] as const).flatMap(
      (c) => getCalculatorsByCategory(c)
    );
    expect(technical.length).toBeGreaterThan(0);
    for (const calc of technical) {
      for (const out of calc.calculate(input)) {
        expect({ name: calc.meta.name, date: out.date }).toEqual({ name: calc.meta.name, date: dates[BARS - 1] });
      }
    }
  });
});

describe("VWAP calculator", () => {
  it("uses the canonical session VWAP: one daily bar is one session, so VWAP is its typical price", () => {
    const input = buildInput();
    const last = BARS - 1;
    const out = runOne("VWAP", input);
    expect(out.value).toBeCloseTo((input.highs![last] + input.lows![last] + input.closes![last]) / 3, 10);
  });
});
