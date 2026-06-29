/**
 * Technical Analysis Indicators Library
 * Calculates common technical indicators for chart analysis
 */

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
}

/**
 * Calculate Simple Moving Average (SMA)
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
 * Calculate Exponential Moving Average (EMA)
 * @param data - Array of price values
 * @param period - Number of periods (typically 12, 26)
 */
export function calculateEMA(data: number[], period: number): number[] {
  const result: number[] = [];
  const multiplier = 2 / (period + 1);

  // Start with SMA for first period
  let ema = NaN;

  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) {
      result.push(NaN);
      continue;
    }

    if (isNaN(ema)) {
      // Calculate initial SMA
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
 * Calculate Relative Strength Index (RSI)
 * @param candles - Array of candle data
 * @param period - Number of periods (typically 14)
 */
export function calculateRSI(candles: Candle[], period: number = 14): number[] {
  const result: number[] = [];
  const closes = candles.map(c => c.c);

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
 * Calculate MACD (Moving Average Convergence Divergence)
 * @param candles - Array of candle data
 * @param fastPeriod - Fast EMA period (typically 12)
 * @param slowPeriod - Slow EMA period (typically 26)
 * @param signalPeriod - Signal line period (typically 9)
 */
export function calculateMACD(
  candles: Candle[],
  fastPeriod: number = 12,
  slowPeriod: number = 26,
  signalPeriod: number = 9
): { macd: number[]; signal: number[]; histogram: number[] } {
  const closes = candles.map(c => c.c);
  const fastEMA = calculateEMA(closes, fastPeriod);
  const slowEMA = calculateEMA(closes, slowPeriod);

  // Calculate MACD line
  const macd = fastEMA.map((fast, i) => {
    if (isNaN(fast) || isNaN(slowEMA[i])) return NaN;
    return fast - slowEMA[i];
  });

  // Calculate Signal line (EMA of MACD)
  const validMACD = macd.filter(v => !isNaN(v));
  const signalEMA = calculateEMA(validMACD, signalPeriod);

  // Align signal with MACD
  let signalIdx = 0;
  const signal = macd.map(v => {
    if (isNaN(v)) return NaN;
    return signalEMA[signalIdx++] ?? NaN;
  });

  // Calculate Histogram
  const histogram = macd.map((m, i) => {
    if (isNaN(m) || isNaN(signal[i])) return NaN;
    return m - signal[i];
  });

  return { macd, signal, histogram };
}

/**
 * Calculate Bollinger Bands
 * @param candles - Array of candle data
 * @param period - Number of periods (typically 20)
 * @param stdDev - Standard deviation multiplier (typically 2)
 */
export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDev: number = 2
): { upper: number[]; middle: number[]; lower: number[] } {
  const closes = candles.map(c => c.c);
  const middle = calculateSMA(closes, period);

  const upper: number[] = [];
  const lower: number[] = [];

  for (let i = 0; i < closes.length; i++) {
    if (i < period - 1) {
      upper.push(NaN);
      lower.push(NaN);
      continue;
    }

    // Calculate standard deviation
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
 * Calculate all technical indicators for a chart
 */
export function calculateAllIndicators(candles: Candle[]): IndicatorData {
  const closes = candles.map(c => c.c);

  return {
    sma: calculateSMA(closes, 20),
    ema: calculateEMA(closes, 20),
    rsi: calculateRSI(candles, 14),
    macd: calculateMACD(candles),
    bollinger: calculateBollingerBands(candles),
  };
}
