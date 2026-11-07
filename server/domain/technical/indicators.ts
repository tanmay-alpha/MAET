/**
 * Technical Analysis Indicators Engine
 * Server-side computation of 20+ technical indicators for trading and screening
 */

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

export interface StochasticResult { k: number[]; d: number[] }
export interface ADXResult { adx: number[]; plusDI: number[]; minusDI: number[] }
export interface SuperTrendResult {
  values: number[];
  direction: number[]; // 1 = bullish, -1 = bearish
}

// ============================================================================
import {
  computeSMA as canonicalSMA,
  computeRSI as canonicalRSI,
  computeADX as canonicalADX,
  computeStochastic as canonicalStochastic,
  computeROC as canonicalROC,
  computeDonchian as canonicalDonchian,
  computeVWAP as canonicalVWAP,
  computeSuperTrend as canonicalSuperTrend,
} from "@shared/indicators";

// ============================================================
// Moving Averages (delegated to canonical indicator engine)
// ============================================================

/**
 * Simple Moving Average (SMA)
 * @param data - Array of price values
 * @param period - Number of periods (typically 20, 50, 200)
 */
export function calculateSMA(data: number[], period: number): number[] {
  return canonicalSMA(data, period).map((v) => (v === null ? NaN : v));
}

// ============================================================================
// Trend Indicators (delegated to canonical indicator engine)
// ============================================================================

/**
 * RSI (Relative Strength Index) - Canonical Wilder's Smoothing
 */
export function calculateRSI(candles: OHLCV[] | number[], period: number = 14): number[] {
  const closes = Array.isArray(candles) && typeof candles[0] === "number"
    ? (candles as number[])
    : (candles as OHLCV[]).map((c) => c.close);
  return canonicalRSI(closes, period).map((v) => (v === null ? NaN : v));
}

/**
 * ADX (Average Directional Index) + DI (delegated to canonical engine)
 */
export function calculateADX(candles: OHLCV[], period: number = 14): ADXResult {
  const res = canonicalADX(candles, period);
  return {
    adx: res.adx.map((v) => (v === null ? NaN : v)),
    plusDI: res.plusDI.map((v) => (v === null ? NaN : v)),
    minusDI: res.minusDI.map((v) => (v === null ? NaN : v)),
  };
}

// ============================================================================
// Momentum Indicators
// ============================================================================

/**
 * Stochastic Oscillator (delegated to canonical engine)
 */
export function calculateStochastic(
  candles: OHLCV[],
  kPeriod: number = 14,
  dPeriod: number = 3
): StochasticResult {
  const res = canonicalStochastic(candles, kPeriod, dPeriod);
  return {
    k: res.k.map((v) => (v === null ? NaN : v)),
    d: res.d.map((v) => (v === null ? NaN : v)),
  };
}

/**
 * Rate of Change (ROC) (delegated to canonical engine)
 */
export function calculateROC(candles: OHLCV[], period: number = 10): number[] {
  return canonicalROC(candles, period).map((v) => (v === null ? NaN : v));
}

// ============================================================================
// Volatility Indicators
// ============================================================================

/**
 * Donchian Channels (delegated to canonical engine)
 */
export function calculateDonchianChannels(
  candles: OHLCV[],
  period: number = 20
): { upper: number[]; middle: number[]; lower: number[] } {
  const res = canonicalDonchian(candles, period);
  return {
    upper: res.upper.map((v) => (v === null ? NaN : v)),
    middle: res.middle.map((v) => (v === null ? NaN : v)),
    lower: res.lower.map((v) => (v === null ? NaN : v)),
  };
}

// ============================================================================
// Volume Indicators
// ============================================================================

/**
 * VWAP (Volume Weighted Average Price) (delegated to canonical engine)
 */
export function calculateVWAP(candles: OHLCV[]): number[] {
  return canonicalVWAP(candles).map((v) => (v === null ? NaN : v));
}

// ============================================================================
// Trend & Pattern Indicators
// ============================================================================

/**
 * SuperTrend Indicator (delegated to canonical engine)
 */
export function calculateSuperTrend(
  candles: OHLCV[],
  period: number = 10,
  multiplier: number = 3
): SuperTrendResult {
  const result = canonicalSuperTrend(candles as any, period, multiplier);
  return {
    values: result.values.map((v) => (v === null ? NaN : v)),
    direction: result.direction.map((d) => (d === null ? 0 : d)),
  };
}
