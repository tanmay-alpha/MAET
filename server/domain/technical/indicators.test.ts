import { describe, it, expect } from "bun:test";
import { computeADX, computeDonchian, computeROC, computeStochastic, computeVWAP } from "@shared/indicators";
import {
  calculateADX,
  calculateDonchianChannels,
  calculateROC,
  calculateStochastic,
  calculateVWAP,
  type OHLCV,
} from "./indicators";

const candles: OHLCV[] = Array.from({ length: 80 }, (_, i) => {
  const close = 150 + 12 * Math.sin(i / 5) + 4 * Math.cos(i / 1.7) + 0.3 * i;
  return { open: close - 0.5, high: close + 2 + (i % 3), low: close - 2 - (i % 4) * 0.5, close, volume: 1_000 + (i % 6) * 150 };
});

/** Server wrappers expose warm-up as NaN; compare against canonical null positions. */
function expectSameSeries(actual: number[], canonical: (number | null)[]) {
  expect(actual.length).toBe(canonical.length);
  canonical.forEach((c, i) => {
    if (c === null) expect({ i, v: actual[i] }).toEqual({ i, v: NaN });
    else expect(actual[i]).toBeCloseTo(c, 10);
  });
}

describe("server technical indicators delegate to the canonical engine", () => {
  it("Stochastic %K and %D", () => {
    const server = calculateStochastic(candles, 14, 3);
    const canonical = computeStochastic(candles, 14, 3);
    expectSameSeries(server.k, canonical.k);
    expectSameSeries(server.d, canonical.d);
  });

  it("ADX and directional indicators", () => {
    const server = calculateADX(candles, 14);
    const canonical = computeADX(candles, 14);
    expectSameSeries(server.adx, canonical.adx);
    expectSameSeries(server.plusDI, canonical.plusDI);
    expectSameSeries(server.minusDI, canonical.minusDI);
  });

  it("ROC, Donchian and VWAP", () => {
    expectSameSeries(calculateROC(candles, 10), computeROC(candles, 10));
    const dc = calculateDonchianChannels(candles, 20);
    const cdc = computeDonchian(candles, 20);
    expectSameSeries(dc.upper, cdc.upper);
    expectSameSeries(dc.middle, cdc.middle);
    expectSameSeries(dc.lower, cdc.lower);
    expectSameSeries(calculateVWAP(candles), computeVWAP(candles));
  });
});
