/**
 * Canonical Technical Indicators Engine
 *
 * Single deterministic mathematical source of truth for:
 * - Backtesting Engine V3
 * - Technical Screener & Snapshot Workers
 * - Strategy Evaluation & Realtime Alerting
 * - Frontend TradingView Lightweight Charts & Technical Panels
 *
 * Guaranteed Invariants:
 * - Deterministic: identical input series + params = identical values across all consumers.
 * - Zero lookahead: at index i, only data from bars 0..i is used.
 * - Strict warmup: returns null for periods before mathematical definition is valid.
 * - Zero division protection: handled safely without producing NaN or Infinity.
 */

import type {
  OHLCV,
  MACDResult,
  BollingerBandsResult,
  DonchianResult,
  ADXResult,
  StochasticResult,
  SuperTrendResult,
  CanonicalIndicatorsSnapshot,
} from "./types";

export const INDICATOR_ENGINE_VERSION = "1.0.0";

// ============================================================================
// Helper: Extract price / candle field array
// ============================================================================

function extractCloses(data: (number | { close?: number; c?: number })[]): number[] {
  return data.map((d) => {
    if (typeof d === "number") return d;
    if ("close" in d && typeof d.close === "number") return d.close;
    if ("c" in d && typeof d.c === "number") return d.c;
    return NaN;
  });
}

// ============================================================================
// 1. Simple Moving Average (SMA)
// ============================================================================

export function computeSMA(
  series: (number | { close?: number; c?: number })[],
  period: number
): (number | null)[] {
  const values = extractCloses(series);
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || period > n) return result;

  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  result[period - 1] = sum / period;

  for (let i = period; i < n; i++) {
    sum += values[i] - values[i - period];
    result[i] = sum / period;
  }

  return result;
}

// ============================================================================
// 2. Exponential Moving Average (EMA)
// ============================================================================

export function computeEMA(
  series: (number | { close?: number; c?: number })[],
  period: number
): (number | null)[] {
  const values = extractCloses(series);
  const n = values.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || period > n) return result;

  const k = 2 / (period + 1);

  // Seed with SMA of first `period` bars
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += values[i];
  }
  let prev = sum / period;
  result[period - 1] = prev;

  for (let i = period; i < n; i++) {
    prev = values[i] * k + prev * (1 - k);
    result[i] = prev;
  }

  return result;
}

// ============================================================================
// 3. Relative Strength Index (RSI) - Wilder's Smoothing
// ============================================================================

export function computeRSI(
  series: (number | { close?: number; c?: number })[],
  period: number = 14
): (number | null)[] {
  const closes = extractCloses(series);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n <= period) return result;

  let avgGain = 0;
  let avgLoss = 0;

  // Initial sum of gains and losses for first `period` changes (bars 1..period)
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }

  avgGain /= period;
  avgLoss /= period;

  if (avgLoss === 0) {
    result[period] = 100;
  } else if (avgGain === 0) {
    result[period] = 0;
  } else {
    result[period] = 100 - 100 / (1 + avgGain / avgLoss);
  }

  // Wilder's recursive smoothing
  for (let i = period + 1; i < n; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    if (avgLoss === 0) {
      result[i] = 100;
    } else if (avgGain === 0) {
      result[i] = 0;
    } else {
      result[i] = 100 - 100 / (1 + avgGain / avgLoss);
    }
  }

  return result;
}

// ============================================================================
// 4. Moving Average Convergence Divergence (MACD)
// ============================================================================

