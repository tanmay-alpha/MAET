import { describe, it, expect } from "bun:test";
import type { Candle } from "@shared/types";
import { computeEMA, computeMACD, computeRSI, computeSMA } from "@shared/indicators";
import { calculateAllIndicators } from "./indicators-extended";

const BARS = 60;

const candles: Candle[] = Array.from({ length: BARS }, (_, i) => {
  const close = 300 + 20 * Math.sin(i / 6) + 0.5 * i;
  return {
    symbol: "TEST",
    tf: "1d",
    ts: new Date(Date.UTC(2025, 0, 1 + i)).toISOString(),
    open: close - 1,
    high: close + 3,
    low: close - 3,
    close,
    volume: 5_000 + (i % 5) * 500,
  };
});
const closes = candles.map((c) => c.close);

describe("calculateAllIndicators — canonical warm-up and seeding", () => {
  const result = calculateAllIndicators(candles);

  it("reports null (not 0) for indicators still in warm-up", () => {
    expect(result.sma[100]).toBeNull();
    expect(result.sma[200]).toBeNull();
    expect(result.ema[200]).toBeNull();
    expect(result.wma[100]).toBeNull();
    expect(result.alma[100]).toBeNull();
    expect(result.vwma[100]).toBeNull();
    expect(result.zScore[100]).toBeNull();
    expect(result.rsi[100]).toBeNull();
    expect(result.atr[100]).toBeNull();
  });

  it("matches canonical SMA/EMA/RSI/MACD once warmed up", () => {
    expect(result.sma[20]).toBeCloseTo(computeSMA(closes, 20).at(-1)!, 10);
    expect(result.ema[20]).toBeCloseTo(computeEMA(closes, 20).at(-1)!, 10);
    expect(result.ema[50]).toBeCloseTo(computeEMA(closes, 50).at(-1)!, 10);
    expect(result.rsi[14]).toBeCloseTo(computeRSI(closes, 14).at(-1)!, 10);
    const macd = computeMACD(closes, 12, 26, 9);
    expect(result.macd.macdLine).toBeCloseTo(macd.macd.at(-1)!, 10);
    expect(result.macd.macdSignal).toBeCloseTo(macd.signal.at(-1)!, 10);
  });
});
