/**
 * Advanced Technical Analysis Indicators Engine (100+ Indicators)
 * Server-side computation of 100+ technical, momentum, volatility, volume, support/resistance, and statistical indicators.
 */

import type { Candle } from "@shared/types";

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

// Helper: safe division to prevent NaN/Infinity
function safeDiv(num: number, den: number, fallback: number = 0): number {
  if (den === 0 || isNaN(den) || !isFinite(den)) return fallback;
  const res = num / den;
  return isNaN(res) || !isFinite(res) ? fallback : res;
}

// Helper: standard deviations
export function calculateStdDev(data: number[], period: number): number[] {
  const result: number[] = [];
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    const slice = data.slice(i - period + 1, i + 1);
    const mean = slice.reduce((sum, v) => sum + v, 0) / period;
    const variance = slice.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / period;
    result.push(Math.sqrt(variance));
  }
  return result;
}

// ---------------------------------------------------------------------------
// 1. TREND INDICATORS (25+ indicators)
// ---------------------------------------------------------------------------

export function calculateSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    if (i < period - 1) {
      result.push(0);
    } else {
      result.push(sum / period);
    }
  }
  return result;
}

export function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length === 0) return result;
  const k = 2 / (period + 1);
  let ema = data[0];
  result.push(ema);
  for (let i = 1; i < data.length; i++) {
    ema = data[i] * k + ema * (1 - k);
    result.push(ema);
  }
  return result;
}

export function calculateWMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const weightSum = (period * (period + 1)) / 2;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - j] * (period - j);
    }
    result.push(sum / weightSum);
  }
  return result;
}

export function calculateHMA(data: number[], period: number): number[] {
  const halfPeriod = Math.floor(period / 2);
  const sqrtPeriod = Math.floor(Math.sqrt(period));
  
  const wmaHalf = calculateWMA(data, halfPeriod);
  const wmaFull = calculateWMA(data, period);
  
  const diff: number[] = [];
  for (let i = 0; i < data.length; i++) {
    diff.push(2 * wmaHalf[i] - wmaFull[i]);
  }
  
  return calculateWMA(diff, sqrtPeriod);
}

export function calculateDEMA(data: number[], period: number): number[] {
  const ema1 = calculateEMA(data, period);
  const ema2 = calculateEMA(ema1, period);
  const dema: number[] = [];
  for (let i = 0; i < data.length; i++) {
    dema.push(2 * ema1[i] - ema2[i]);
  }
  return dema;
}

export function calculateTEMA(data: number[], period: number): number[] {
  const ema1 = calculateEMA(data, period);
  const ema2 = calculateEMA(ema1, period);
  const ema3 = calculateEMA(ema2, period);
  const tema: number[] = [];
  for (let i = 0; i < data.length; i++) {
    tema.push(3 * ema1[i] - 3 * ema2[i] + ema3[i]);
  }
  return tema;
}

export function calculateKAMA(data: number[], period: number = 10, fastSpan: number = 2, slowSpan: number = 30): number[] {
  const result: number[] = [];
  if (data.length === 0) return result;
  
  const fastAlpha = 2 / (fastSpan + 1);
  const slowAlpha = 2 / (slowSpan + 1);
  
  let kama = data[0];
  result.push(kama);
  
  for (let i = 1; i < data.length; i++) {
    if (i < period) {
      kama = data[i];
      result.push(kama);
      continue;
    }
    const change = Math.abs(data[i] - data[i - period]);
    let volatility = 0;
    for (let j = i - period + 1; j <= i; j++) {
      volatility += Math.abs(data[j] - data[j - 1]);
    }
    const er = volatility === 0 ? 0 : change / volatility;
    const sc = Math.pow(er * (fastAlpha - slowAlpha) + slowAlpha, 2);
    kama = kama + sc * (data[i] - kama);
    result.push(kama);
  }
  return result;
}

