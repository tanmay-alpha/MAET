/**
 * Indicator Calculators Registration
 * Registers all technical indicator calculators into the global registry
 */

import { registerCalculator } from "../../engine/calculator-registry";
import type { CalculatorInput, CalculatorOutput } from "../../engine/calculator-registry";

import {
  computeADX,
  computeATR,
  computeBollingerBands,
  computeEMA,
  computeMACD,
  computeROC,
  computeRSI,
  computeSMA,
  computeStochastic,
  computeVWAP,
} from "@shared/indicators";

type Series = (number | null)[];

function finiteOrNull(v: number | null | undefined): number | null {
  return v != null && Number.isFinite(v) ? v : null;
}

function candlesOf(highs: number[], lows: number[], closes: number[], volumes: number[] = []) {
  return closes.map((close, i) => ({ high: highs[i], low: lows[i], close, volume: volumes[i] ?? 0 }));
}

// ============================================================================
// Helper: build output rows from series aligned 1:1 with input bars
// ============================================================================
// Every series passed here MUST have one entry per input bar (index i ↔ dates[i]),
// with null during warm-up — never sliced or offset.
function buildOutputs(
  symbol: string,
  dates: string[],
  values: Series,
  indicatorName: string,
  signals?: Series,
  hists?: Series
): CalculatorOutput[] {
  // Return only the last value (most recent) for storage efficiency
  // On-demand callers can get the full series via the domain layer
  const lastIdx = values.length - 1;
  if (lastIdx < 0) return [];

  return [{
    symbol,
    indicatorName,
    date: dates[lastIdx] ?? new Date().toISOString().split("T")[0],
    value: finiteOrNull(values[lastIdx]),
    signal: signals ? finiteOrNull(signals[lastIdx]) : null,
    hist: hists ? finiteOrNull(hists[lastIdx]) : null,
  }];
}

// ============================================================================
// SMA — Simple Moving Average
// ============================================================================
registerCalculator({
  meta: {
    name: "SMA_20",
    displayName: "SMA(20)",
    category: "trend",
    frequency: "daily",
    description: "20-period Simple Moving Average of closing prices",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
    defaultParams: { period: 20 },
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 20) return [];
    const values = computeSMA(input.closes, 20);
    return buildOutputs(input.symbol, input.dates ?? [], values, "SMA_20");
  },
});

registerCalculator({
  meta: {
    name: "SMA_50",
    displayName: "SMA(50)",
    category: "trend",
    frequency: "daily",
    description: "50-period Simple Moving Average",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
    defaultParams: { period: 50 },
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 50) return [];
    const values = computeSMA(input.closes, 50);
    return buildOutputs(input.symbol, input.dates ?? [], values, "SMA_50");
  },
});

registerCalculator({
  meta: {
    name: "SMA_200",
    displayName: "SMA(200)",
    category: "trend",
    frequency: "daily",
    description: "200-period Simple Moving Average",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
    defaultParams: { period: 200 },
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 200) return [];
    const values = computeSMA(input.closes, 200);
    return buildOutputs(input.symbol, input.dates ?? [], values, "SMA_200");
  },
});

// ============================================================================
// EMA — Exponential Moving Average
// ============================================================================
registerCalculator({
  meta: {
    name: "EMA_12",
    displayName: "EMA(12)",
    category: "trend",
    frequency: "daily",
    description: "12-period Exponential Moving Average",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 12) return [];
    const values = computeEMA(input.closes, 12);
    return buildOutputs(input.symbol, input.dates ?? [], values, "EMA_12");
  },
});

registerCalculator({
  meta: {
    name: "EMA_20",
    displayName: "EMA(20)",
    category: "trend",
    frequency: "daily",
    description: "20-period Exponential Moving Average",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 20) return [];
    const values = computeEMA(input.closes, 20);
    return buildOutputs(input.symbol, input.dates ?? [], values, "EMA_20");
  },
});

registerCalculator({
  meta: {
    name: "EMA_26",
    displayName: "EMA(26)",
    category: "trend",
    frequency: "daily",
    description: "26-period Exponential Moving Average",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 26) return [];
    const values = computeEMA(input.closes, 26);
    return buildOutputs(input.symbol, input.dates ?? [], values, "EMA_26");
  },
});

