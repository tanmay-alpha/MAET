/**
 * Indicator Calculators Registration
 * Registers all technical indicator calculators into the global registry
 */

import { registerCalculator } from "../../engine/calculator-registry";
import type { CalculatorInput, CalculatorOutput } from "../../engine/calculator-registry";

// Import existing indicator functions from the extended indicators module
import {
  calculateSMA,
  calculateEMA,
  calculateStdDev,
} from "../../../../domain/technical/indicators-extended";

// ============================================================================
// Helper: build output rows from parallel arrays
// ============================================================================
function buildOutputs(
  symbol: string,
  dates: string[],
  values: number[],
  indicatorName: string,
  signals?: number[],
  hists?: number[]
): CalculatorOutput[] {
  const result: CalculatorOutput[] = [];
  // Return only the last value (most recent) for storage efficiency
  // On-demand callers can get the full series via the domain layer
  const lastIdx = values.length - 1;
  if (lastIdx < 0) return result;

  result.push({
    symbol,
    indicatorName,
    date: dates[lastIdx] ?? new Date().toISOString().split("T")[0],
    value: isFinite(values[lastIdx]) ? values[lastIdx] : null,
    signal: signals ? (isFinite(signals[lastIdx]) ? signals[lastIdx] : null) : null,
    hist: hists ? (isFinite(hists[lastIdx]) ? hists[lastIdx] : null) : null,
  });

  return result;
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
    const values = calculateSMA(input.closes, 20);
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
    const values = calculateSMA(input.closes, 50);
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
    const values = calculateSMA(input.closes, 200);
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
    const values = calculateEMA(input.closes, 12);
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
    const values = calculateEMA(input.closes, 20);
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
    const values = calculateEMA(input.closes, 26);
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
    const values = calculateEMA(input.closes, 50);
    return buildOutputs(input.symbol, input.dates ?? [], values, "EMA_50");
  },
});

// ============================================================================
// RSI — Relative Strength Index
// ============================================================================
function calculateRSI(closes: number[], period = 14): number[] {
  if (closes.length < period + 1) return [];
  const result: number[] = new Array(period).fill(NaN);
  let avgGain = 0;
  let avgLoss = 0;

  for (let i = 1; i <= period; i++) {
    const change = closes[i] - closes[i - 1];
    if (change > 0) avgGain += change;
    else avgLoss -= change;
  }
  avgGain /= period;
  avgLoss /= period;

  const firstRSI = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  result.push(firstRSI);

  for (let i = period + 1; i < closes.length; i++) {
    const change = closes[i] - closes[i - 1];
    const gain = Math.max(0, change);
    const loss = Math.max(0, -change);
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    const rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
    result.push(rsi);
  }

  return result;
}

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
    const values = calculateRSI(input.closes, 14);
    return buildOutputs(input.symbol, input.dates ?? [], values, "RSI_14");
  },
});

// ============================================================================
// MACD — Moving Average Convergence Divergence
// ============================================================================
function calculateMACD(closes: number[], fast = 12, slow = 26, signal = 9): {
  macd: number[];
  signal: number[];
  hist: number[];
} {
  const emaFast = calculateEMA(closes, fast);
  const emaSlow = calculateEMA(closes, slow);
  const macdLine = emaFast.map((v, i) => v - emaSlow[i]);
  const signalLine = calculateEMA(macdLine.slice(slow - 1), signal);
  const histogram = signalLine.map((v, i) => macdLine[slow - 1 + i] - v);

  return {
    macd: macdLine.slice(slow - 1),
    signal: signalLine,
    hist: histogram,
  };
}

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
    const { macd, signal, hist } = calculateMACD(input.closes);
    const dates = input.dates?.slice(26 - 1 + 9 - 1) ?? [];
    return buildOutputs(input.symbol, dates, macd, "MACD", signal, hist);
  },
});

// ============================================================================
// Bollinger Bands
// ============================================================================
function calculateBollingerBands(closes: number[], period = 20, stdDevMult = 2): {
  upper: number[];
  middle: number[];
  lower: number[];
} {
  const middle = calculateSMA(closes, period);
  const stdDevs = calculateStdDev(closes, period);
  const upper = middle.map((m, i) => m + stdDevMult * stdDevs[i]);
  const lower = middle.map((m, i) => m - stdDevMult * stdDevs[i]);
  return { upper, middle, lower };
}

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
    const { upper, middle, lower } = calculateBollingerBands(input.closes);
    // value = middle, signal = upper, hist = lower
    return buildOutputs(input.symbol, input.dates ?? [], middle, "BB_20", upper, lower);
  },
});

