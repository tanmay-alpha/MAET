/**
 * Incremental indicator state machine for Backtest Engine V3.
 *
 * Key invariants:
 * - At bar index i, only data from bars 0..i is available.
 * - No future bar access. Negative lags rejected at construction time.
 * - All indicators are computed using only data seen so far.
 */

import type { Candle } from "@shared/types";
import type { IndicatorType } from "../../../shared/strategy/ast";

// ============================================================
// Indicator cache (per bar, for each unique indicator config)
// ============================================================

export interface IndicatorCacheKey {
  indicator: IndicatorType;
  params: Record<string, number>;
}

export interface IndicatorState {
  /** Get the value of this indicator at bar index i, where i <= currentBarIndex */
  getValue(barIndex: number, lag?: number): number | null;
}

// ============================================================
// Internal math helpers (incremental where possible)
// ============================================================

function computeSma(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (period <= 0 || period > closes.length) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  result[period - 1] = sum / period;
  for (let i = period; i < closes.length; i++) {
    sum += closes[i] - closes[i - period];
    result[i] = sum / period;
  }
  return result;
}

function computeEma(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (period <= 0 || closes.length === 0) return result;
  const k = 2 / (period + 1);
  // Seed with SMA of first `period` bars
  if (closes.length < period) return result;
  let sum = 0;
  for (let i = 0; i < period; i++) sum += closes[i];
  let prev = sum / period;
  result[period - 1] = prev;
  for (let i = period; i < closes.length; i++) {
    prev = closes[i] * k + prev * (1 - k);
    result[i] = prev;
  }
  return result;
}

function computeRsi(closes: number[], period: number): number[] {
  const result = new Array<number>(closes.length).fill(NaN);
  if (closes.length < period + 1) return result;
  let avgGain = 0;
  let avgLoss = 0;
  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss += Math.abs(change);
  }
  avgGain /= period;
  avgLoss /= period;
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return result;
}

function computeMacd(
  closes: number[],
  fast: number,
  slow: number,
  signal: number,
): { macdLine: number[]; signalLine: number[]; histogram: number[] } {
  const emaFast = computeEma(closes, fast);
  const emaSlow = computeEma(closes, slow);
  const macdLine = closes.map((_, i) =>
    isNaN(emaFast[i]) || isNaN(emaSlow[i]) ? NaN : emaFast[i] - emaSlow[i],
  );
  // Only seed signal EMA from valid MACD values
  const macdValues = [...macdLine];
  const signalLine = computeEma(macdValues, signal);
  const histogram = macdLine.map((m, i) =>
    isNaN(m) || isNaN(signalLine[i]) ? NaN : m - signalLine[i],
  );
  return { macdLine, signalLine, histogram };
}

function computeBollinger(
  closes: number[],
  period: number,
  stdDev: number,
): { upper: number[]; middle: number[]; lower: number[] } {
  const middle = computeSma(closes, period);
  const upper = new Array<number>(closes.length).fill(NaN);
  const lower = new Array<number>(closes.length).fill(NaN);
  for (let i = period - 1; i < closes.length; i++) {
    let sumSq = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sumSq += (closes[j] - middle[i]) ** 2;
    }
    const sd = Math.sqrt(sumSq / period);
    upper[i] = middle[i] + sd * stdDev;
    lower[i] = middle[i] - sd * stdDev;
  }
  return { upper, middle, lower };
}

function computeAtr(candles: Candle[], period: number): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  if (candles.length < 2) return result;
  const trValues: number[] = [candles[0].high - candles[0].low];
  for (let i = 1; i < candles.length; i++) {
    const prevClose = candles[i - 1].close;
    const tr = Math.max(
      candles[i].high - candles[i].low,
      Math.abs(candles[i].high - prevClose),
      Math.abs(candles[i].low - prevClose),
    );
    trValues.push(tr);
  }
  // Wilder smoothing
  let atr = trValues.slice(0, period).reduce((s, v) => s + v, 0) / period;
  result[period - 1] = atr;
  for (let i = period; i < candles.length; i++) {
    atr = (atr * (period - 1) + trValues[i]) / period;
    result[i] = atr;
  }
  return result;
}

