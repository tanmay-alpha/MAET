import { describe, it, expect } from "bun:test";
import { computeMACD, computeRSI } from "@shared/indicators";
import { getCalculator, type CalculatorInput } from "../../engine/calculator-registry";

const BARS = 300;
const closes = Array.from({ length: BARS }, (_, i) => 500 + 60 * Math.sin(i / 7) + 25 * Math.sin(i / 2.3) + 0.2 * i);
const dates = closes.map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().split("T")[0]);

function prefix(len: number): CalculatorInput {
  return { symbol: "TEST", closes: closes.slice(0, len), dates: dates.slice(0, len) };
}

describe("momentum scanners — canonical indicator parity", () => {
  it("SCAN_RSI_OVERSOLD fires exactly when canonical RSI(14) crosses up through 30", () => {
    const scan = getCalculator("SCAN_RSI_OVERSOLD")!;
    let expectedHits = 0;
    for (let len = 30; len <= BARS; len++) {
      const rsi = computeRSI(closes.slice(0, len), 14);
      const rsiPrev = rsi[len - 2]!;
      const rsiNow = rsi[len - 1]!;
      const shouldFire = rsiPrev < 30 && rsiNow >= 30;
      if (shouldFire) expectedHits++;

      const out = scan.calculate(prefix(len));
      expect({ len, fired: out.length === 1 }).toEqual({ len, fired: shouldFire });
      if (shouldFire) {
        expect(out[0].date).toBe(dates[len - 1]);
        expect(out[0].components?.rsiPrev).toBeCloseTo(rsiPrev, 10);
        expect(out[0].components?.rsiNow).toBeCloseTo(rsiNow, 10);
      }
    }
    expect(expectedHits).toBeGreaterThan(0);
  });

  it("SCAN_MACD_BULLISH_CROSSOVER fires exactly when canonical MACD(12,26,9) crosses above its signal", () => {
    const scan = getCalculator("SCAN_MACD_BULLISH_CROSSOVER")!;
    let expectedHits = 0;
    for (let len = 40; len <= BARS; len++) {
      const { macd, signal } = computeMACD(closes.slice(0, len), 12, 26, 9);
      const shouldFire = macd[len - 2]! < signal[len - 2]! && macd[len - 1]! > signal[len - 1]!;
      if (shouldFire) expectedHits++;

      const out = scan.calculate(prefix(len));
      expect({ len, fired: out.length === 1 }).toEqual({ len, fired: shouldFire });
      if (shouldFire) {
        expect(out[0].date).toBe(dates[len - 1]);
        expect(out[0].components?.macd).toBeCloseTo(macd[len - 1]!, 10);
        expect(out[0].components?.signal).toBeCloseTo(signal[len - 1]!, 10);
      }
    }
    expect(expectedHits).toBeGreaterThan(0);
  });
});

describe("SCAN_BOLLINGER_SQUEEZE — 52-week bandwidth window", () => {
  const scan = getCalculator("SCAN_BOLLINGER_SQUEEZE")!;
  const series = (segments: Array<[length: number, amplitude: number]>) => {
    const out: number[] = [];
    for (const [length, amplitude] of segments) {
      for (let k = 0; k < length; k++) out.push(500 + amplitude * Math.sin(out.length * 1.7));
    }
    return out;
  };
  const run = (values: number[]) =>
    scan.calculate({ symbol: "TEST", closes: values, dates: values.map((_, i) => new Date(Date.UTC(2024, 0, 1 + i)).toISOString().split("T")[0]) });

  it("does not fire on exactly 252 bars when earlier bandwidth was far tighter", () => {
    expect(run(series([[232, 0.5], [20, 40]]))).toEqual([]);
  });

  it("fires on 252 bars when the current bandwidth is the tightest", () => {
    expect(run(series([[232, 40], [20, 0.5]]))).toHaveLength(1);
  });

  it("compares against the whole last 252 bars, not only the tail beyond bar 252", () => {
    // A tight stretch at bars 100-149 is inside the 52-week window of a 300-bar series.
    expect(run(series([[100, 40], [50, 0.5], [130, 40], [20, 5]]))).toEqual([]);
    // Without it the medium-volatility tail is the 52-week low.
    expect(run(series([[280, 40], [20, 5]]))).toHaveLength(1);
  });
});