export function computeMACD(
  series: (number | { close?: number; c?: number })[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): MACDResult {
  const closes = extractCloses(series);
  const n = closes.length;

  const macd: (number | null)[] = new Array(n).fill(null);
  const signal: (number | null)[] = new Array(n).fill(null);
  const histogram: (number | null)[] = new Array(n).fill(null);

  if (slowPeriod <= 0 || fastPeriod <= 0 || n < slowPeriod) {
    return { macd, signal, histogram };
  }

  const fastEMA = computeEMA(closes, fastPeriod);
  const slowEMA = computeEMA(closes, slowPeriod);

  for (let i = 0; i < n; i++) {
    const f = fastEMA[i];
    const s = slowEMA[i];
    if (f !== null && s !== null) {
      macd[i] = f - s;
    }
  }

  // Calculate signal line (EMA of MACD line over valid MACD entries)
  const firstMacdIdx = macd.findIndex((v) => v !== null);
  if (firstMacdIdx !== -1) {
    const validMacd = macd.slice(firstMacdIdx).filter((v): v is number => v !== null);
    const signalEmaValid = computeEMA(validMacd, signalPeriod);

    for (let i = 0; i < signalEmaValid.length; i++) {
      const originalIdx = firstMacdIdx + i;
      const sig = signalEmaValid[i];
      signal[originalIdx] = sig;

      const m = macd[originalIdx];
      if (m !== null && sig !== null) {
        histogram[originalIdx] = m - sig;
      }
    }
  }

  return { macd, signal, histogram };
}

// ============================================================================
// 5. Average True Range (ATR) - Wilder's Smoothing
// ============================================================================

export function computeATR(
  candles: (OHLCV | { high: number; low: number; close: number; h?: number; l?: number; c?: number })[],
  period: number = 14
): (number | null)[] {
  const n = candles.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n < period) return result;

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;
  const getC = (c: any) => c.close ?? c.c;

  const trValues: number[] = new Array(n);
  trValues[0] = getH(candles[0]) - getL(candles[0]);

  for (let i = 1; i < n; i++) {
    const h = getH(candles[i]);
    const l = getL(candles[i]);
    const prevC = getC(candles[i - 1]);
    trValues[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));
  }

  // Initial ATR is simple average of first `period` TRs
  let atr = 0;
  for (let i = 0; i < period; i++) {
    atr += trValues[i];
  }
  atr /= period;
  result[period - 1] = atr;

  // Wilder's smoothing
  for (let i = period; i < n; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period;
    result[i] = atr;
  }

  return result;
}

// ============================================================================
// 6. Bollinger Bands
// ============================================================================

export function computeBollingerBands(
  series: (number | { close?: number; c?: number })[],
  period: number = 20,
  stdDevMultiplier: number = 2
): BollingerBandsResult {
  const closes = extractCloses(series);
  const n = closes.length;

  const upper: (number | null)[] = new Array(n).fill(null);
  const middle = computeSMA(closes, period);
  const lower: (number | null)[] = new Array(n).fill(null);
  const width: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n < period) {
    return { upper, middle, lower, width };
  }

  for (let i = period - 1; i < n; i++) {
    const mid = middle[i];
    if (mid === null) continue;

    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - mid) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    const up = mid + sd * stdDevMultiplier;
    const low = mid - sd * stdDevMultiplier;

    upper[i] = up;
    lower[i] = low;
    width[i] = mid !== 0 ? (up - low) / mid : null;
  }

  return { upper, middle, lower, width };
}

// ============================================================================
// 7. Donchian Channels
// ============================================================================

export function computeDonchian(
  candles: (OHLCV | { high: number; low: number; h?: number; l?: number })[],
  period: number = 20
): DonchianResult {
  const n = candles.length;
  const upper: (number | null)[] = new Array(n).fill(null);
  const middle: (number | null)[] = new Array(n).fill(null);
  const lower: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n < period) {
    return { upper, middle, lower };
  }

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;

  for (let i = period - 1; i < n; i++) {
    let maxH = -Infinity;
    let minL = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const h = getH(candles[j]);
      const l = getL(candles[j]);
      if (h > maxH) maxH = h;
      if (l < minL) minL = l;
    }
    upper[i] = maxH;
    lower[i] = minL;
    middle[i] = (maxH + minL) / 2;
  }

  return { upper, middle, lower };
}

// ============================================================================
// 8. Average Directional Index (ADX)
// ============================================================================