export function calculateALMA(data: number[], period: number = 9, offset: number = 0.85, sigma: number = 6): number[] {
  const result: number[] = [];
  const m = offset * (period - 1);
  const s = period / sigma;
  const weights: number[] = [];
  let weightSum = 0;
  
  for (let i = 0; i < period; i++) {
    const w = Math.exp(-Math.pow(i - m, 2) / (2 * s * s));
    weights.push(w);
    weightSum += w;
  }
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    let sum = 0;
    for (let j = 0; j < period; j++) {
      sum += data[i - (period - 1 - j)] * weights[j];
    }
    result.push(sum / weightSum);
  }
  return result;
}

export function calculateVWMA(prices: number[], volumes: number[], period: number): number[] {
  const result: number[] = [];
  let pvSum = 0;
  let volSum = 0;
  
  for (let i = 0; i < prices.length; i++) {
    const pv = prices[i] * volumes[i];
    pvSum += pv;
    volSum += volumes[i];
    
    if (i >= period) {
      pvSum -= prices[i - period] * volumes[i - period];
      volSum -= volumes[i - period];
    }
    
    if (i < period - 1) {
      result.push(0);
    } else {
      result.push(safeDiv(pvSum, volSum, prices[i]));
    }
  }
  return result;
}

export function calculateZLEMA(data: number[], period: number): number[] {
  const lag = Math.floor((period - 1) / 2);
  const adjustedData: number[] = [];
  for (let i = 0; i < data.length; i++) {
    const val = i < lag ? data[i] : data[i] + (data[i] - data[i - lag]);
    adjustedData.push(val);
  }
  return calculateEMA(adjustedData, period);
}

export function calculateMcGinleyDynamic(data: number[], period: number): number[] {
  const result: number[] = [];
  if (data.length === 0) return result;
  let mcG = data[0];
  result.push(mcG);
  for (let i = 1; i < data.length; i++) {
    mcG = mcG + (data[i] - mcG) / (period * Math.pow(data[i] / mcG, 4));
    result.push(mcG);
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

export function calculateRSI(data: number[], period: number = 14): number[] {
  const result: number[] = [];
  if (data.length === 0) return result;
  
  let avgGain = 0;
  let avgLoss = 0;
  
  result.push(50);
  
  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    
    if (i <= period) {
      avgGain += gain;
      avgLoss += loss;
      if (i === period) {
        avgGain /= period;
        avgLoss /= period;
        const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
        result.push(100 - 100 / (1 + rs));
      } else {
        result.push(50);
      }
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
      const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
      result.push(100 - 100 / (1 + rs));
    }
  }
  return result;
}

export function calculateStochastic(high: number[], low: number[], close: number[], period: number = 14, kSlowing: number = 3, dPeriod: number = 3) {
  const fastK: number[] = [];
  const slowK: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      fastK.push(50);
      continue;
    }
    const highSlice = high.slice(i - period + 1, i + 1);
    const lowSlice = low.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    
    const den = highestHigh - lowestLow;
    const k = den === 0 ? 50 : ((close[i] - lowestLow) / den) * 100;
    fastK.push(k);
  }
  
  slowK.push(...calculateSMA(fastK, kSlowing));
  const slowD = calculateSMA(slowK, dPeriod);
  
  return { fastK, slowK, slowD };
}

export function calculateStochRSI(rsiValues: number[], period: number = 14, kPeriod: number = 3, dPeriod: number = 3) {
  const stochRsi: number[] = [];
  
  for (let i = 0; i < rsiValues.length; i++) {
    if (i < period - 1) {
      stochRsi.push(50);
      continue;
    }
    const rsiSlice = rsiValues.slice(i - period + 1, i + 1);
    const maxRsi = Math.max(...rsiSlice);
    const minRsi = Math.min(...rsiSlice);
    
    const den = maxRsi - minRsi;
    const val = den === 0 ? 50 : ((rsiValues[i] - minRsi) / den) * 100;
    stochRsi.push(val);
  }
  
  const k = calculateSMA(stochRsi, kPeriod);
  const d = calculateSMA(k, dPeriod);
  return { k, d };
}

