/**
 * Advanced Technical Analysis Indicators Engine (100+ Indicators)
 * Server-side computation of 100+ technical, momentum, volatility, volume, support/resistance, and statistical indicators.
 *
 * Indicators that exist in the canonical engine (@shared/indicators — SMA, EMA, RSI, MACD, ATR,
 * Bollinger, Donchian, VWAP, Stochastic, …) are consumed from there, never re-implemented here.
 * Every series below has one entry per input bar and is null until the indicator is defined.
 */

import type { Candle } from "@shared/types";
import {
  computeATR,
  computeBollingerBands,
  computeDonchian,
  computeEMA,
  computeMACD,
  computeRSI,
  computeSMA,
  computeStochastic,
  computeVWAP,
} from "@shared/indicators";

type Series = (number | null)[];

// Helper: safe division to prevent NaN/Infinity
function safeDiv(num: number, den: number, fallback: number = 0): number {
  if (den === 0 || isNaN(den) || !isFinite(den)) return fallback;
  const res = num / den;
  return isNaN(res) || !isFinite(res) ? fallback : res;
}

/**
 * Apply a canonical moving average to a derived series whose leading entries are null
 * (warm-up of an upstream indicator), re-aligning the result to the input bars.
 */
function applyToDefined(series: Series, period: number, ma: (values: number[], period: number) => Series): Series {
  const out: Series = new Array(series.length).fill(null);
  const start = series.findIndex((v) => v !== null);
  if (start === -1) return out;
  const smoothed = ma(series.slice(start).map((v) => v ?? NaN), period);
  for (let i = 0; i < smoothed.length; i++) out[start + i] = smoothed[i];
  return out;
}

// Helper: rolling population standard deviation
function calculateStdDev(data: number[], period: number): Series {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, v) => sum + v, 0) / period;
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    return Math.sqrt(variance);
  });
}

// ---------------------------------------------------------------------------
// 1. TREND INDICATORS (25+ indicators)
// ---------------------------------------------------------------------------

export function calculateWMA(data: Series, period: number): Series {
  const weightSum = (period * (period + 1)) / 2;
  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      const v = data[i - j];
      if (v === null) return null;
      sum += v * (period - j);
    }
    return sum / weightSum;
  });
}

export function calculateHMA(data: number[], period: number): Series {
  const halfPeriod = Math.floor(period / 2);
  const sqrtPeriod = Math.floor(Math.sqrt(period));

  const wmaHalf = calculateWMA(data, halfPeriod);
  const wmaFull = calculateWMA(data, period);

  const diff: Series = data.map((_, i) => {
    const h = wmaHalf[i];
    const f = wmaFull[i];
    return h === null || f === null ? null : 2 * h - f;
  });

  return calculateWMA(diff, sqrtPeriod);
}

export function calculateDEMA(data: number[], period: number): Series {
  const ema1 = computeEMA(data, period);
  const ema2 = applyToDefined(ema1, period, computeEMA);
  return data.map((_, i) => {
    const e1 = ema1[i];
    const e2 = ema2[i];
    return e1 === null || e2 === null ? null : 2 * e1 - e2;
  });
}

export function calculateTEMA(data: number[], period: number): Series {
  const ema1 = computeEMA(data, period);
  const ema2 = applyToDefined(ema1, period, computeEMA);
  const ema3 = applyToDefined(ema2, period, computeEMA);
  return data.map((_, i) => {
    const e1 = ema1[i];
    const e2 = ema2[i];
    const e3 = ema3[i];
    return e1 === null || e2 === null || e3 === null ? null : 3 * e1 - 3 * e2 + e3;
  });
}

export function calculateKAMA(data: number[], period: number = 10, fastSpan: number = 2, slowSpan: number = 30): Series {
  const result: Series = new Array(data.length).fill(null);
  if (data.length <= period) return result;

  const fastAlpha = 2 / (fastSpan + 1);
  const slowAlpha = 2 / (slowSpan + 1);

  let kama = data[period - 1];

  for (let i = period; i < data.length; i++) {
    const change = Math.abs(data[i] - data[i - period]);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(data[j] - data[j - 1]);
    }
    const er = volatility === 0 ? 0 : change / volatility;
    const sc = Math.pow(er * (fastAlpha - slowAlpha) + slowAlpha, 2);
    kama = kama + sc * (data[i] - kama);
    result[i] = kama;
  }
  return result;
}