function computeVwap(candles: Candle[]): number[] {
  const result = new Array<number>(candles.length).fill(NaN);
  let cumPV = 0;
  let cumVol = 0;
  for (let i = 0; i < candles.length; i++) {
    const typicalPrice = (candles[i].high + candles[i].low + candles[i].close) / 3;
    cumPV += typicalPrice * (candles[i].volume ?? 0);
    cumVol += candles[i].volume ?? 0;
    result[i] = cumVol > 0 ? cumPV / cumVol : candles[i].close;
  }
  return result;
}

function computeObv(candles: Candle[]): number[] {
  const result = new Array<number>(candles.length).fill(0);
  let obv = 0;
  result[0] = obv;
  for (let i = 1; i < candles.length; i++) {
    const vol = candles[i].volume ?? 0;
    if (candles[i].close > candles[i - 1].close) obv += vol;
    else if (candles[i].close < candles[i - 1].close) obv -= vol;
    result[i] = obv;
  }
  return result;
}

function computeDonchian(
  candles: Candle[],
  period: number,
): { high: number[]; low: number[] } {
  const high = new Array<number>(candles.length).fill(NaN);
  const low = new Array<number>(candles.length).fill(NaN);
  for (let i = period - 1; i < candles.length; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = i - period + 1; j <= i; j++) {
      hi = Math.max(hi, candles[j].high);
      lo = Math.min(lo, candles[j].low);
    }
    high[i] = hi;
    low[i] = lo;
  }
  return { high, low };
}

function computeSupertrend(
  candles: Candle[],
  period: number,
  multiplier: number,
): number[] {
  const atr = computeAtr(candles, period);
  const result = new Array<number>(candles.length).fill(NaN);
  let upTrend = true;
  let upperBand = NaN;
  let lowerBand = NaN;
  for (let i = period - 1; i < candles.length; i++) {
    const hl2 = (candles[i].high + candles[i].low) / 2;
    const newUpper = hl2 + multiplier * atr[i];
    const newLower = hl2 - multiplier * atr[i];
    upperBand = isNaN(upperBand) ? newUpper : Math.min(newUpper, upperBand);
    lowerBand = isNaN(lowerBand) ? newLower : Math.max(newLower, lowerBand);
    if (candles[i].close > upperBand) upTrend = true;
    else if (candles[i].close < lowerBand) upTrend = false;
    result[i] = upTrend ? lowerBand : upperBand;
  }
  return result;
}

// ============================================================
// IndicatorStateCache
// ============================================================

/**
 * Computes all indicator series upfront for the full candle array.
 * Values for bar i are only accessed at bar i or later (enforced by evaluator).
 */
export class IndicatorStateCache {
  private cache = new Map<string, number[]>();
  private candles: Candle[];

  constructor(candles: Candle[]) {
    this.candles = candles;
  }

  private key(indicator: IndicatorType, params: Record<string, number>): string {
    const sortedParams = Object.keys(params).sort().map((k) => `${k}=${params[k]}`).join(",");
    return `${indicator}::${sortedParams}`;
  }

  /** Resolve value for indicator at barIndex, with optional lag (barIndex - lag). Never accesses future bars. */
  resolve(indicator: IndicatorType, params: Record<string, number>, barIndex: number, lag = 0): number | null {
    if (lag < 0) return null; // Reject negative lag (look-ahead)
    const targetBar = barIndex - lag;
    if (targetBar < 0 || targetBar > barIndex) return null;

    const k = this.key(indicator, params);
    if (!this.cache.has(k)) {
      this.cache.set(k, this.computeIndicator(indicator, params));
    }
    const series = this.cache.get(k)!;
    const val = series[targetBar];
    return val === undefined || isNaN(val) ? null : val;
  }

