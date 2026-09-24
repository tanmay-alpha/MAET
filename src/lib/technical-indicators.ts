/**
 * Technical Analysis Indicators Library
 * Re-exports canonical indicator calculations from @shared/indicators
 * guaranteeing mathematical equality with server-side backtesting and screening.
 */

import {
  computeSMA as canonicalSMA,
  computeEMA as canonicalEMA,
  computeRSI as canonicalRSI,
  computeMACD as canonicalMACD,
  computeBollingerBands as canonicalBollinger,
  computeSuperTrend as canonicalSuperTrend,
} from "@shared/indicators";

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface IndicatorData {
  sma?: number[];
  ema?: number[];
  rsi?: number[];
  macd?: {
    macd: number[];
    signal: number[];
    histogram: number[];
  };
  bollinger?: {
    upper: number[];
    middle: number[];
    lower: number[];
  };
  supertrend?: {
    values: number[];
    direction: (1 | -1 | 0)[];
  };
}

function toNumbers(arr: (number | null)[]): number[] {
  return arr.map((v) => (v === null ? NaN : v));
}

/**
 * Calculate Simple Moving Average (SMA)
 */
export function calculateSMA(data: number[], period: number): number[] {
  return toNumbers(canonicalSMA(data, period));
}

/**
 * Calculate Exponential Moving Average (EMA)
 */
export function calculateEMA(data: number[], period: number): number[] {
  return toNumbers(canonicalEMA(data, period));
}

/**
 * Calculate Relative Strength Index (RSI) - Canonical Wilder's Smoothing
 */
export function calculateRSI(candles: Candle[] | number[], period: number = 14): number[] {
  const closes = Array.isArray(candles) && typeof candles[0] === "number"
    ? (candles as number[])
    : (candles as Candle[]).map((c) => c.c);
  return toNumbers(canonicalRSI(closes, period));
}

/**
 * Calculate MACD (Moving Average Convergence Divergence)
 */
export function calculateMACD(
  candles: Candle[] | number[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const closes = Array.isArray(candles) && typeof candles[0] === "number"
    ? (candles as number[])
    : (candles as Candle[]).map((c) => c.c);
  const res = canonicalMACD(closes, fastPeriod, slowPeriod, signalPeriod);
  return {
    macd: toNumbers(res.macd),
    signal: toNumbers(res.signal),
    histogram: toNumbers(res.histogram),
  };
}

/**
 * Calculate Bollinger Bands
 */
export function calculateBollingerBands(
  candles: Candle[] | number[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = Array.isArray(candles) && typeof candles[0] === "number"
    ? (candles as number[])
    : (candles as Candle[]).map((c) => c.c);
  const res = canonicalBollinger(closes, period, stdDev);
  return {
    upper: toNumbers(res.upper),
    middle: toNumbers(res.middle),
    lower: toNumbers(res.lower),
  };
}

/**
 * Calculate SuperTrend Indicator - Canonical Wilder's ATR ratcheting
 */
export function calculateSuperTrend(
  candles: Candle[] | Array<{ open: number; high: number; low: number; close: number }>,
  period: number = 10,
  multiplier: number = 3
): { values: number[]; direction: (1 | -1 | 0)[] } {
  const normalized = candles.map((c: any) => ({
    open: c.open ?? c.o,
    high: c.high ?? c.h,
    low: c.low ?? c.l,
    close: c.close ?? c.c,
  }));
  const res = canonicalSuperTrend(normalized, period, multiplier);
  return {
    values: toNumbers(res.values),
    direction: res.direction.map((d) => (d === null ? 0 : d)),
  };
}

/**
 * Calculate all technical indicators for a chart
 */
export function calculateAllIndicators(candles: Candle[]): IndicatorData {
  const closes = candles.map((c) => c.c);

  return {
    sma: calculateSMA(closes, 20),
    ema: calculateEMA(closes, 20),
    rsi: calculateRSI(candles, 14),
    macd: calculateMACD(candles),
    bollinger: calculateBollingerBands(candles),
    supertrend: calculateSuperTrend(candles, 10, 3),
  };
}
