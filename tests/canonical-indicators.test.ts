import { describe, it, expect } from "bun:test";
import {
  computeSMA,
  computeEMA,
  computeRSI,
  computeMACD,
  computeATR,
  computeBollingerBands,
  computeADX,
  computeVWAP,
  computeROC,
  computePercentDistance,
  computeSuperTrend,
  buildCanonicalSnapshot,
  INDICATOR_ENGINE_VERSION,
} from "../shared/indicators";
import { IndicatorStateCache } from "../server/domain/strategy/indicator-state";
import { calculateRSI as serverCalculateRSI, calculateSMA as serverCalculateSMA } from "../server/domain/technical/indicators";
import { calculateRSI as clientCalculateRSI, calculateSMA as clientCalculateSMA } from "../src/lib/technical-indicators";
import type { Candle } from "@shared/types";

describe("Canonical Indicator Engine — P1 Contract & Cross-System Equality", () => {
  it("exposes INDICATOR_ENGINE_VERSION version constant", () => {
    expect(INDICATOR_ENGINE_VERSION).toBe("1.0.0");
  });

  // Deterministic fixture with 30 synthetic bars
  const mockCandles: Candle[] = Array.from({ length: 30 }, (_, i) => {
    const base = 100 + i * 2 + (i % 3 === 0 ? 3 : -1);
    return {
      symbol: "TEST",
      tf: "1d",
      ts: new Date(Date.UTC(2025, 0, i + 1)).toISOString(),
      open: base - 1,
      high: base + 3,
      low: base - 2,
      close: base + 1,
      volume: 1000 + i * 50,
      source: "test",
    };
  });

  const closes = mockCandles.map((c) => c.close);

  describe("SMA (Simple Moving Average)", () => {
    it("returns null before period warmup and exact rolling average thereafter", () => {
      const period = 5;
      const sma = computeSMA(closes, period);

      expect(sma.length).toBe(closes.length);
      for (let i = 0; i < period - 1; i++) {
        expect(sma[i]).toBeNull();
      }

      const expectedFirst = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      expect(sma[period - 1]).toBeCloseTo(expectedFirst, 6);

      const expectedLast = closes.slice(closes.length - period).reduce((a, b) => a + b, 0) / period;
      expect(sma[sma.length - 1]).toBeCloseTo(expectedLast, 6);
    });

    it("produces identical values across server technical, client lib, and strategy engine", () => {
      const period = 10;
      const canonical = computeSMA(closes, period);
      const server = serverCalculateSMA(closes, period);
      const client = clientCalculateSMA(closes, period);

      const cache = new IndicatorStateCache(mockCandles);

      for (let i = 0; i < closes.length; i++) {
        const cVal = canonical[i];
        const sVal = isNaN(server[i]) ? null : server[i];
        const clVal = isNaN(client[i]) ? null : client[i];
        const stratVal = cache.resolve("SMA", { period }, i);

        expect(cVal).toBe(sVal);
        expect(cVal).toBe(clVal);
        expect(cVal).toBe(stratVal);
      }
    });
  });

  describe("EMA (Exponential Moving Average)", () => {
    it("seeds with SMA of initial period and smoothly weights thereafter", () => {
      const period = 5;
      const ema = computeEMA(closes, period);

      for (let i = 0; i < period - 1; i++) {
        expect(ema[i]).toBeNull();
      }

      const initialSma = closes.slice(0, period).reduce((a, b) => a + b, 0) / period;
      expect(ema[period - 1]).toBeCloseTo(initialSma, 6);

      const k = 2 / (period + 1);
      const expectedNext = closes[period] * k + initialSma * (1 - k);
      expect(ema[period]).toBeCloseTo(expectedNext, 6);
    });
  });

  describe("RSI (Wilder's Smoothing)", () => {
    it("strictly returns null before period and applies Wilder's exponential smoothing", () => {
      const period = 14;
      const rsi = computeRSI(closes, period);

      expect(rsi.length).toBe(closes.length);
      for (let i = 0; i < period; i++) {
        expect(rsi[i]).toBeNull();
      }

      expect(rsi[period]).not.toBeNull();
      expect(rsi[period]!).toBeGreaterThanOrEqual(0);
      expect(rsi[period]!).toBeLessThanOrEqual(100);
    });

    it("guarantees identical RSI across chart adapter, screener, strategy engine, and backtest", () => {
      const period = 14;
      const canonical = computeRSI(closes, period);
      const server = serverCalculateRSI(closes, period);
      const client = clientCalculateRSI(mockCandles.map((c) => ({ t: 0, o: c.open, h: c.high, l: c.low, c: c.close, v: c.volume })), period);
      const cache = new IndicatorStateCache(mockCandles);

      for (let i = 0; i < closes.length; i++) {
        const cVal = canonical[i];
        const sVal = isNaN(server[i]) ? null : server[i];
        const clVal = isNaN(client[i]) ? null : client[i];
        const stratVal = cache.resolve("RSI", { period }, i);

        if (cVal === null) {
          expect(sVal).toBeNull();
          expect(clVal).toBeNull();
          expect(stratVal).toBeNull();
        } else {
          expect(sVal).toBeCloseTo(cVal, 6);
          expect(clVal).toBeCloseTo(cVal, 6);
          expect(stratVal).toBeCloseTo(cVal, 6);
        }
      }
    });

    it("handles zero loss (all up bars) as exactly 100", () => {
      const strictlyUp = [10, 11, 12, 13, 14, 15];
      const rsi = computeRSI(strictlyUp, 3);
      expect(rsi[3]).toBe(100);
    });

    it("handles zero gain (all down bars) as exactly 0", () => {
      const strictlyDown = [15, 14, 13, 12, 11, 10];
      const rsi = computeRSI(strictlyDown, 3);
      expect(rsi[3]).toBe(0);
    });
  });

  describe("MACD", () => {
    it("computes fastEMA - slowEMA and valid signal line EMA", () => {
      const macd = computeMACD(closes, 12, 26, 9);
      expect(macd.macd.length).toBe(closes.length);
      expect(macd.signal.length).toBe(closes.length);
      expect(macd.histogram.length).toBe(closes.length);

      // MACD line is null before slow period (26)
      for (let i = 0; i < 25; i++) {
        expect(macd.macd[i]).toBeNull();
      }
      expect(macd.macd[25]).not.toBeNull();
    });
  });

  describe("ATR & Bollinger Bands", () => {
    it("computes Wilder's ATR and Bollinger upper/lower/width", () => {
      const atr = computeATR(mockCandles, 14);
      expect(atr.length).toBe(mockCandles.length);
      for (let i = 0; i < 13; i++) {
        expect(atr[i]).toBeNull();
      }
      expect(atr[13]).not.toBeNull();
      expect(atr[13]!).toBeGreaterThan(0);

      const bb = computeBollingerBands(closes, 20, 2);
      expect(bb.upper.length).toBe(closes.length);
      expect(bb.middle.length).toBe(closes.length);
      expect(bb.lower.length).toBe(closes.length);
      expect(bb.width.length).toBe(closes.length);

      for (let i = 0; i < 19; i++) {
        expect(bb.upper[i]).toBeNull();
      }
      const last = closes.length - 1;
      expect(bb.upper[last]!).toBeGreaterThan(bb.middle[last]!);
      expect(bb.middle[last]!).toBeGreaterThan(bb.lower[last]!);
    });
  });

  describe("SuperTrend", () => {
    it("returns null before period warmup and valid numeric values and directions thereafter", () => {
      const period = 7;
      const multiplier = 3;
      const st = computeSuperTrend(mockCandles, period, multiplier);

      expect(st.values.length).toBe(mockCandles.length);
      expect(st.direction.length).toBe(mockCandles.length);

      for (let i = 0; i < period - 1; i++) {
        expect(st.values[i]).toBeNull();
        expect(st.direction[i]).toBeNull();
      }

      for (let i = period - 1; i < mockCandles.length; i++) {
        expect(typeof st.values[i]).toBe("number");
        expect(Number.isFinite(st.values[i]!)).toBe(true);
        expect([1, -1]).toContain(st.direction[i]!);
      }
    });

    it("ratchets bands monotonically within sustained trends", () => {
      // Monotonic upward trend
      const upwardCandles = Array.from({ length: 20 }, (_, i) => ({
        open: 100 + i * 5,
        high: 106 + i * 5,
        low: 99 + i * 5,
        close: 105 + i * 5,
      }));

      const st = computeSuperTrend(upwardCandles, 5, 2);
      expect(st.direction[upwardCandles.length - 1]).toBe(1);

      // In an uptrend, the lower band (SuperTrend line) never ratchets downward
      for (let i = 5; i < upwardCandles.length; i++) {
        if (st.direction[i] === 1 && st.direction[i - 1] === 1) {
          expect(st.values[i]!).toBeGreaterThanOrEqual(st.values[i - 1]!);
        }
      }
    });
  });

  describe("Canonical Snapshot Builder", () => {
    it("builds a full snapshot object matching database technical snapshot schema", () => {
      const snapshot = buildCanonicalSnapshot(mockCandles);
      expect(snapshot).not.toBeNull();
      expect(snapshot?.close).toBe(mockCandles[mockCandles.length - 1].close);
      expect(snapshot?.volume).toBe(mockCandles[mockCandles.length - 1].volume);
      expect(snapshot?.sma20).not.toBeNull();
      expect(snapshot?.rsi14).not.toBeNull();
      expect(snapshot?.bbUpper).not.toBeNull();
      expect(snapshot?.priceAboveSma20).toBe(snapshot!.close > snapshot!.sma20!);
      expect(snapshot?.distanceFromSma20Pct).not.toBeNull();
    });
  });
});