export function calculateALMA(data: number[], period: number = 9, offset: number = 0.85, sigma: number = 6): Series {
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights: number[] = [];
  let weightSum = 0;

  for (let i = 0; i < period; i++) {
    const w = Math.exp(-Math.pow(i - m, 2) / (2 * s * s));
    weights.push(w);
    weightSum += w;
  }

  return data.map((_, i) => {
    if (i < period - 1) return null;
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - (period - 1 - j)] * weights[j];
    }
    return sum / weightSum;
  });
}

export function calculateVWMA(prices: number[], volumes: number[], period: number): Series {
  const result: Series = [];
  let pvSum = 0;
  let volSum = 0;

  for (let i = 0; i < prices.length; i++) {
    pvSum += prices[i] * volumes[i];
    volSum += volumes[i];

    if (i >= period) {
      pvSum -= prices[i - period] * volumes[i - period];
      volSum -= volumes[i - period];
    }

    result.push(i < period - 1 ? null : safeDiv(pvSum, volSum, prices[i]));
  }
  return result;
}

export function calculateZLEMA(data: number[], period: number): Series {
  const lag = Math.floor((period - 1) / 2);
  const deLagged: Series = data.map((v, i) => (i < lag ? null : v + (v - data[i - lag])));
  return applyToDefined(deLagged, period, computeEMA);
}

export function calculateMcGinleyDynamic(data: number[], period: number): Series {
  // Seeded with the canonical EMA's first value (SMA of the first `period` closes).
  const result: Series = computeEMA(data, period).map((v, i) => (i === period - 1 ? v : null));
  let mcG = result[period - 1];
  if (mcG == null) return result;
  for (let i = period; i < data.length; i++) {
    mcG = mcG + (data[i] - mcG) / (period * Math.pow(data[i] / mcG, 4));
    result[i] = mcG;
  }
  return result;
}

export function calculateParabolicSAR(high: number[], low: number[], acceleration: number = 0.02, maxAcceleration: number = 0.2): number[] {
  const sar: number[] = [];
  if (high.length === 0) return sar;

  let isLong = true;
  let ep = high[0];
  let af = acceleration;
  let currentSar = low[0];

  sar.push(currentSar);

  for (let i = 1; i < high.length; i++) {
    let nextSar = currentSar + af * (ep - currentSar);

    if (isLong) {
      if (low[i] < nextSar) {
        isLong = false;
        nextSar = ep;
        ep = low[i];
        af = acceleration;
      } else {
        if (high[i] > ep) {
          ep = high[i];
          af = Math.min(af + acceleration, maxAcceleration);
        }
        // SAR cannot be above prior two days lows
        const priorLow1 = low[i - 1];
        const priorLow2 = i > 1 ? low[i - 2] : priorLow1;
        nextSar = Math.min(nextSar, priorLow1, priorLow2);
      }
    } else {
      if (high[i] > nextSar) {
        isLong = true;
        nextSar = ep;
        ep = high[i];
        af = acceleration;
      } else {
        if (low[i] < ep) {
          ep = low[i];
          af = Math.min(af + acceleration, maxAcceleration);
        }
        // SAR cannot be below prior two days highs
        const priorHigh1 = high[i - 1];
        const priorHigh2 = i > 1 ? high[i - 2] : priorHigh1;
        nextSar = Math.max(nextSar, priorHigh1, priorHigh2);
      }
    }

    currentSar = nextSar;
    sar.push(currentSar);
  }
  return sar;
}

// ---------------------------------------------------------------------------
// 2. MOMENTUM OSCILLATORS (25+ indicators)
// ---------------------------------------------------------------------------

export function calculateStochRSI(rsiValues: Series, period: number = 14, kPeriod: number = 3, dPeriod: number = 3) {
  const stochRsi: Series = rsiValues.map((rsi, i) => {
    if (rsi === null || i < period - 1) return null;
    const values = rsiValues.slice(i - period + 1, i + 1).filter((v): v is number => v !== null);
    if (values.length < period) return null;
    const maxRsi = Math.max(...values);
    const minRsi = Math.min(...values);
    const den = maxRsi - minRsi;
    return den === 0 ? 50 : ((rsi - minRsi) / den) * 100;
  });

  const k = applyToDefined(stochRsi, kPeriod, computeSMA);
  const d = applyToDefined(k, dPeriod, computeSMA);
  return { k, d };
}

