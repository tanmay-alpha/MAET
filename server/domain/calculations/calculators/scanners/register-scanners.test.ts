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