// ============================================================================
// ATR — Average True Range
// ============================================================================
function calculateATR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  if (highs.length < period + 1) return [];
  const trueRanges: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const hl = highs[i] - lows[i];
    const hc = Math.abs(highs[i] - closes[i - 1]);
    const lc = Math.abs(lows[i] - closes[i - 1]);
    trueRanges.push(Math.max(hl, hc, lc));
  }

  const result: number[] = [];
  let atr = trueRanges.slice(0, period).reduce((a, b) => a + b, 0) / period;
  result.push(atr);

  for (let i = period; i < trueRanges.length; i++) {
    atr = (atr * (period - 1) + trueRanges[i]) / period;
    result.push(atr);
  }

  return result;
}

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
    const values = calculateATR(input.highs, input.lows, input.closes, 14);
    const dates = input.dates?.slice(15) ?? [];
    return buildOutputs(input.symbol, dates, values, "ATR_14");
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
function calculateVWAP(highs: number[], lows: number[], closes: number[], volumes: number[]): number[] {
  const result: number[] = [];
  let cumVol = 0;
  let cumTpVol = 0;

  for (let i = 0; i < closes.length; i++) {
    const typicalPrice = (highs[i] + lows[i] + closes[i]) / 3;
    cumTpVol += typicalPrice * volumes[i];
    cumVol += volumes[i];
    result.push(cumVol > 0 ? cumTpVol / cumVol : typicalPrice);
  }
  return result;
}

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
    const values = calculateVWAP(input.highs, input.lows, input.closes, input.volumes);
    return buildOutputs(input.symbol, input.dates ?? [], values, "VWAP");
  },
});

// ============================================================================
// CCI — Commodity Channel Index
// ============================================================================
function calculateCCI(highs: number[], lows: number[], closes: number[], period = 20): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const slice = { h: highs.slice(i - period + 1, i + 1), l: lows.slice(i - period + 1, i + 1), c: closes.slice(i - period + 1, i + 1) };
    const tps = slice.c.map((c, j) => (slice.h[j] + slice.l[j] + c) / 3);
    const meanTp = tps.reduce((a, b) => a + b, 0) / period;
    const meanDev = tps.reduce((sum, tp) => sum + Math.abs(tp - meanTp), 0) / period;
    result.push(meanDev === 0 ? 0 : (tps[tps.length - 1] - meanTp) / (0.015 * meanDev));
  }
  return result;
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
    const dates = input.dates?.slice(19) ?? [];
    return buildOutputs(input.symbol, dates, values, "CCI_20");
  },
});

// ============================================================================
// Williams %R
// ============================================================================
function calculateWilliamsR(highs: number[], lows: number[], closes: number[], period = 14): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - period + 1, i + 1));
    const ll = Math.min(...lows.slice(i - period + 1, i + 1));
    result.push(hh === ll ? -50 : ((hh - closes[i]) / (hh - ll)) * -100);
  }
  return result;
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
    const dates = input.dates?.slice(13) ?? [];
    return buildOutputs(input.symbol, dates, values, "WILLIAMS_R_14");
  },
});

// ============================================================================
// ROC — Rate of Change
// ============================================================================
function calculateROC(closes: number[], period = 12): number[] {
  const result: number[] = [];
  for (let i = period; i < closes.length; i++) {
    result.push(closes[i - period] !== 0 ? ((closes[i] - closes[i - period]) / closes[i - period]) * 100 : 0);
  }
  return result;
}

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
    const values = calculateROC(input.closes, 12);
    const dates = input.dates?.slice(12) ?? [];
    return buildOutputs(input.symbol, dates, values, "ROC_12");
  },
});

// ============================================================================
// MFI — Money Flow Index
// ============================================================================
function calculateMFI(highs: number[], lows: number[], closes: number[], volumes: number[], period = 14): number[] {
  const result: number[] = [];
  const tps = closes.map((c, i) => (highs[i] + lows[i] + c) / 3);
  const mfPos: number[] = [0];
  const mfNeg: number[] = [0];

  for (let i = 1; i < tps.length; i++) {
    const mf = tps[i] * volumes[i];
    if (tps[i] > tps[i - 1]) { mfPos.push(mf); mfNeg.push(0); }
    else if (tps[i] < tps[i - 1]) { mfPos.push(0); mfNeg.push(mf); }
    else { mfPos.push(0); mfNeg.push(0); }
  }

  for (let i = period; i < tps.length; i++) {
    const posSum = mfPos.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    const negSum = mfNeg.slice(i - period + 1, i + 1).reduce((a, b) => a + b, 0);
    result.push(negSum === 0 ? 100 : 100 - 100 / (1 + posSum / negSum));
  }
  return result;
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
    const dates = input.dates?.slice(14) ?? [];
    return buildOutputs(input.symbol, dates, values, "MFI_14");
  },
});