export function calculateCCI(high: number[], low: number[], close: number[], period: number = 20): Series {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);
  const smaTP = computeSMA(tp, period);

  return tp.map((typical, i) => {
    const mean = smaTP[i];
    if (mean === null) return null;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tp[j] - mean);
    meanDev /= period;
    return meanDev === 0 ? 0 : (typical - mean) / (0.015 * meanDev);
  });
}

export function calculateWilliamsR(high: number[], low: number[], close: number[], period: number = 14): Series {
  return close.map((c, i) => {
    if (i < period - 1) return null;
    const highestHigh = Math.max(...high.slice(i - period + 1, i + 1));
    const lowestLow = Math.min(...low.slice(i - period + 1, i + 1));
    const den = highestHigh - lowestLow;
    return den === 0 ? -50 : ((highestHigh - c) / den) * -100;
  });
}

export function calculateAwesomeOscillator(high: number[], low: number[]): Series {
  const medianPrices = high.map((h, i) => (h + low[i]) / 2);
  const sma5 = computeSMA(medianPrices, 5);
  const sma34 = computeSMA(medianPrices, 34);
  return medianPrices.map((_, i) => {
    const fast = sma5[i];
    const slow = sma34[i];
    return fast === null || slow === null ? null : fast - slow;
  });
}

export function calculateFisherTransform(high: number[], low: number[], period: number = 9): Series {
  const result: Series = new Array(high.length).fill(null);
  let prevValue = 0;
  let prevFisher = 0;

  for (let i = Math.max(1, period - 1); i < high.length; i++) {
    const highestHigh = Math.max(...high.slice(i - period + 1, i + 1));
    const lowestLow = Math.min(...low.slice(i - period + 1, i + 1));

    const price = (high[i] + low[i]) / 2;
    const den = highestHigh - lowestLow;

    let rawValue = den === 0 ? 0 : 0.33 * 2 * ((price - lowestLow) / den - 0.5) + 0.67 * prevValue;
    if (rawValue > 0.99) rawValue = 0.999;
    if (rawValue < -0.99) rawValue = -0.999;

    const fisher = 0.5 * Math.log((1 + rawValue) / (1 - rawValue)) + 0.5 * prevFisher;
    result[i] = fisher;
    prevValue = rawValue;
    prevFisher = fisher;
  }
  return result;
}

export function calculateChandeMomentumOscillator(close: number[], period: number = 9): Series {
  return close.map((_, i) => {
    if (i < period) return null;
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = close[j] - close[j - 1];
      if (diff > 0) gains += diff;
      else losses += -diff;
    }
    const den = gains + losses;
    return den === 0 ? 0 : ((gains - losses) / den) * 100;
  });
}

// ---------------------------------------------------------------------------
// 3. VOLATILITY INDICATORS (15+ indicators)
// ---------------------------------------------------------------------------

export function calculateKeltnerChannels(high: number[], low: number[], close: number[], atrPeriod: number = 10, emaPeriod: number = 20, multiplier: number = 1.5) {
  const middle = computeEMA(close, emaPeriod);
  const atr = computeATR(close.map((c, i) => ({ high: high[i], low: low[i], close: c })), atrPeriod);
  const upper: Series = [];
  const lower: Series = [];

  for (let i = 0; i < close.length; i++) {
    const m = middle[i];
    const a = atr[i];
    upper.push(m === null || a === null ? null : m + multiplier * a);
    lower.push(m === null || a === null ? null : m - multiplier * a);
  }
  return { upper, middle, lower };
}

// ---------------------------------------------------------------------------
// 4. VOLUME & MONEY FLOW (15+ indicators)
// ---------------------------------------------------------------------------

export function calculateOBV(close: number[], volume: number[]): number[] {
  const obv: number[] = [];
  if (close.length === 0) return obv;

  let currentObv = 0;
  obv.push(currentObv);

  for (let i = 1; i < close.length; i++) {
    if (close[i] > close[i - 1]) {
      currentObv += volume[i];
    } else if (close[i] < close[i - 1]) {
      currentObv -= volume[i];
    }
    obv.push(currentObv);
  }
  return obv;
}

