/**
 * Technical Analysis Indicators Engine
 * Server-side computation of 20+ technical indicators for trading and screening
 */

import type { Candle } from "@shared/types";

// ============================================================================
// Types
// ============================================================================

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface SMAResult { values: number[] }
export interface EMAResult { values: number[] }
export interface RSIResult { values: number[] }

export interface MACDResult {
  macd: number[];
  signal: number[];
  histogram: number[];
}

export interface BollingerBandsResult {
  upper: number[];
  middle: number[];
  lower: number[];
}

export interface ATRResult { values: number[] }
export interface StochasticResult { k: number[]; d: number[] }
export interface ADXResult { adx: number[]; plusDI: number[]; minusDI: number[] }
export interface CCIResult { values: number[] }
export interface WilliamsRResult { values: number[] }
export interface OBVResult { values: number[] }
export interface VWAPResult { values: number[] }
export interface MomentumResult { values: number[] }
export interface ROCResult { values: number[] }
export interface MFIResult { values: number[] }
export interface PivotPointsResult {
  pivot: number[];
  r1: number[];
  r2: number[];
  r3: number[];
  s1: number[];
  s2: number[];
  s3: number[];
}
export interface AroonResult { aroonUp: number[]; aroonDown: number[]; oscillator: number[] }
export interface IchimokuResult {
  tenkan: number[];  // Conversion Line
  kijun: number[];   // Base Line
  senkouA: number[];  // Leading Span A
  senkouB: number[];  // Leading Span B
}
export interface SuperTrendResult {
  values: number[];
  direction: number[]; // 1 = bullish, -1 = bearish
}

export interface AllIndicators {
  sma: SMAResult;
  ema: EMAResult;
  rsi: RSIResult;
  macd: MACDResult;
  bollinger: BollingerBandsResult;
  atr: ATRResult;
  stochastic: StochasticResult;
  adx: ADXResult;
  cci: CCIResult;
  williamsR: WilliamsRResult;
  obv: OBVResult;
  vwap: VWAPResult;
  momentum: MomentumResult;
  roc: ROCResult;
  mfi: MFIResult;
  pivotPoints: PivotPointsResult;
  aroon: AroonResult;
  ichimoku: IchimokuResult;
  superTrend: SuperTrendResult;
}

// ============================================================================
// Moving Averages
// ============================================================================

/**
 * Simple Moving Average (SMA)
 * @param data - Array of price values
 * @param period - Number of periods (typically 20, 50, 200)
 */
export function calculateSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j];
    }
    result.push(sum / period);
  }
  return result;
}

/**
 * Exponential Moving Average (EMA)
 * @param data - Array of price values
 * @param period - Number of periods (typically 12, 26)
 */
export function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);
  let ema = NaN;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    if (isNaN(ema)) {
      let sum = 0;
      for (let j = 0; j < period; j++) {
        sum += data[i - j];
      }
      ema = sum / period;
    } else {
      ema = (data[i] - ema) * multiplier + ema;
    }

    result.push(ema);
  }
  return result;
}

/**
 * Weighted Moving Average (WMA)
 * @param data - Array of price values
 * @param period - Number of periods
 */
export function calculateWMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const weightSum = (period * (period + 1)) / 2;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    let weightedSum = 0;
    for (let j = 0; j < period; j++) {
      weightedSum += data[i - j] * (period - j);
    }
    result.push(weightedSum / weightSum);
  }
  return result;
}

/**
 * Hull Moving Average (HMA)
 * @param data - Array of price values
 * @param period - Number of periods
 */
export function calculateHMA(data: number[], period: number): number[] {
  const halfLength = Math.floor(period / 2);
  const sqrtLength = Math.floor(Math.sqrt(period));

  const wma1 = calculateWMA(data, halfLength);
  const wma2 = calculateWMA(data, period);

  const diff: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (isNaN(wma1[i]) || isNaN(wma2[i])) {
      diff.push(NaN);
    } else {
      diff.push(2 * wma1[i] - wma2[i]);
    }
  }

  return calculateWMA(diff, sqrtLength);
}

// ============================================================================
// Trend Indicators
// ============================================================================