// ============================================================================
// Stochastic Oscillator
// ============================================================================
function calculateStochastic(highs: number[], lows: number[], closes: number[], kPeriod = 14, dPeriod = 3): {
  k: number[];
  d: number[];
} {
  const kValues: number[] = [];
  for (let i = kPeriod - 1; i < closes.length; i++) {
    const hh = Math.max(...highs.slice(i - kPeriod + 1, i + 1));
    const ll = Math.min(...lows.slice(i - kPeriod + 1, i + 1));
    kValues.push(hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100);
  }
  const dValues = calculateSMA(kValues, dPeriod);
  return { k: kValues, d: dValues };
}

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
    const { k, d } = calculateStochastic(input.highs, input.lows, input.closes, 14, 3);
    const dates = input.dates?.slice(13) ?? [];
    return buildOutputs(input.symbol, dates, k, "STOCH_14_3", d);
  },
});

// ============================================================================
// ADX — Average Directional Index
// ============================================================================
function calculateADX(highs: number[], lows: number[], closes: number[], period = 14): {
  adx: number[];
  plusDI: number[];
  minusDI: number[];
} {
  const atr = calculateATR(highs, lows, closes, period);
  const plusDM: number[] = [];
  const minusDM: number[] = [];

  for (let i = 1; i < highs.length; i++) {
    const upMove = highs[i] - highs[i - 1];
    const downMove = lows[i - 1] - lows[i];
    plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0);
    minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0);
  }

  const smoothedPlusDM = calculateEMA(plusDM, period);
  const smoothedMinusDM = calculateEMA(minusDM, period);
  const plusDI = smoothedPlusDM.map((v, i) => atr[i] > 0 ? (v / atr[i]) * 100 : 0);
  const minusDI = smoothedMinusDM.map((v, i) => atr[i] > 0 ? (v / atr[i]) * 100 : 0);
  const dx = plusDI.map((p, i) => {
    const sum = p + minusDI[i];
    return sum > 0 ? (Math.abs(p - minusDI[i]) / sum) * 100 : 0;
  });
  const adx = calculateEMA(dx, period);

  return { adx, plusDI, minusDI };
}

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
    const { adx, plusDI, minusDI } = calculateADX(input.highs, input.lows, input.closes, 14);
    const dates = input.dates?.slice(input.closes.length - adx.length) ?? [];
    return buildOutputs(input.symbol, dates, adx, "ADX_14", plusDI, minusDI);
  },
});

// ============================================================================
// CMF — Chaikin Money Flow
// ============================================================================
function calculateCMF(highs: number[], lows: number[], closes: number[], volumes: number[], period = 20): number[] {
  const result: number[] = [];
  for (let i = period - 1; i < closes.length; i++) {
    let mfvSum = 0;
    let volSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      const hl = highs[j] - lows[j];
      const clv = hl === 0 ? 0 : ((closes[j] - lows[j]) - (highs[j] - closes[j])) / hl;
      mfvSum += clv * volumes[j];
      volSum += volumes[j];
    }
    result.push(volSum > 0 ? mfvSum / volSum : 0);
  }
  return result;
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
    const dates = input.dates?.slice(19) ?? [];
    return buildOutputs(input.symbol, dates, values, "CMF_20");
  },
});

// ============================================================================
// Historical Volatility (20-day)
// ============================================================================
function calculateHistoricalVolatility(closes: number[], period = 20, annualizationFactor = 252): number[] {
  const returns: number[] = [];
  for (let i = 1; i < closes.length; i++) {
    returns.push(Math.log(closes[i] / closes[i - 1]));
  }
  const result: number[] = [];
  for (let i = period - 1; i < returns.length; i++) {
    const slice = returns.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((sum, r) => sum + Math.pow(r - mean, 2), 0) / (period - 1);
    result.push(Math.sqrt(variance * annualizationFactor) * 100); // as percentage
  }
  return result;
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
    const dates = input.dates?.slice(20) ?? [];
    return buildOutputs(input.symbol, dates, values, "HV_20");
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
    const sma200 = calculateSMA(input.closes, 200);
    const lastSMA = sma200[sma200.length - 1];
    const lastClose = input.closes[input.closes.length - 1];
    const pct = lastSMA > 0 ? ((lastClose - lastSMA) / lastSMA) * 100 : null;
    const lastDate = input.dates?.[input.dates.length - 1] ?? new Date().toISOString().split("T")[0];
    return [{ symbol: input.symbol, indicatorName: "PRICE_VS_SMA200", date: lastDate, value: pct }];
  },
});

// Export a count for validation
export const INDICATOR_CALCULATOR_COUNT = 18; // SMA_20, SMA_50, SMA_200, EMA_12, EMA_20, EMA_26, EMA_50, RSI_14, MACD, BB_20, ATR_14, OBV, VWAP, CCI_20, WILLIAMS_R_14, ROC_12, MFI_14, STOCH_14_3, ADX_14, CMF_20, HV_20, 52W_HIGH, 52W_LOW, PRICE_VS_SMA200 = 24 total