registerCalculator({
  meta: {
    name: "EMA_50",
    displayName: "EMA(50)",
    category: "trend",
    frequency: "daily",
    description: "50-period Exponential Moving Average",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 50) return [];
    const values = computeEMA(input.closes, 50);
    return buildOutputs(input.symbol, input.dates ?? [], values, "EMA_50");
  },
});

// ============================================================================
// RSI — Relative Strength Index
// ============================================================================
registerCalculator({
  meta: {
    name: "RSI_14",
    displayName: "RSI(14)",
    category: "momentum",
    frequency: "daily",
    description: "14-period Relative Strength Index",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
    defaultParams: { period: 14 },
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 15) return [];
    const values = computeRSI(input.closes, 14);
    return buildOutputs(input.symbol, input.dates ?? [], values, "RSI_14");
  },
});

// ============================================================================
// MACD — Moving Average Convergence Divergence
// ============================================================================
registerCalculator({
  meta: {
    name: "MACD",
    displayName: "MACD(12,26,9)",
    category: "momentum",
    frequency: "daily",
    description: "MACD line, signal line, and histogram",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal", "hist"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 35) return [];
    const { macd, signal, histogram } = computeMACD(input.closes, 12, 26, 9);
    return buildOutputs(input.symbol, input.dates ?? [], macd, "MACD", signal, histogram);
  },
});

// ============================================================================
// Bollinger Bands
// ============================================================================
registerCalculator({
  meta: {
    name: "BB_20",
    displayName: "Bollinger Bands(20,2)",
    category: "volatility",
    frequency: "daily",
    description: "Bollinger Bands — upper, middle (SMA20), lower bands",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal", "hist"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 20) return [];
    const { upper, middle, lower } = computeBollingerBands(input.closes, 20, 2);
    // value = middle, signal = upper, hist = lower
    return buildOutputs(input.symbol, input.dates ?? [], middle, "BB_20", upper, lower);
  },
});