export function computeADX(
  candles: (OHLCV | { high: number; low: number; close: number; h?: number; l?: number; c?: number })[],
  period: number = 14
): ADXResult {
  const n = candles.length;
  const adx: (number | null)[] = new Array(n).fill(null);
  const plusDI: (number | null)[] = new Array(n).fill(null);
  const minusDI: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n < period * 2) {
    return { adx, plusDI, minusDI };
  }

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;
  const getC = (c: any) => c.close ?? c.c;

  const tr: number[] = new Array(n).fill(0);
  const plusDM: number[] = new Array(n).fill(0);
  const minusDM: number[] = new Array(n).fill(0);

  tr[0] = getH(candles[0]) - getL(candles[0]);

  for (let i = 1; i < n; i++) {
    const h = getH(candles[i]);
    const l = getL(candles[i]);
    const prevH = getH(candles[i - 1]);
    const prevL = getL(candles[i - 1]);
    const prevC = getC(candles[i - 1]);

    tr[i] = Math.max(h - l, Math.abs(h - prevC), Math.abs(l - prevC));

    const upMove = h - prevH;
    const downMove = prevL - l;

    if (upMove > downMove && upMove > 0) {
      plusDM[i] = upMove;
    }
    if (downMove > upMove && downMove > 0) {
      minusDM[i] = downMove;
    }
  }

  // Initial sums
  let smoothTR = 0;
  let smoothPlusDM = 0;
  let smoothMinusDM = 0;

  for (let i = 1; i <= period; i++) {
    smoothTR += tr[i];
    smoothPlusDM += plusDM[i];
    smoothMinusDM += minusDM[i];
  }

  const dxValues: (number | null)[] = new Array(n).fill(null);

  const calcDI = (idx: number, sTR: number, sPDM: number, sMDM: number) => {
    if (sTR === 0) return;
    const pDI = (sPDM / sTR) * 100;
    const mDI = (sMDM / sTR) * 100;
    plusDI[idx] = pDI;
    minusDI[idx] = mDI;
    const diSum = pDI + mDI;
    dxValues[idx] = diSum !== 0 ? (Math.abs(pDI - mDI) / diSum) * 100 : 0;
  };

  calcDI(period, smoothTR, smoothPlusDM, smoothMinusDM);

  for (let i = period + 1; i < n; i++) {
    smoothTR = smoothTR - smoothTR / period + tr[i];
    smoothPlusDM = smoothPlusDM - smoothPlusDM / period + plusDM[i];
    smoothMinusDM = smoothMinusDM - smoothMinusDM / period + minusDM[i];
    calcDI(i, smoothTR, smoothPlusDM, smoothMinusDM);
  }

  // Smooth DX to get ADX
  let adxSum = 0;
  let validCount = 0;
  const startDxIdx = period;
  const endFirstAdxIdx = period + period - 1;

  if (n > endFirstAdxIdx) {
    for (let i = startDxIdx; i <= endFirstAdxIdx; i++) {
      if (dxValues[i] !== null) {
        adxSum += dxValues[i]!;
        validCount++;
      }
    }
    if (validCount === period) {
      let adxVal = adxSum / period;
      adx[endFirstAdxIdx] = adxVal;

      for (let i = endFirstAdxIdx + 1; i < n; i++) {
        const dx = dxValues[i];
        if (dx !== null) {
          adxVal = (adxVal * (period - 1) + dx) / period;
          adx[i] = adxVal;
        }
      }
    }
  }

  return { adx, plusDI, minusDI };
}

// ============================================================================
// 9. Volume-Weighted Average Price (VWAP)
// ============================================================================

export function computeVWAP(
  candles: (OHLCV | { high: number; low: number; close: number; volume?: number; h?: number; l?: number; c?: number; v?: number })[]
): (number | null)[] {
  const n = candles.length;
  const result: (number | null)[] = new Array(n).fill(null);

  let cumPV = 0;
  let cumV = 0;

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;
  const getC = (c: any) => c.close ?? c.c;
  const getV = (c: any) => c.volume ?? c.v ?? 0;

  for (let i = 0; i < n; i++) {
    const h = getH(candles[i]);
    const l = getL(candles[i]);
    const c = getC(candles[i]);
    const v = getV(candles[i]);

    const typical = (h + l + c) / 3;
    cumPV += typical * v;
    cumV += v;

    result[i] = cumV > 0 ? cumPV / cumV : null;
  }

  return result;
}

// ============================================================================
// 10. Rate of Change (ROC)
// ============================================================================

export function computeROC(
  series: (number | { close?: number; c?: number })[],
  period: number = 10
): (number | null)[] {
  const closes = extractCloses(series);
  const n = closes.length;
  const result: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n <= period) return result;

  for (let i = period; i < n; i++) {
    const prev = closes[i - period];
    result[i] = prev !== 0 ? ((closes[i] - prev) / prev) * 100 : null;
  }

  return result;
}

// ============================================================================
// 11. Stochastic Oscillator
// ============================================================================

export function computeStochastic(
  candles: (OHLCV | { high: number; low: number; close: number; h?: number; l?: number; c?: number })[],
  kPeriod: number = 14,
  dPeriod: number = 3
): StochasticResult {
  const n = candles.length;
  const k: (number | null)[] = new Array(n).fill(null);
  const d: (number | null)[] = new Array(n).fill(null);

  if (kPeriod <= 0 || n < kPeriod) return { k, d };

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;
  const getC = (c: any) => c.close ?? c.c;

  for (let i = kPeriod - 1; i < n; i++) {
    let highest = -Infinity;
    let lowest = Infinity;
    for (let j = i - kPeriod + 1; j <= i; j++) {
      const h = getH(candles[j]);
      const l = getL(candles[j]);
      if (h > highest) highest = h;
      if (l < lowest) lowest = l;
    }
    const range = highest - lowest;
    const c = getC(candles[i]);
    k[i] = range > 0 ? ((c - lowest) / range) * 100 : 50;
  }

  // %D is SMA of %K
  const validKIdx = k.findIndex((v) => v !== null);
  if (validKIdx !== -1) {
    const validKVals = k.slice(validKIdx).map((v) => v ?? NaN);
    const dSma = computeSMA(validKVals, dPeriod);
    for (let i = 0; i < dSma.length; i++) {
      d[validKIdx + i] = dSma[i];
    }
  }

  return { k, d };
}