/**
 * MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  candles: OHLCV[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const closes = candles.map(c => c.close);
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  const macd = fastEMA.map((fast, i) => {
    if (isNaN(fast) || isNaN(slowEMA[i])) return NaN;
    return fast - slowEMA[i];
  });

  const validMACD = macd.filter(v => !isNaN(v));
  const signalEMA = calculateEMA(validMACD, signalPeriod);

  let signalIdx = 0;
  const signal = macd.map(v => {
    if (isNaN(v)) return NaN;
    return signalEMA[signalIdx++] ?? NaN;
  });

  const histogram = macd.map((m, i) => {
    if (isNaN(m) || isNaN(signal[i])) return NaN;
    return m - signal[i];
  });

  return { macd, signal, histogram };
}

/**
 * RSI (Relative Strength Index)
 */
export function calculateRSI(candles: OHLCV[], period: number = 14): number[] {
  const result: number[] = [];
  const closes = candles.map(c => c.close);

  for (let i = 0; i < closes.length; i++) {
    if (i < period) {
      result.push(NaN);
      continue;
    }

    let gains = 0;
    let losses = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const change = closes[j] - closes[j - 1];
      if (change > 0) {
        gains += change;
      } else {
        losses -= change;
      }
    }

    const avgGain = gains / period;
    const avgLoss = losses / period;

    if (avgLoss === 0) {
      result.push(100);
    } else {
      const rs = avgGain / avgLoss;
      result.push(100 - (100 / (1 + rs)));
    }
  }

  return result;
}

/**
 * ADX (Average Directional Index) + DI
 */
export function calculateADX(candles: OHLCV[], period: number = 14): ADXResult {
  const result: ADXResult = {
    adx: [],
    plusDI: [],
    minusDI: [],
  };

  if (candles.length < period * 2) {
    for (let i = 0; i < candles.length; i++) {
      result.adx.push(NaN);
      result.plusDI.push(NaN);
      result.minusDI.push(NaN);
    }
    return result;
  }

  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr: number[] = [];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevHigh = candles[i - 1].high;
    const prevLow = candles[i - 1].low;
    const prevClose = candles[i - 1].close;

    // True Range
    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));

    // Directional Movement
    const highDiff = high - prevHigh;
    const lowDiff = prevLow - low;

    if (highDiff > lowDiff && highDiff > 0) {
      plusDM.push(highDiff);
    } else {
      plusDM.push(0);
    }

    if (lowDiff > highDiff && lowDiff > 0) {
      minusDM.push(lowDiff);
    } else {
      minusDM.push(0);
    }
  }

  // Smooth with Wilder's smoothing
  const smoothedTR = smoothWilder(tr, period);
  const smoothedPlusDM = smoothWilder(plusDM, period);
  const smoothedMinusDM = smoothWilder(minusDM, period);

  const plusDI: number[] = [];
  const minusDI: number[] = [];

  for (let i = 0; i < candles.length - 1; i++) {
    if (smoothedTR[i] === 0) {
      plusDI.push(NaN);
      minusDI.push(NaN);
    } else {
      plusDI.push((smoothedPlusDM[i] / smoothedTR[i]) * 100);
      minusDI.push((smoothedMinusDM[i] / smoothedTR[i]) * 100);
    }
  }

  result.plusDI.push(NaN);
  result.minusDI.push(NaN);

  for (let i = 0; i < plusDI.length; i++) {
    if (!isNaN(plusDI[i]) && !isNaN(minusDI[i])) {
      result.plusDI.push(plusDI[i]);
      result.minusDI.push(minusDI[i]);
    } else {
      result.plusDI.push(NaN);
      result.minusDI.push(NaN);
    }
  }

  // Calculate ADX
  const dx: number[] = [];
  for (let i = 0; i < result.plusDI.length; i++) {
    if (isNaN(result.plusDI[i]) || isNaN(result.minusDI[i])) {
      dx.push(NaN);
    } else {
      const diSum = result.plusDI[i] + result.minusDI[i];
      if (diSum === 0) {
        dx.push(0);
      } else {
        dx.push(Math.abs(result.plusDI[i] - result.minusDI[i]) / diSum * 100);
      }
    }
  }

  result.adx = calculateEMA(dx.filter(d => !isNaN(d)), period);

  // Pad to original length
  while (result.adx.length < candles.length) {
    result.adx.unshift(NaN);
  }

  return result;
}