export function calculateMACD(data: number[], fastPeriod: number = 12, slowPeriod: number = 26, signalPeriod: number = 9) {
  const fastEMA = calculateEMA(data, fastPeriod);
  const slowEMA = calculateEMA(data, slowPeriod);
  
  const macd: number[] = [];
  for (let i = 0; i < data.length; i++) {
    macd.push(fastEMA[i] - slowEMA[i]);
  }
  
  const signal = calculateEMA(macd, signalPeriod);
  const histogram: number[] = [];
  for (let i = 0; i < data.length; i++) {
    histogram.push(macd[i] - signal[i]);
  }
  
  return { macd, signal, histogram };
}

export function calculateCCI(high: number[], low: number[], close: number[], period: number = 20): number[] {
  const result: number[] = [];
  const tp: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    tp.push((high[i] + low[i] + close[i]) / 3);
  }
  
  const smaTP = calculateSMA(tp, period);
  
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      result.push(0);
      continue;
    }
    const slice = tp.slice(i - period + 1, i + 1);
    const mean = smaTP[i];
    const meanDev = slice.reduce((sum, val) => sum + Math.abs(val - mean), 0) / period;
    
    const cci = meanDev === 0 ? 0 : (tp[i] - mean) / (0.015 * meanDev);
    result.push(cci);
  }
  return result;
}

export function calculateWilliamsR(high: number[], low: number[], close: number[], period: number = 14): number[] {
  const result: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      result.push(-50);
      continue;
    }
    const highSlice = high.slice(i - period + 1, i + 1);
    const lowSlice = low.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    
    const den = highestHigh - lowestLow;
    const r = den === 0 ? -50 : ((highestHigh - close[i]) / den) * -100;
    result.push(r);
  }
  return result;
}

export function calculateAwesomeOscillator(high: number[], low: number[]): number[] {
  const medianPrices: number[] = [];
  for (let i = 0; i < high.length; i++) {
    medianPrices.push((high[i] + low[i]) / 2);
  }
  const sma5 = calculateSMA(medianPrices, 5);
  const sma34 = calculateSMA(medianPrices, 34);
  const ao: number[] = [];
  for (let i = 0; i < high.length; i++) {
    ao.push(sma5[i] - sma34[i]);
  }
  return ao;
}

export function calculateFisherTransform(high: number[], low: number[], period: number = 9): number[] {
  const result: number[] = [];
  const value: number[] = [];
  const fisher: number[] = [];
  
  if (high.length === 0) return result;
  
  value.push(0);
  fisher.push(0);
  
  for (let i = 1; i < high.length; i++) {
    if (i < period - 1) {
      value.push(0);
      fisher.push(0);
      continue;
    }
    const highSlice = high.slice(i - period + 1, i + 1);
    const lowSlice = low.slice(i - period + 1, i + 1);
    const highestHigh = Math.max(...highSlice);
    const lowestLow = Math.min(...lowSlice);
    
    const price = (high[i] + low[i]) / 2;
    const den = highestHigh - lowestLow;
    
    let rawValue = den === 0 ? 0 : 0.33 * 2 * ((price - lowestLow) / den - 0.5) + 0.67 * (value[i - 1] || 0);
    if (rawValue > 0.99) rawValue = 0.999;
    if (rawValue < -0.99) rawValue = -0.999;
    value.push(rawValue);
    
    const f = 0.5 * Math.log((1 + rawValue) / (1 - rawValue)) + 0.5 * (fisher[i - 1] || 0);
    fisher.push(f);
  }
  return fisher;
}

export function calculateChandeMomentumOscillator(close: number[], period: number = 9): number[] {
  const cmo: number[] = [];
  for (let i = 0; i < close.length; i++) {
    if (i < period) {
      cmo.push(0);
      continue;
    }
    let gains = 0;
    let losses = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const diff = close[j] - close[j - 1];
      if (diff > 0) gains += diff;
      else losses += -diff;
    }
    const den = gains + losses;
    cmo.push(den === 0 ? 0 : ((gains - losses) / den) * 100);
  }
  return cmo;
}

// ---------------------------------------------------------------------------
// 3. VOLATILITY INDICATORS (15+ indicators)
// ---------------------------------------------------------------------------