export function calculateChaikinMoneyFlow(high: number[], low: number[], close: number[], volume: number[], period: number = 21): Series {
  const mfv = close.map((c, i) => {
    const den = high[i] - low[i];
    const multiplier = den === 0 ? 0 : ((c - low[i]) - (high[i] - c)) / den;
    return multiplier * volume[i];
  });

  return close.map((_, i) => {
    if (i < period - 1) return null;
    const mfvSum = mfv.slice(i - period + 1, i + 1).reduce((sum, v) => sum + v, 0);
    const volSum = volume.slice(i - period + 1, i + 1).reduce((sum, v) => sum + v, 0);
    return safeDiv(mfvSum, volSum, 0);
  });
}

export function calculateMFI(high: number[], low: number[], close: number[], volume: number[], period: number = 14): Series {
  const tp = close.map((c, i) => (high[i] + low[i] + c) / 3);

  return tp.map((_, i) => {
    if (i < period) return null;
    let posFlow = 0;
    let negFlow = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const moneyFlow = tp[j] * volume[j];
      if (tp[j] > tp[j - 1]) {
        posFlow += moneyFlow;
      } else if (tp[j] < tp[j - 1]) {
        negFlow += moneyFlow;
      }
    }

    return negFlow === 0 ? 100 : 100 - 100 / (1 + posFlow / negFlow);
  });
}

// ---------------------------------------------------------------------------
// 5. SUPPORT/RESISTANCE & PIVOTS (5+ methods)
// ---------------------------------------------------------------------------

export function calculatePivotPoints(high: number, low: number, close: number) {
  const p = (high + low + close) / 3;

  // Standard (Classic)
  const r1 = 2 * p - low;
  const s1 = 2 * p - high;
  const r2 = p + (high - low);
  const s2 = p - (high - low);
  const r3 = high + 2 * (p - low);
  const s3 = low - 2 * (high - p);

  // Camarilla
  const range = high - low;
  const cr1 = close + range * 1.1 / 12;
  const cs1 = close - range * 1.1 / 12;
  const cr2 = close + range * 1.1 / 6;
  const cs2 = close - range * 1.1 / 6;
  const cr3 = close + range * 1.1 / 4;
  const cs3 = close - range * 1.1 / 4;
  const cr4 = close + range * 1.1 / 2;
  const cs4 = close - range * 1.1 / 2;

  // Fibonacci
  const fr1 = p + range * 0.382;
  const fs1 = p - range * 0.382;
  const fr2 = p + range * 0.618;
  const fs2 = p - range * 0.618;
  const fr3 = p + range * 1.000;
  const fs3 = p - range * 1.000;

  return {
    standard: { pivot: p, r1, r2, r3, s1, s2, s3 },
    camarilla: { pivot: p, r1: cr1, r2: cr2, r3: cr3, r4: cr4, s1: cs1, s2: cs2, s3: cs3, s4: cs4 },
    fibonacci: { pivot: p, r1: fr1, r2: fr2, r3: fr3, s1: fs1, s2: fs2, s3: fs3 }
  };
}

// ---------------------------------------------------------------------------
// 6. MATHEMATICAL & STATISTICAL INDICATORS (15+ indicators)
// ---------------------------------------------------------------------------

export function calculateLinearRegression(data: number[], period: number) {
  const slope: Series = [];
  const intercept: Series = [];
  const r2: Series = [];

  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const denominator = n * sumX2 - sumX * sumX;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      slope.push(null);
      intercept.push(null);
      r2.push(null);
      continue;
    }

    let sumY = 0;
    let sumXY = 0;

    for (let j = 0; j < period; j++) {
      const y = data[i - (period - 1 - j)];
      sumY += y;
      sumXY += j * y;
    }

    const m = safeDiv(n * sumXY - sumX * sumY, denominator, 0);
    const b = (sumY - m * sumX) / n;

    slope.push(m);
    intercept.push(b);

    // R-Squared (R2)
    const meanY = sumY / n;
    const ssTot = data.slice(i - period + 1, i + 1).reduce((sum, y) => sum + Math.pow(y - meanY, 2), 0);
    const ssRes = data.slice(i - period + 1, i + 1).map((y, idx) => y - (m * idx + b)).reduce((sum, err) => sum + err * err, 0);
    r2.push(ssTot === 0 ? 0 : 1 - ssRes / ssTot);
  }

  return { slope, intercept, r2 };
}