function smoothWilder(data: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;

  for (let i = 0; i < period && i < data.length; i++) {
    sum += data[i];
  }
  result.push(sum);

  for (let i = period; i < data.length; i++) {
    sum = sum - (sum / period) + data[i];
    result.push(sum);
  }

  return result;
}

// ============================================================================
// Momentum Indicators
// ============================================================================

/**
 * Stochastic Oscillator
 */
export function calculateStochastic(
  candles: OHLCV[],
  kPeriod: number = 14,
  dPeriod: number = 3
): StochasticResult {
  const k: number[] = [];
  const d: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < kPeriod - 1) {
      k.push(NaN);
      continue;
    }

    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = i - kPeriod + 1; j <= i; j++) {
      highestHigh = Math.max(highestHigh, candles[j].high);
      lowestLow = Math.min(lowestLow, candles[j].low);
    }

    const range = highestHigh - lowestLow;
    if (range === 0) {
      k.push(50);
    } else {
      k.push(((candles[i].close - lowestLow) / range) * 100);
    }
  }

  // %D is SMA of %K
  const kWithoutNaN = k.filter(v => !isNaN(v));
  const smoothedK = calculateSMA(k, dPeriod);

  for (let i = 0; i < k.length; i++) {
    if (isNaN(smoothedK[i])) {
      d.push(NaN);
    } else {
      d.push(smoothedK[i]);
    }
  }

  return { k: smoothedK, d };
}

/**
 * Williams %R
 */
export function calculateWilliamsR(candles: OHLCV[], period: number = 14): number[] {
  const result: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = i - period + 1; j <= i; j++) {
      highestHigh = Math.max(highestHigh, candles[j].high);
      lowestLow = Math.min(lowestLow, candles[j].low);
    }

    const range = highestHigh - lowestLow;
    if (range === 0) {
      result.push(-50);
    } else {
      result.push(((highestHigh - candles[i].close) / range) * -100);
    }
  }

  return result;
}

/**
 * Momentum
 */
export function calculateMomentum(candles: OHLCV[], period: number = 10): number[] {
  const result: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      result.push(NaN);
      continue;
    }
    result.push(candles[i].close - candles[i - period].close);
  }

  return result;
}

/**
 * Rate of Change (ROC)
 */
export function calculateROC(candles: OHLCV[], period: number = 10): number[] {
  const result: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      result.push(NaN);
      continue;
    }
    const priorClose = candles[i - period].close;
    if (priorClose === 0) {
      result.push(NaN);
    } else {
      result.push(((candles[i].close - priorClose) / priorClose) * 100);
    }
  }

  return result;
}

/**
 * CCI (Commodity Channel Index)
 */
export function calculateCCI(candles: OHLCV[], period: number = 20): number[] {
  const result: number[] = [];
  const typicalPrices: number[] = candles.map(c => (c.high + c.low + c.close) / 3);
  const smaTP = calculateSMA(typicalPrices, period);

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    const meanDeviation = calculateMeanDeviation(typicalPrices, smaTP, i, period);
    if (meanDeviation === 0) {
      result.push(0);
    } else {
      result.push((typicalPrices[i] - smaTP[i]) / (0.015 * meanDeviation));
    }
  }

  return result;
}

function calculateMeanDeviation(data: number[], sma: number[], index: number, period: number): number {
  if (index < period - 1 || isNaN(sma[index])) return 0;

  let sum = 0;
  for (let j = index - period + 1; j <= index; j++) {
    sum += Math.abs(data[j] - sma[index]);
  }
  return sum / period;
}

/**
 * MFI (Money Flow Index)
 */
export function calculateMFI(candles: OHLCV[], period: number = 14): number[] {
  const result: number[] = [];
  const typicalPrices: number[] = candles.map(c => (c.high + c.low + c.close) / 3);
  const rawMoneyFlow: number[] = typicalPrices.map((tp, i) => tp * candles[i].volume);

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      result.push(NaN);
      continue;
    }

    let positiveFlow = 0;
    let negativeFlow = 0;

    for (let j = i - period + 1; j <= i; j++) {
      const tpChange = typicalPrices[j] - typicalPrices[j - 1];
      if (tpChange > 0) {
        positiveFlow += rawMoneyFlow[j];
      } else {
        negativeFlow += rawMoneyFlow[j];
      }
    }

    if (negativeFlow === 0) {
      result.push(100);
    } else {
      const moneyRatio = positiveFlow / negativeFlow;
      result.push(100 - (100 / (1 + moneyRatio)));
    }
  }

  return result;
}