// ============================================================================
// 12. Volume Profile & Average Volume
// ============================================================================

export function computeAverageVolume(
  volumes: number[],
  period: number = 20
): (number | null)[] {
  return computeSMA(volumes, period);
}

// ============================================================================
// 13. High / Low Extremes & Distance Helpers
// ============================================================================

export function computeRollingExtremes(
  candles: (OHLCV | { high: number; low: number; h?: number; l?: number })[],
  period: number
): { high: (number | null)[]; low: (number | null)[] } {
  const n = candles.length;
  const high: (number | null)[] = new Array(n).fill(null);
  const low: (number | null)[] = new Array(n).fill(null);

  if (period <= 0 || n < period) return { high, low };

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;

  for (let i = period - 1; i < n; i++) {
    let maxH = -Infinity;
    let minL = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      const h = getH(candles[j]);
      const l = getL(candles[j]);
      if (h > maxH) maxH = h;
      if (l < minL) minL = l;
    }
    high[i] = maxH;
    low[i] = minL;
  }

  return { high, low };
}

export function computePercentDistance(
  price: number | null | undefined,
  baseline: number | null | undefined
): number | null {
  if (price == null || baseline == null || baseline === 0 || !Number.isFinite(price) || !Number.isFinite(baseline)) {
    return null;
  }
  return ((price - baseline) / baseline) * 100;
}

// ============================================================================
// 14. SuperTrend
// ============================================================================

export function computeSuperTrend(
  candles: (OHLCV | { high: number; low: number; close: number; h?: number; l?: number; c?: number })[],
  period: number = 10,
  multiplier: number = 3
): SuperTrendResult {
  const n = candles.length;
  const values: (number | null)[] = new Array(n).fill(null);
  const direction: (1 | -1 | null)[] = new Array(n).fill(null);

  if (period <= 0 || n < period || multiplier <= 0) {
    return { values, direction };
  }

  const getH = (c: any) => c.high ?? c.h;
  const getL = (c: any) => c.low ?? c.l;
  const getC = (c: any) => c.close ?? c.c;

  const atrSeries = computeATR(candles, period);

  let prevUpper = 0;
  let prevLower = 0;
  let prevSupertrend = 0;
  let prevDir: 1 | -1 = 1;

  for (let i = period - 1; i < n; i++) {
    const h = getH(candles[i]);
    const l = getL(candles[i]);
    const c = getC(candles[i]);
    const atr = atrSeries[i];

    if (atr === null || !Number.isFinite(h) || !Number.isFinite(l) || !Number.isFinite(c)) {
      continue;
    }

    const hl2 = (h + l) / 2;
    const basicUpper = hl2 + multiplier * atr;
    const basicLower = hl2 - multiplier * atr;

    if (i === period - 1) {
      prevUpper = basicUpper;
      prevLower = basicLower;
      prevDir = c >= hl2 ? 1 : -1;
      prevSupertrend = prevDir === 1 ? prevLower : prevUpper;
      values[i] = prevSupertrend;
      direction[i] = prevDir;
      continue;
    }

    const prevClose = getC(candles[i - 1]);

    // Ratchet upper band down (cannot move up while downtrend persists)
    const finalUpper = basicUpper < prevUpper || prevClose > prevUpper ? basicUpper : prevUpper;
    // Ratchet lower band up (cannot move down while uptrend persists)
    const finalLower = basicLower > prevLower || prevClose < prevLower ? basicLower : prevLower;

    let currentDir: 1 | -1 = prevDir;
    let currentSupertrend: number;

    if (prevSupertrend === prevUpper) {
      // Was in downtrend
      if (c > finalUpper) {
        currentDir = 1;
        currentSupertrend = finalLower;
      } else {
        currentDir = -1;
        currentSupertrend = finalUpper;
      }
    } else {
      // Was in uptrend
      if (c < finalLower) {
        currentDir = -1;
        currentSupertrend = finalUpper;
      } else {
        currentDir = 1;
        currentSupertrend = finalLower;
      }
    }

    values[i] = currentSupertrend;
    direction[i] = currentDir;

    prevUpper = finalUpper;
    prevLower = finalLower;
    prevSupertrend = currentSupertrend;
    prevDir = currentDir;
  }

  return { values, direction };
}

