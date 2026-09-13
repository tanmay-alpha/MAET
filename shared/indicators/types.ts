/**
 * Standard Indicator Types & Interfaces
 * Canonical definitions for all technical calculations across MAET.
 */

export interface OHLCV {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  ts?: string | number | Date;
}

export interface MACDResult {
  macd: (number | null)[];
  signal: (number | null)[];
  histogram: (number | null)[];
}

export interface BollingerBandsResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
  width: (number | null)[];
}

export interface DonchianResult {
  upper: (number | null)[];
  middle: (number | null)[];
  lower: (number | null)[];
}

export interface ADXResult {
  adx: (number | null)[];
  plusDI: (number | null)[];
  minusDI: (number | null)[];
}

export interface StochasticResult {
  k: (number | null)[];
  d: (number | null)[];
}

export interface SuperTrendResult {
  values: (number | null)[];
  direction: (1 | -1 | null)[]; // 1 = bullish, -1 = bearish
}

export interface CanonicalIndicatorsSnapshot {
  close: number;
  sma20: number | null;
  sma50: number | null;
  sma200: number | null;
  ema20: number | null;
  ema50: number | null;
  ema200: number | null;
  rsi14: number | null;
  macd: number | null;
  macdSignal: number | null;
  macdHistogram: number | null;
  atr14: number | null;
  adx14: number | null;
  bbUpper: number | null;
  bbMiddle: number | null;
  bbLower: number | null;
  bbWidth: number | null;
  volume: number;
  averageVolume20: number | null;
  relativeVolume20: number | null;
  high20: number | null;
  low20: number | null;
  high52w: number | null;
  low52w: number | null;
  distanceFromSma20Pct: number | null;
  distanceFromSma50Pct: number | null;
  distanceFromSma200Pct: number | null;
  distanceFrom52WeekHighPct: number | null;
  distanceFrom52WeekLowPct: number | null;
  priceAboveSma20: boolean | null;
  priceAboveSma50: boolean | null;
  priceAboveSma200: boolean | null;
}