// ============================================================================
// Volatility Indicators
// ============================================================================

/**
 * Bollinger Bands
 */
export function calculateBollingerBands(
  candles: OHLCV[],
  period: number = 20,
  stdDev: number = 2
): BollingerBandsResult {
  const closes = candles.map(c => c.close);
  const middle = calculateSMA(closes, period);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    let sum = 0;
    for (let j = 0; j < period; j++) {
      const diff = closes[i - j] - middle[i];
      sum += diff * diff;
    }
    const std = Math.sqrt(sum / period);

    upper.push(middle[i] + stdDev * std);
    lower.push(middle[i] - stdDev * std);
  }

  return { upper, middle, lower };
}

/**
 * ATR (Average True Range)
 */
export function calculateATR(candles: OHLCV[], period: number = 14): number[] {
  const tr: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const prevClose = candles[i - 1].close;

    const tr1 = high - low;
    const tr2 = Math.abs(high - prevClose);
    const tr3 = Math.abs(low - prevClose);
    tr.push(Math.max(tr1, tr2, tr3));
  }

  // Wilder's smoothing
  const result: number[] = [];
  let atr = 0;

  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      atr += tr[i];
      result.push(NaN);
    } else if (i === period) {
      atr = atr / period;
      result.push(atr);
    } else {
      atr = (atr * (period - 1) + tr[i]) / period;
      result.push(atr);
    }
  }

  return result;
}

/**
 * Keltner Channels
 */
export function calculateKeltnerChannels(
  candles: OHLCV[],
  emaPeriod: number = 20,
  atrPeriod: number = 10,
  multiplier: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = candles.map(c => c.close);
  const ema = calculateEMA(closes, emaPeriod);
  const atr = calculateATR(candles, atrPeriod);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (isNaN(ema[i]) || isNaN(atr[i])) {
      upper.push(NaN);
      lower.push(NaN);
    } else {
      upper.push(ema[i] + multiplier * atr[i]);
      lower.push(ema[i] - multiplier * atr[i]);
    }
  }

  return { upper, middle: ema, lower };
}

/**
 * Donchian Channels
 */
export function calculateDonchianChannels(
  candles: OHLCV[],
  period: number = 20
): { upper: number[]; middle: number[]; lower: number[] } {
  const upper: number[] = [];
  const middle: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      middle.push(NaN);
      lower.push(NaN);
      continue;
    }

    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (let j = i - period + 1; j <= i; j++) {
      highestHigh = Math.max(highestHigh, candles[j].high);
      lowestLow = Math.min(lowestLow, candles[j].low);
    }

    upper.push(highestHigh);
    lower.push(lowestLow);
    middle.push((highestHigh + lowestLow) / 2);
  }

  return { upper, middle, lower };
}

// ============================================================================
// Volume Indicators
// ============================================================================

/**
 * OBV (On-Balance Volume)
 */
export function calculateOBV(candles: OHLCV[]): number[] {
  const result: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    if (candles[i].close > candles[i - 1].close) {
      result.push(result[i - 1] + candles[i].volume);
    } else if (candles[i].close < candles[i - 1].close) {
      result.push(result[i - 1] - candles[i].volume);
    } else {
      result.push(result[i - 1]);
    }
  }

  return result;
}

/**
 * VWAP (Volume Weighted Average Price)
 */
export function calculateVWAP(candles: OHLCV[]): number[] {
  const result: number[] = [];
  let cumulativeTPV = 0;
  let cumulativeVolume = 0;

  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumulativeTPV += typicalPrice * candles[i].volume;
    cumulativeVolume += candles[i].volume;

    if (cumulativeVolume === 0) {
      result.push(typicalPrice);
    } else {
      result.push(cumulativeTPV / cumulativeVolume);
    }
  }

  return result;
}