// ============================================================================
// 15. Full Canonical Technical Snapshot for a Single Series
// ============================================================================

export function buildCanonicalSnapshot(
  candles: (OHLCV | { open: number; high: number; low: number; close: number; volume?: number; h?: number; l?: number; c?: number; v?: number })[]
): CanonicalIndicatorsSnapshot | null {
  const n = candles.length;
  if (n === 0) return null;

  const lastCandle = candles[n - 1] as any;
  const close = lastCandle.close ?? lastCandle.c;
  const volume = lastCandle.volume ?? lastCandle.v ?? 0;

  const closes = extractCloses(candles);
  const volumes = candles.map((c: any) => c.volume ?? c.v ?? 0);

  // MAs
  const sma20Series = computeSMA(closes, 20);
  const sma50Series = computeSMA(closes, 50);
  const sma200Series = computeSMA(closes, 200);

  const ema20Series = computeEMA(closes, 20);
  const ema50Series = computeEMA(closes, 50);
  const ema200Series = computeEMA(closes, 200);

  // RSI
  const rsiSeries = computeRSI(closes, 14);

  // MACD
  const macdSeries = computeMACD(closes, 12, 26, 9);

  // ATR
  const atrSeries = computeATR(candles as any, 14);

  // ADX
  const adxSeries = computeADX(candles as any, 14);

  // Bollinger
  const bbSeries = computeBollingerBands(closes, 20, 2);

  // Volume averages
  const avgVolSeries = computeAverageVolume(volumes, 20);

  // Extremes (20-day and 52-week ~ 252 bars)
  const extremes20 = computeRollingExtremes(candles as any, Math.min(20, n));
  const extremes52w = computeRollingExtremes(candles as any, Math.min(252, n));

  const sma20 = sma20Series[n - 1];
  const sma50 = sma50Series[n - 1];
  const sma200 = sma200Series[n - 1];

  const ema20 = ema20Series[n - 1];
  const ema50 = ema50Series[n - 1];
  const ema200 = ema200Series[n - 1];

  const rsi14 = rsiSeries[n - 1];
  const macd = macdSeries.macd[n - 1];
  const macdSignal = macdSeries.signal[n - 1];
  const macdHistogram = macdSeries.histogram[n - 1];

  const atr14 = atrSeries[n - 1];
  const adx14 = adxSeries.adx[n - 1];

  const bbUpper = bbSeries.upper[n - 1];
  const bbMiddle = bbSeries.middle[n - 1];
  const bbLower = bbSeries.lower[n - 1];
  const bbWidth = bbSeries.width[n - 1];

  const averageVolume20 = avgVolSeries[n - 1];
  const relativeVolume20 =
    averageVolume20 && averageVolume20 > 0 ? volume / averageVolume20 : null;

  const high20 = extremes20.high[n - 1];
  const low20 = extremes20.low[n - 1];
  const high52w = extremes52w.high[n - 1];
  const low52w = extremes52w.low[n - 1];

  const distanceFromSma20Pct = computePercentDistance(close, sma20);
  const distanceFromSma50Pct = computePercentDistance(close, sma50);
  const distanceFromSma200Pct = computePercentDistance(close, sma200);

  const distanceFrom52WeekHighPct = computePercentDistance(close, high52w);
  const distanceFrom52WeekLowPct = computePercentDistance(close, low52w);

  const priceAboveSma20 = sma20 !== null ? close > sma20 : null;
  const priceAboveSma50 = sma50 !== null ? close > sma50 : null;
  const priceAboveSma200 = sma200 !== null ? close > sma200 : null;

  return {
    close,
    sma20,
    sma50,
    sma200,
    ema20,
    ema50,
    ema200,
    rsi14,
    macd,
    macdSignal,
    macdHistogram,
    atr14,
    adx14,
    bbUpper,
    bbMiddle,
    bbLower,
    bbWidth,
    volume,
    averageVolume20: averageVolume20 !== null ? Math.round(averageVolume20) : null,
    relativeVolume20,
    high20,
    low20,
    high52w,
    low52w,
    distanceFromSma20Pct,
    distanceFromSma50Pct,
    distanceFromSma200Pct,
    distanceFrom52WeekHighPct,
    distanceFrom52WeekLowPct,
    priceAboveSma20,
    priceAboveSma50,
    priceAboveSma200,
  };
}