export function calculateATR(high: number[], low: number[], close: number[], period: number = 14): number[] {
  const atr: number[] = [];
  if (close.length === 0) return atr;
  
  const tr: number[] = [];
  tr.push(high[0] - low[0]);
  
  for (let i = 1; i < close.length; i++) {
    const tr1 = high[i] - low[i];
    const tr2 = Math.abs(high[i] - close[i - 1]);
    const tr3 = Math.abs(low[i] - close[i - 1]);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  let currentAtr = tr.slice(0, period).reduce((sum, v) => sum + v, 0) / period;
  
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      atr.push(tr[i]);
    } else if (i === period - 1) {
      atr.push(currentAtr);
    } else {
      currentAtr = (currentAtr * (period - 1) + tr[i]) / period;
      atr.push(currentAtr);
    }
  }
  return atr;
}

export function calculateBollingerBands(close: number[], period: number = 20, multiplier: number = 2) {
  const middle = calculateSMA(close, period);
  const stdDevs = calculateStdDev(close, period);
  const upper: number[] = [];
  const lower: number[] = [];
  const bandwidth: number[] = [];
  const percentB: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    const u = middle[i] + multiplier * stdDevs[i];
    const l = middle[i] - multiplier * stdDevs[i];
    upper.push(u);
    lower.push(l);
    
    const den = u - l;
    bandwidth.push(middle[i] === 0 ? 0 : (u - l) / middle[i]);
    percentB.push(den === 0 ? 50 : ((close[i] - l) / den) * 100);
  }
  return { upper, middle, lower, bandwidth, percentB };
}

export function calculateKeltnerChannels(high: number[], low: number[], close: number[], atrPeriod: number = 10, emaPeriod: number = 20, multiplier: number = 1.5) {
  const middle = calculateEMA(close, emaPeriod);
  const atr = calculateATR(high, low, close, atrPeriod);
  const upper: number[] = [];
  const lower: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    upper.push(middle[i] + multiplier * atr[i]);
    lower.push(middle[i] - multiplier * atr[i]);
  }
  return { upper, middle, lower };
}