/**
 * Accumulation/Distribution Line
 */
export function calculateADLine(candles: OHLCV[]): number[] {
  const result: number[] = [0];

  for (let i = 1; i < candles.length; i++) {
    const high = candles[i].high;
    const low = candles[i].low;
    const close = candles[i].close;
    const prevClose = candles[i - 1].close;

    const range = high - low;
    if (range === 0) {
      result.push(result[i - 1]);
    } else {
      const mfm = ((close - low) - (high - close)) / range;
      const mfv = mfm * candles[i].volume;
      result.push(result[i - 1] + mfv);
    }
  }

  return result;
}

/**
 * Chaikin Oscillator
 */
export function calculateChaikinOscillator(
  candles: OHLCV[],
  fastPeriod: number = 3,
  slowPeriod: number = 10
): number[] {
  const adLine = calculateADLine(candles);
  const fastEMA = calculateEMA(adLine, fastPeriod);
  const slowEMA = calculateEMA(adLine, slowPeriod);

  return fastEMA.map((fast, i) => {
    if (isNaN(fast) || isNaN(slowEMA[i])) return NaN;
    return fast - slowEMA[i];
  });
}

// ============================================================================
// Trend & Pattern Indicators
// ============================================================================

/**
 * Pivot Points (Standard)
 */
export function calculatePivotPoints(candles: OHLCV[]): PivotPointsResult {
  const pivot: number[] = [];
  const r1: number[] = [];
  const r2: number[] = [];
  const r3: number[] = [];
  const s1: number[] = [];
  const s2: number[] = [];
  const s3: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      pivot.push(NaN);
      r1.push(NaN);
      r2.push(NaN);
      r3.push(NaN);
      s1.push(NaN);
      s2.push(NaN);
      s3.push(NaN);
      continue;
    }

    const high = candles[i - 1].high;
    const low = candles[i - 1].low;
    const close = candles[i - 1].close;

    const pp = (high + low + close) / 3;
    pivot.push(pp);
    r1.push(2 * pp - low);
    s1.push(2 * pp - high);
    r2.push(pp + (high - low));
    s2.push(pp - (high - low));
    r3.push(high + 2 * (pp - low));
    s3.push(low - 2 * (high - pp));
  }

  return { pivot, r1, r2, r3, s1, s2, s3 };
}

/**
 * Aroon Indicator
 */
export function calculateAroon(candles: OHLCV[], period: number = 25): AroonResult {
  const aroonUp: number[] = [];
  const aroonDown: number[] = [];
  const oscillator: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      aroonUp.push(NaN);
      aroonDown.push(NaN);
      oscillator.push(NaN);
      continue;
    }

    let highestIdx = i;
    let lowestIdx = i;

    for (let j = i - period + 1; j <= i; j++) {
      if (candles[j].high > candles[highestIdx].high) highestIdx = j;
      if (candles[j].low < candles[lowestIdx].low) lowestIdx = j;
    }

    const up = ((period - (i - highestIdx)) / period) * 100;
    const down = ((period - (i - lowestIdx)) / period) * 100;

    aroonUp.push(up);
    aroonDown.push(down);
    oscillator.push(up - down);
  }

  return { aroonUp, aroonDown, oscillator };
}

/**
 * SuperTrend Indicator
 */
export function calculateSuperTrend(
  candles: OHLCV[],
  period: number = 10,
  multiplier: number = 3
): SuperTrendResult {
  const atr = calculateATR(candles, period);
  const upperBand: number[] = [];
  const lowerBand: number[] = [];
  const superTrend: number[] = [];
  const direction: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    if (i < period) {
      upperBand.push(NaN);
      lowerBand.push(NaN);
      superTrend.push(NaN);
      direction.push(0);
      continue;
    }

    const hl2 = (candles[i].high + candles[i].low) / 2;
    const atrVal = atr[i] * multiplier;

    const upper = hl2 + atrVal;
    const lower = hl2 - atrVal;

    upperBand.push(upper);
    lowerBand.push(lower);

    if (i === period) {
      superTrend.push(lower);
      direction.push(1);
    } else {
      const prevST = superTrend[i - 1];
      const prevDir = direction[i - 1];

      let currentST: number;
      let currentDir: number;

      if (candles[i].close > prevST) {
        currentST = lowerBand[i];
        currentDir = 1;
      } else if (candles[i].close < prevST) {
        currentST = upperBand[i];
        currentDir = -1;
      } else {
        currentST = prevST;
        currentDir = prevDir;
      }

      superTrend.push(currentST);
      direction.push(currentDir);
    }
  }

  return { values: superTrend, direction };
}