// ============================================================================
// ATR — Average True Range
// ============================================================================
registerCalculator({
  meta: {
    name: "ATR_14",
    displayName: "ATR(14)",
    category: "volatility",
    frequency: "daily",
    description: "14-period Average True Range",
    requiredFields: ["highs", "lows", "closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || input.closes.length < 15) return [];
    const values = computeATR(candlesOf(input.highs, input.lows, input.closes), 14);
    return buildOutputs(input.symbol, input.dates ?? [], values, "ATR_14");
  },
});

// ============================================================================
// OBV — On-Balance Volume
// ============================================================================
function calculateOBV(closes: number[], volumes: number[]): number[] {
  const result: number[] = [0];
  for (let i = 1; i < closes.length; i++) {
    if (closes[i] > closes[i - 1]) result.push(result[i - 1] + volumes[i]);
    else if (closes[i] < closes[i - 1]) result.push(result[i - 1] - volumes[i]);
    else result.push(result[i - 1]);
  }
  return result;
}

registerCalculator({
  meta: {
    name: "OBV",
    displayName: "On-Balance Volume",
    category: "volume",
    frequency: "daily",
    description: "Cumulative volume indicator showing buying vs selling pressure",
    requiredFields: ["closes", "volumes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || !input.volumes || input.closes.length < 2) return [];
    const values = calculateOBV(input.closes, input.volumes);
    return buildOutputs(input.symbol, input.dates ?? [], values, "OBV");
  },
});

// ============================================================================
// VWAP — Volume Weighted Average Price
// ============================================================================
registerCalculator({
  meta: {
    name: "VWAP",
    displayName: "VWAP",
    category: "volume",
    frequency: "daily",
    description: "Volume Weighted Average Price",
    requiredFields: ["highs", "lows", "closes", "volumes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || !input.volumes) return [];
    // Same session VWAP as everywhere else: the bar dates anchor each IST trading day.
    const dates = input.dates ?? [];
    const values = computeVWAP(candlesOf(input.highs, input.lows, input.closes, input.volumes).map((c, i) => ({ ...c, ts: dates[i] })));
    return buildOutputs(input.symbol, input.dates ?? [], values, "VWAP");
  },
});

// ============================================================================
// CCI — Commodity Channel Index
// ============================================================================
function calculateCCI(highs: number[], lows: number[], closes: number[], period = 20): Series {
  const tps = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const meanTps = computeSMA(tps, period);
  return tps.map((tp, i) => {
    const meanTp = meanTps[i];
    if (meanTp === null) return null;
    let meanDev = 0;
    for (let j = i - period + 1; j <= i; j++) meanDev += Math.abs(tps[j] - meanTp);
    meanDev /= period;
    return meanDev === 0 ? 0 : (tp - meanTp) / (0.015 * meanDev);
  });
}

registerCalculator({
  meta: {
    name: "CCI_20",
    displayName: "CCI(20)",
    category: "oscillators",
    frequency: "daily",
    description: "20-period Commodity Channel Index",
    requiredFields: ["highs", "lows", "closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || input.closes.length < 20) return [];
    const values = calculateCCI(input.highs, input.lows, input.closes, 20);
    return buildOutputs(input.symbol, input.dates ?? [], values, "CCI_20");
  },
});

// ============================================================================
// Williams %R
// ============================================================================
function calculateWilliamsR(highs: number[], lows: number[], closes: number[], period = 14): Series {
  return closes.map((close, i) => {
    if (i < period - 1) return null;
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    return hh === ll ? -50 : ((hh - close) / (hh - ll)) * -100;
  });
}

registerCalculator({
  meta: {
    name: "WILLIAMS_R_14",
    displayName: "Williams %R(14)",
    category: "momentum",
    frequency: "daily",
    description: "14-period Williams %R momentum indicator",
    requiredFields: ["highs", "lows", "closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || input.closes.length < 14) return [];
    const values = calculateWilliamsR(input.highs, input.lows, input.closes, 14);
    return buildOutputs(input.symbol, input.dates ?? [], values, "WILLIAMS_R_14");
  },
});

// ============================================================================
// ROC — Rate of Change
// ============================================================================
registerCalculator({
  meta: {
    name: "ROC_12",
    displayName: "ROC(12)",
    category: "momentum",
    frequency: "daily",
    description: "12-period Rate of Change",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 13) return [];
    const values = computeROC(input.closes, 12);
    return buildOutputs(input.symbol, input.dates ?? [], values, "ROC_12");
  },
});

// ============================================================================
// MFI — Money Flow Index
// ============================================================================
function calculateMFI(highs: number[], lows: number[], closes: number[], volumes: number[], period = 14): Series {
  const tps = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mfPos: number[] = [0];
  const mfNeg: number[] = [0];

  for (let i = 1; i < tps.length; i++) {
    const mf = tps[i] * volumes[i];
    if (tps[i] > tps[i - 1]) { mfPos.push(mf); mfNeg.push(0); }
    else if (tps[i] < tps[i - 1]) { mfPos.push(0); mfNeg.push(mf); }
    else { mfPos.push(0); mfNeg.push(0); }
  }

  return tps.map((_, i) => {
    if (i < period) return null;
    const posSum = mfPos.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const negSum = mfNeg.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    return negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum);
  });
}

registerCalculator({
  meta: {
    name: "MFI_14",
    displayName: "MFI(14)",
    category: "volume",
    frequency: "daily",
    description: "14-period Money Flow Index",
    requiredFields: ["highs", "lows", "closes", "volumes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || !input.volumes || input.closes.length < 15) return [];
    const values = calculateMFI(input.highs, input.lows, input.closes, input.volumes, 14);
    return buildOutputs(input.symbol, input.dates ?? [], values, "MFI_14");
  },
});

// ============================================================================
// Stochastic Oscillator
// ============================================================================
registerCalculator({
  meta: {
    name: "STOCH_14_3",
    displayName: "Stochastic(14,3)",
    category: "momentum",
    frequency: "daily",
    description: "Stochastic Oscillator — %K and %D lines",
    requiredFields: ["highs", "lows", "closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || input.closes.length < 17) return [];
    const { k, d } = computeStochastic(candlesOf(input.highs, input.lows, input.closes), 14, 3);
    return buildOutputs(input.symbol, input.dates ?? [], k, "STOCH_14_3", d);
  },
});

// ============================================================================
// ADX — Average Directional Index
// ============================================================================
registerCalculator({
  meta: {
    name: "ADX_14",
    displayName: "ADX(14)",
    category: "trend",
    frequency: "daily",
    description: "14-period Average Directional Index with +DI/-DI",
    requiredFields: ["highs", "lows", "closes", "dates"],
    outputFields: ["value", "signal", "hist"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || input.closes.length < 30) return [];
    const { adx, plusDI, minusDI } = computeADX(candlesOf(input.highs, input.lows, input.closes), 14);
    return buildOutputs(input.symbol, input.dates ?? [], adx, "ADX_14", plusDI, minusDI);
  },
});

// ============================================================================
// CMF — Chaikin Money Flow
// ============================================================================
function calculateCMF(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): Series {
  return closes.map((_, i) => {
    if (i < period - 1) return null;
    let mfvSum = 0;
    let volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const hl = highs[j] - lows[j];
      const clv = hl === 0 ? 0 : ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl;
      mfvSum += clv * volumes[j];
      volSum += volumes[j];
    }
    return volSum > 0 ? mfvSum / volSum : 0;
  });
}

registerCalculator({
  meta: {
    name: "CMF_20",
    displayName: "CMF(20)",
    category: "volume",
    frequency: "daily",
    description: "20-period Chaikin Money Flow",
    requiredFields: ["highs", "lows", "closes", "volumes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.highs || !input.lows || !input.closes || !input.volumes || input.closes.length < 20) return [];
    const values = calculateCMF(input.highs, input.lows, input.closes, input.volumes, 20);
    return buildOutputs(input.symbol, input.dates ?? [], values, "CMF_20");
  },
});

// ============================================================================
// Historical Volatility (20-day)
// ============================================================================
function calculateHistoricalVolatility(closes: number[], period = 20, annualizationFactor = 252): Series {
  // Bar i uses the `period` log returns ending at bar i (returns of bars i-period+1..i).
  return closes.map((_, i) => {
    if (i < period) return null;
    const returns: number[] = [];
    for (let j = i - period + 1; j <= i; j++) returns.push(Math.log(closes[j] / closes[j - 1]));
    const mean = returns.reduce((a, b) => a + b, 0) / period;
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (period - 1);
    return Math.sqrt(variance * annualizationFactor) * 100; // as percentage
  });
}

registerCalculator({
  meta: {
    name: "HV_20",
    displayName: "Historical Volatility(20)",
    category: "volatility",
    frequency: "daily",
    description: "20-day Historical Volatility (annualized, in %)",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 22) return [];
    const values = calculateHistoricalVolatility(input.closes, 20);
    return buildOutputs(input.symbol, input.dates ?? [], values, "HV_20");
  },
});

// ============================================================================
// 52-Week High/Low
// ============================================================================
registerCalculator({
  meta: {
    name: "52W_HIGH",
    displayName: "52-Week High",
    category: "custom",
    frequency: "daily",
    description: "Highest closing price over the last 252 trading days",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 1) return [];
    const window = input.closes.slice(-252);
    const high52w = Math.max(...window);
    const lastDate = input.dates?.[input.dates.length - 1] ?? new Date().toISOString().split("T")[0];
    return [{ symbol: input.symbol, indicatorName: "52W_HIGH", date: lastDate, value: high52w }];
  },
});

registerCalculator({
  meta: {
    name: "52W_LOW",
    displayName: "52-Week Low",
    category: "custom",
    frequency: "daily",
    description: "Lowest closing price over the last 252 trading days",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 1) return [];
    const window = input.closes.slice(-252);
    const low52w = Math.min(...window);
    const lastDate = input.dates?.[input.dates.length - 1] ?? new Date().toISOString().split("T")[0];
    return [{ symbol: input.symbol, indicatorName: "52W_LOW", date: lastDate, value: low52w }];
  },
});

// ============================================================================
// Price vs SMA (% above/below)
// ============================================================================
registerCalculator({
  meta: {
    name: "PRICE_VS_SMA200",
    displayName: "Price vs SMA200 (%)",
    category: "trend",
    frequency: "daily",
    description: "Percentage of current price above/below 200-day SMA",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 200) return [];
    const lastSMA = computeSMA(input.closes, 200).at(-1) ?? null;
    const lastClose = input.closes[input.closes.length - 1];
    const pct = lastSMA !== null && lastSMA > 0 ? ((lastClose - lastSMA) / lastSMA) * 100 : null;
    const lastDate = input.dates?.[input.dates.length - 1] ?? new Date().toISOString().split("T")[0];
    return [{ symbol: input.symbol, indicatorName: "PRICE_VS_SMA200", date: lastDate, value: pct }];
  },
});