  private computeIndicator(indicator: IndicatorType, params: Record<string, number>): number[] {
    const closes = this.candles.map((c) => c.close);
    const period = params.period ?? 14;
    const fastPeriod = params.fastPeriod ?? 12;
    const slowPeriod = params.slowPeriod ?? 26;
    const signalPeriod = params.signalPeriod ?? 9;

    switch (indicator) {
      case "SMA": return computeSma(closes, period);
      case "EMA": return computeEma(closes, period);
      case "RSI": return computeRsi(closes, period);
      case "MACD_LINE": return computeMacd(closes, fastPeriod, slowPeriod, signalPeriod).macdLine;
      case "MACD_SIGNAL": return computeMacd(closes, fastPeriod, slowPeriod, signalPeriod).signalLine;
      case "MACD_HISTOGRAM": return computeMacd(closes, fastPeriod, slowPeriod, signalPeriod).histogram;
      case "BOLLINGER_UPPER": return computeBollinger(closes, period, params.stdDev ?? 2).upper;
      case "BOLLINGER_MIDDLE": return computeBollinger(closes, period, params.stdDev ?? 2).middle;
      case "BOLLINGER_LOWER": return computeBollinger(closes, period, params.stdDev ?? 2).lower;
      case "ATR": return computeAtr(this.candles, period);
      case "VWAP": return computeVwap(this.candles);
      case "OBV": return computeObv(this.candles);
      case "SUPERTREND": return computeSupertrend(this.candles, period, params.multiplier ?? 3);
      case "DONCHIAN_HIGH": return computeDonchian(this.candles, period).high;
      case "DONCHIAN_LOW": return computeDonchian(this.candles, period).low;
      default: return new Array(this.candles.length).fill(NaN);
    }
  }

  /** Resolve price field at barIndex with optional lag. Never accesses future bars. */
  resolvePrice(field: string, barIndex: number, lag = 0): number | null {
    if (lag < 0) return null; // Reject negative lag (look-ahead)
    const targetBar = barIndex - lag;
    if (targetBar < 0 || targetBar > barIndex || targetBar >= this.candles.length) return null;
    const c = this.candles[targetBar];
    switch (field) {
      case "OPEN": return c.open;
      case "HIGH": return c.high;
      case "LOW": return c.low;
      case "CLOSE": return c.close;
      case "HL2": return (c.high + c.low) / 2;
      case "HLC3": return (c.high + c.low + c.close) / 3;
      case "OHLC4": return (c.open + c.high + c.low + c.close) / 4;
      default: return c.close;
    }
  }

  /** Resolve market/volume field. Never accesses future bars. */
  resolveMarket(field: string, barIndex: number, lag = 0): number | null {
    if (lag < 0) return null; // Reject negative lag (look-ahead)
    const targetBar = barIndex - lag;
    if (targetBar < 0 || targetBar > barIndex || targetBar >= this.candles.length) return null;
    const c = this.candles[targetBar];
    switch (field) {
      case "VOLUME": return c.volume ?? 0;
      case "RELATIVE_VOLUME": {
        if (targetBar < 20) return null;
        let avg = 0;
        for (let j = targetBar - 20; j < targetBar; j++) avg += this.candles[j].volume ?? 0;
        avg /= 20;
        return avg > 0 ? (c.volume ?? 0) / avg : 0;
      }
      case "GAP_PERCENT": {
        if (targetBar === 0) return 0;
        const prevClose = this.candles[targetBar - 1].close;
        return prevClose > 0 ? ((c.open - prevClose) / prevClose) * 100 : 0;
      }
      case "DAY_CHANGE_PERCENT": {
        if (targetBar === 0) return 0;
        const prevClose = this.candles[targetBar - 1].close;
        return prevClose > 0 ? ((c.close - prevClose) / prevClose) * 100 : 0;
      }
      default: return null;
    }
  }
}