/**
 * Ichimoku Cloud
 */
export function calculateIchimoku(
  candles: OHLCV[],
  tenkanPeriod: number = 9,
  kijunPeriod: number = 26,
  senkouBPeriod: number = 52,
  senkouOffset: number = 26
): IchimokuResult {
  const tenkan: number[] = [];
  const kijun: number[] = [];
  const senkouA: number[] = [];
  const senkouB: number[] = [];

  for (let i = 0; i < candles.length; i++) {
    // Tenkan-sen (Conversion Line)
    if (i < tenkanPeriod - 1) {
      tenkan.push(NaN);
    } else {
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - tenkanPeriod + 1; j <= i; j++) {
        highest = Math.max(highest, candles[j].high);
        lowest = Math.min(lowest, candles[j].low);
      }
      tenkan.push((highest + lowest) / 2);
    }

    // Kijun-sen (Base Line)
    if (i < kijunPeriod - 1) {
      kijun.push(NaN);
    } else {
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - kijunPeriod + 1; j <= i; j++) {
        highest = Math.max(highest, candles[j].high);
        lowest = Math.min(lowest, candles[j].low);
      }
      kijun.push((highest + lowest) / 2);
    }

    // Senkou Span A (Leading Span A)
    if (i < kijunPeriod - 1 || isNaN(tenkan[i]) || isNaN(kijun[i])) {
      senkouA.push(NaN);
    } else {
      senkouA.push((tenkan[i] + kijun[i]) / 2);
    }

    // Senkou Span B (Leading Span B)
    if (i < senkouBPeriod - 1) {
      senkouB.push(NaN);
    } else {
      let highest = -Infinity;
      let lowest = Infinity;
      for (let j = i - senkouBPeriod + 1; j <= i; j++) {
        highest = Math.max(highest, candles[j].high);
        lowest = Math.min(lowest, candles[j].low);
      }
      senkouB.push((highest + lowest) / 2);
    }
  }

  return { tenkan, kijun, senkouA, senkouB };
}

// ============================================================================
// Awesome Oscillator
// ============================================================================

/**
 * Awesome Oscillator
 */
export function calculateAwesomeOscillator(candles: OHLCV[], period1: number = 5, period2: number = 34): number[] {
  const medianPrice: number[] = candles.map(c => (c.high + c.low) / 2);
  const sma1 = calculateSMA(medianPrice, period1);
  const sma2 = calculateSMA(medianPrice, period2);

  return sma1.map((s1, i) => {
    if (isNaN(s1) || isNaN(sma2[i])) return NaN;
    return s1 - sma2[i];
  });
}

// ============================================================================
// All Indicators Calculator
// ============================================================================

/**
 * Calculate all technical indicators for a set of candles
 */
export function calculateAllIndicators(candles: OHLCV[]): AllIndicators {
  const closes = candles.map(c => c.close);

  return {
    sma: { values: calculateSMA(closes, 20) },
    ema: { values: calculateEMA(closes, 20) },
    rsi: { values: calculateRSI(candles, 14) },
    macd: calculateMACD(candles),
    bollinger: calculateBollingerBands(candles),
    atr: { values: calculateATR(candles, 14) },
    stochastic: calculateStochastic(candles),
    adx: calculateADX(candles),
    cci: { values: calculateCCI(candles) },
    williamsR: { values: calculateWilliamsR(candles) },
    obv: { values: calculateOBV(candles) },
    vwap: { values: calculateVWAP(candles) },
    momentum: { values: calculateMomentum(candles) },
    roc: { values: calculateROC(candles) },
    mfi: { values: calculateMFI(candles) },
    pivotPoints: calculatePivotPoints(candles),
    aroon: calculateAroon(candles),
    ichimoku: calculateIchimoku(candles),
    superTrend: calculateSuperTrend(candles),
  };
}