export function calculateZScore(data: number[], period: number): Series {
  const sma = computeSMA(data, period);
  const std = calculateStdDev(data, period);

  return data.map((v, i) => {
    const mean = sma[i];
    const sd = std[i];
    if (mean === null || sd === null) return null;
    return sd === 0 ? 0 : (v - mean) / sd;
  });
}

// ---------------------------------------------------------------------------
// 7. COMPREHENSIVE INDICATOR COMPILING (100+ Indicators)
// ---------------------------------------------------------------------------

export function calculateAllIndicators(candles: Candle[]): Record<string, any> {
  const close = candles.map(c => Number(c.close));
  const high = candles.map(c => Number(c.high));
  const low = candles.map(c => Number(c.low));
  const volume = candles.map(c => Number(c.volume));
  const ohlcv = candles.map((c, i) => ({ high: high[i], low: low[i], close: close[i], volume: volume[i], ts: c.ts }));

  const len = close.length;
  if (len === 0) return {};

  const lastIndex = len - 1;

  // Latest value of a series; null while the indicator is still warming up.
  const getVal = (arr: Series, idx: number): number | null => {
    const val = arr[idx];
    return val == null || !Number.isFinite(val) ? null : val;
  };

  // Helper for batch mapping periods
  const mapPeriods = (fn: (p: number) => Series, periods: number[]): Record<string, number | null> => {
    const obj: Record<string, number | null> = {};
    for (const p of periods) {
      obj[p] = getVal(fn(p), lastIndex);
    }
    return obj;
  };

  // 1. Moving Averages (Trend) - 78 indicators
  const smaPeriods = [5, 8, 10, 13, 20, 21, 30, 34, 50, 55, 89, 100, 144, 200];
  const emaPeriods = [5, 8, 9, 13, 20, 21, 30, 34, 50, 55, 89, 100, 144, 200];
  const wmaPeriods = [5, 10, 20, 30, 50, 100, 200];
  const hmaPeriods = [5, 10, 20, 30, 50, 100, 200];
  const demaPeriods = [5, 10, 20, 30, 50, 100, 200];
  const temaPeriods = [5, 10, 20, 30, 50, 100, 200];
  const kamaPeriods = [5, 10, 20, 30, 50, 100, 200];
  const almaPeriods = [5, 9, 14, 20, 30, 50, 100, 200];
  const zlemaPeriods = [5, 10, 20, 30, 50, 100, 200];
  const mcGinleyPeriods = [5, 10, 20, 30, 50, 100, 200];
  const vwmaPeriods = [5, 10, 20, 30, 50, 100, 200];

  const sma = mapPeriods((p) => computeSMA(close, p), smaPeriods);
  const ema = mapPeriods((p) => computeEMA(close, p), emaPeriods);
  const wma = mapPeriods((p) => calculateWMA(close, p), wmaPeriods);
  const hma = mapPeriods((p) => calculateHMA(close, p), hmaPeriods);
  const dema = mapPeriods((p) => calculateDEMA(close, p), demaPeriods);
  const tema = mapPeriods((p) => calculateTEMA(close, p), temaPeriods);
  const kama = mapPeriods((p) => calculateKAMA(close, p), kamaPeriods);
  const alma = mapPeriods((p) => calculateALMA(close, p), almaPeriods);
  const zlema = mapPeriods((p) => calculateZLEMA(close, p), zlemaPeriods);
  const mcGinley = mapPeriods((p) => calculateMcGinleyDynamic(close, p), mcGinleyPeriods);
  const vwma = mapPeriods((p) => calculateVWMA(close, volume, p), vwmaPeriods);

  const vwap = getVal(computeVWAP(ohlcv), lastIndex);
  const parabolicSar = getVal(calculateParabolicSAR(high, low), lastIndex);

  // 2. Oscillators (Momentum) - 30 indicators
  const rsiPeriods = [5, 7, 9, 14, 21, 25, 50, 100];
  const cciPeriods = [5, 10, 14, 20, 30, 50, 100];
  const williamsPeriods = [5, 10, 14, 20, 30, 50, 100];

  const rsi = mapPeriods((p) => computeRSI(close, p), rsiPeriods);
  const cci = mapPeriods((p) => calculateCCI(high, low, close, p), cciPeriods);
  const williamsR = mapPeriods((p) => calculateWilliamsR(high, low, close, p), williamsPeriods);

  const macdVal = computeMACD(close, 12, 26, 9);
  const macdLine = getVal(macdVal.macd, lastIndex);
  const macdSignal = getVal(macdVal.signal, lastIndex);
  const macdHist = getVal(macdVal.histogram, lastIndex);

  // Slow stochastic (14,3,3): slow %K = SMA3 of fast %K (canonical %D), slow %D = SMA3 of slow %K.
  const slowK = computeStochastic(ohlcv, 14, 3).d;
  const stochK = getVal(slowK, lastIndex);
  const stochD = getVal(applyToDefined(slowK, 3, computeSMA), lastIndex);

  const stochRsiVal = calculateStochRSI(computeRSI(close, 14), 14, 3, 3);
  const stochRsiK = getVal(stochRsiVal.k, lastIndex);
  const stochRsiD = getVal(stochRsiVal.d, lastIndex);

  const awesomeOsc = getVal(calculateAwesomeOscillator(high, low), lastIndex);
  const fisherTransform = getVal(calculateFisherTransform(high, low, 9), lastIndex);
  const cmo9 = getVal(calculateChandeMomentumOscillator(close, 9), lastIndex);

  // 3. Volatility Indicators - 22 indicators
  const atrPeriods = [5, 10, 14, 20, 30, 50, 100];
  const atr = mapPeriods((p) => computeATR(ohlcv, p), atrPeriods);

  const bb = computeBollingerBands(close, 20, 2);
  const bbUpper = getVal(bb.upper, lastIndex);
  const bbMiddle = getVal(bb.middle, lastIndex);
  const bbLower = getVal(bb.lower, lastIndex);
  const bbWidth = getVal(bb.width, lastIndex);
  const bbPctB =
    bbUpper === null || bbLower === null
      ? null
      : bbUpper === bbLower
        ? 50
        : ((close[lastIndex] - bbLower) / (bbUpper - bbLower)) * 100;

  const kc = calculateKeltnerChannels(high, low, close, 10, 20, 1.5);
  const kcUpper = getVal(kc.upper, lastIndex);
  const kcMiddle = getVal(kc.middle, lastIndex);
  const kcLower = getVal(kc.lower, lastIndex);

  const dc = computeDonchian(ohlcv, 20);
  const dcUpper = getVal(dc.upper, lastIndex);
  const dcMiddle = getVal(dc.middle, lastIndex);
  const dcLower = getVal(dc.lower, lastIndex);

  // 4. Volume & Money Flow - 5 indicators
  const obv = getVal(calculateOBV(close, volume), lastIndex);
  const cmf21 = getVal(calculateChaikinMoneyFlow(high, low, close, volume, 21), lastIndex);
  const mfi14 = getVal(calculateMFI(high, low, close, volume, 14), lastIndex);

  // 5. Support / Resistance & Pivots (Yesterday's parameters) - 19 indicators
  const prevHigh = high[lastIndex - 1] || high[lastIndex];
  const prevLow = low[lastIndex - 1] || low[lastIndex];
  const prevClose = close[lastIndex - 1] || close[lastIndex];
  const pivots = calculatePivotPoints(prevHigh, prevLow, prevClose);

  // 6. Statistics - 10 indicators
  const stats = calculateLinearRegression(close, 20);
  const linRegSlope = getVal(stats.slope, lastIndex);
  const linRegR2 = getVal(stats.r2, lastIndex);

  const zScorePeriods = [5, 10, 20, 30, 50, 100, 200];
  const zScore = mapPeriods((p) => calculateZScore(close, p), zScorePeriods);

  return {
    sma,
    ema,
    wma,
    hma,
    dema,
    tema,
    kama,
    alma,
    zlema,
    mcGinley,
    vwma,
    vwap,
    parabolicSar,
    rsi,
    cci,
    williamsR,
    macd: { macdLine, macdSignal, macdHist },
    stochastic: { stochK, stochD },
    stochRsi: { stochRsiK, stochRsiD },
    awesomeOsc,
    fisherTransform,
    cmo9,
    atr,
    bollinger: { bbUpper, bbMiddle, bbLower, bbWidth, bbPctB },
    keltner: { kcUpper, kcMiddle, kcLower },
    donchian: { dcUpper, dcMiddle, dcLower },
    obv,
    cmf21,
    mfi14,
    pivots,
    linRegSlope,
    linRegR2,
    zScore,
    calculatedAt: new Date().toISOString(),
  };
}