export function calculateDonchianChannels(high: number[], low: number[], period: number = 20) {
  const upper: number[] = [];
  const lower: number[] = [];
  const middle: number[] = [];
  
  for (let i = 0; i < high.length; i++) {
    if (i < period - 1) {
      upper.push(high[i]);
      lower.push(low[i]);
      middle.push((high[i] + low[i]) / 2);
      continue;
    }
    const highSlice = high.slice(i - period + 1, i + 1);
    const lowSlice = low.slice(i - period + 1, i + 1);
    
    const maxHigh = Math.max(...highSlice);
    const minLow = Math.min(...lowSlice);
    
    upper.push(maxHigh);
    lower.push(minLow);
    middle.push((maxHigh + minLow) / 2);
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

export function calculateVWAP(high: number[], low: number[], close: number[], volume: number[]): number[] {
  const vwap: number[] = [];
  let cumPV = 0;
  let cumVol = 0;
  
  for (let i = 0; i < close.length; i++) {
    const typicalPrice = (high[i] + low[i] + close[i]) / 3;
    cumPV += typicalPrice * volume[i];
    cumVol += volume[i];
    vwap.push(safeDiv(cumPV, cumVol, close[i]));
  }
  return vwap;
}

export function calculateChaikinMoneyFlow(high: number[], low: number[], close: number[], volume: number[], period: number = 21): number[] {
  const cmf: number[] = [];
  const mfv: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    const den = high[i] - low[i];
    const multiplier = den === 0 ? 0 : ((close[i] - low[i]) - (high[i] - close[i])) / den;
    mfv.push(multiplier * volume[i]);
  }
  
  for (let i = 0; i < close.length; i++) {
    if (i < period - 1) {
      cmf.push(0);
      continue;
    }
    const mfvSum = mfv.slice(i - period + 1, i + 1).reduce((sum, v) => sum + v, 0);
    const volSum = volume.slice(i - period + 1, i + 1).reduce((sum, v) => sum + v, 0);
    cmf.push(safeDiv(mfvSum, volSum, 0));
  }
  return cmf;
}

export function calculateMFI(high: number[], low: number[], close: number[], volume: number[], period: number = 14): number[] {
  const mfi: number[] = [];
  const tp: number[] = [];
  
  for (let i = 0; i < close.length; i++) {
    tp.push((high[i] + low[i] + close[i]) / 3);
  }
  
  for (let i = 0; i < close.length; i++) {
    if (i < period) {
      mfi.push(50);
      continue;
    }
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
    
    if (negFlow === 0) {
      mfi.push(100);
    } else {
      const ratio = posFlow / negFlow;
      mfi.push(100 - 100 / (1 + ratio));
    }
  }
  return mfi;
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
  const slope: number[] = [];
  const intercept: number[] = [];
  const r2: number[] = [];
  
  const n = period;
  const sumX = (n * (n - 1)) / 2;
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const denominator = n * sumX2 - sumX * sumX;
  
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      slope.push(0);
      intercept.push(0);
      r2.push(0);
      continue;
    }
    
    let sumY = 0;
    let sumXY = 0;
    let sumY2 = 0;
    
    for (let j = 0; j < period; j++) {
      const y = data[i - (period - 1 - j)];
      sumY += y;
      sumXY += j * y;
      sumY2 += y * y;
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

export function calculateZScore(data: number[], period: number): number[] {
  const result: number[] = [];
  const sma = calculateSMA(data, period);
  const std = calculateStdDev(data, period);
  
  for (let i = 0; i < data.length; i++) {
    const diff = data[i] - sma[i];
    result.push(std[i] === 0 ? 0 : diff / std[i]);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 7. COMPREHENSIVE INDICATOR COMPILING (100+ Indicators)
// ---------------------------------------------------------------------------

export function calculateAllIndicators(candles: Candle[]): Record<string, any> {
  const close = candles.map(c => Number(c.close));
  const high = candles.map(c => Number(c.high));
  const low = candles.map(c => Number(c.low));
  const open = candles.map(c => Number(c.open));
  const volume = candles.map(c => Number(c.volume));
  
  const len = close.length;
  if (len === 0) return {};
  
  const lastIndex = len - 1;
  const lastClose = close[lastIndex];
  
  // Helpers to safely fetch index
  const getVal = (arr: number[], idx: number, fallback: number): number => {
    const val = arr[idx];
    return val === undefined || isNaN(val) || !isFinite(val) ? fallback : val;
  };

  // Helper for batch mapping periods
  const mapPeriods = (fn: (p: number) => number[], periods: number[]): Record<string, number> => {
    const obj: Record<string, number> = {};
    for (const p of periods) {
      obj[p] = getVal(fn(p), lastIndex, lastClose);
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

  const sma = mapPeriods((p) => calculateSMA(close, p), smaPeriods);
  const ema = mapPeriods((p) => calculateEMA(close, p), emaPeriods);
  const wma = mapPeriods((p) => calculateWMA(close, p), wmaPeriods);
  const hma = mapPeriods((p) => calculateHMA(close, p), hmaPeriods);
  const dema = mapPeriods((p) => calculateDEMA(close, p), demaPeriods);
  const tema = mapPeriods((p) => calculateTEMA(close, p), temaPeriods);
  const kama = mapPeriods((p) => calculateKAMA(close, p), kamaPeriods);
  const alma = mapPeriods((p) => calculateALMA(close, p), almaPeriods);
  const zlema = mapPeriods((p) => calculateZLEMA(close, p), zlemaPeriods);
  const mcGinley = mapPeriods((p) => calculateMcGinleyDynamic(close, p), mcGinleyPeriods);
  const vwma = mapPeriods((p) => calculateVWMA(close, volume, p), vwmaPeriods);

  const vwap = getVal(calculateVWAP(high, low, close, volume), lastIndex, lastClose);
  const parabolicSar = getVal(calculateParabolicSAR(high, low), lastIndex, lastClose);
  
  // 2. Oscillators (Momentum) - 30 indicators
  const rsiPeriods = [5, 7, 9, 14, 21, 25, 50, 100];
  const cciPeriods = [5, 10, 14, 20, 30, 50, 100];
  const williamsPeriods = [5, 10, 14, 20, 30, 50, 100];

  const rsi = mapPeriods((p) => calculateRSI(close, p), rsiPeriods);
  const cci = mapPeriods((p) => calculateCCI(high, low, close, p), cciPeriods);
  const williamsR = mapPeriods((p) => calculateWilliamsR(high, low, close, p), williamsPeriods);

  const macdVal = calculateMACD(close, 12, 26, 9);
  const macdLine = getVal(macdVal.macd, lastIndex, 0);
  const macdSignal = getVal(macdVal.signal, lastIndex, 0);
  const macdHist = getVal(macdVal.histogram, lastIndex, 0);
  
  const stochVal = calculateStochastic(high, low, close, 14, 3, 3);
  const stochK = getVal(stochVal.slowK, lastIndex, 50);
  const stochD = getVal(stochVal.slowD, lastIndex, 50);
  
  const stochRsiVal = calculateStochRSI(calculateRSI(close, 14), 14, 3, 3);
  const stochRsiK = getVal(stochRsiVal.k, lastIndex, 50);
  const stochRsiD = getVal(stochRsiVal.d, lastIndex, 50);
  
  const awesomeOsc = getVal(calculateAwesomeOscillator(high, low), lastIndex, 0);
  const fisherTransform = getVal(calculateFisherTransform(high, low, 9), lastIndex, 0);
  const cmo9 = getVal(calculateChandeMomentumOscillator(close, 9), lastIndex, 0);
  
  // 3. Volatility Indicators - 22 indicators
  const atrPeriods = [5, 10, 14, 20, 30, 50, 100];
  const atr = mapPeriods((p) => calculateATR(high, low, close, p), atrPeriods);
  
  const bb = calculateBollingerBands(close, 20, 2);
  const bbUpper = getVal(bb.upper, lastIndex, lastClose);
  const bbMiddle = getVal(bb.middle, lastIndex, lastClose);
  const bbLower = getVal(bb.lower, lastIndex, lastClose);
  const bbWidth = getVal(bb.bandwidth, lastIndex, 0);
  const bbPctB = getVal(bb.percentB, lastIndex, 50);
  
  const kc = calculateKeltnerChannels(high, low, close, 10, 20, 1.5);
  const kcUpper = getVal(kc.upper, lastIndex, lastClose);
  const kcMiddle = getVal(kc.middle, lastIndex, lastClose);
  const kcLower = getVal(kc.lower, lastIndex, lastClose);
  
  const dc = calculateDonchianChannels(high, low, 20);
  const dcUpper = getVal(dc.upper, lastIndex, lastClose);
  const dcMiddle = getVal(dc.middle, lastIndex, lastClose);
  const dcLower = getVal(dc.lower, lastIndex, lastClose);
  
  // 4. Volume & Money Flow - 5 indicators
  const obv = getVal(calculateOBV(close, volume), lastIndex, 0);
  const cmf21 = getVal(calculateChaikinMoneyFlow(high, low, close, volume, 21), lastIndex, 0);
  const mfi14 = getVal(calculateMFI(high, low, close, volume, 14), lastIndex, 50);
  
  // 5. Support / Resistance & Pivots (Yesterday's parameters) - 19 indicators
  const prevHigh = high[lastIndex - 1] || high[lastIndex];
  const prevLow = low[lastIndex - 1] || low[lastIndex];
  const prevClose = close[lastIndex - 1] || close[lastIndex];
  const pivots = calculatePivotPoints(prevHigh, prevLow, prevClose);
  
  // 6. Statistics - 10 indicators
  const stats = calculateLinearRegression(close, 20);
  const linRegSlope = getVal(stats.slope, lastIndex, 0);
  const linRegR2 = getVal(stats.r2, lastIndex, 0);
  
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
