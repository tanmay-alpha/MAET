/**
 * Scanner Calculator Registrations
 * Registers breakout, value, momentum, quality, and technical scanners
 */

import { registerCalculator } from "../../engine/calculator-registry";
import type { CalculatorInput, CalculatorOutput } from "../../engine/calculator-registry";

function scanOutput(
  symbol: string,
  scanType: string,
  signal: "BUY" | "SELL" | "NEUTRAL",
  strength: number,
  date: string,
  metadata?: Record<string, unknown>
): CalculatorOutput[] {
  return [{
    symbol,
    indicatorName: scanType,
    date,
    value: signal === "BUY" ? 1 : signal === "SELL" ? -1 : 0,
    signal: strength,
    components: metadata as Record<string, number | null> | undefined,
  }];
}

function safeEMA(data: number[], period: number): number[] {
  if (data.length < period) return [];
  const k = 2 / (period + 1);
  const result: number[] = [data[0]];
  for (let i = 1; i < data.length; i++) {
    result.push(data[i] * k + result[i - 1] * (1 - k));
  }
  return result;
}

function safeSMA(data: number[], period: number): number[] {
  const result: number[] = [];
  let sum = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (i >= period) sum -= data[i - period];
    if (i >= period - 1) result.push(sum / period);
    else result.push(NaN);
  }
  return result;
}

// ============================================================================
// Breakout Scanners
// ============================================================================

registerCalculator({
  meta: {
    name: "SCAN_52W_HIGH_BREAKOUT",
    displayName: "52-Week High Breakout",
    category: "scanner-breakout",
    frequency: "daily",
    description: "Stock trading within 2% of 52-week high on above-average volume",
    requiredFields: ["closes", "volumes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 252) return [];
    const lastClose = input.closes[input.closes.length - 1];
    const high52w = Math.max(...input.closes.slice(-252));
    const avgVol = (input.volumes?.slice(-20).reduce((a, b) => a + b, 0) ?? 0) / 20;
    const lastVol = input.volumes?.[input.volumes.length - 1] ?? 0;
    const pctFromHigh = (high52w - lastClose) / high52w;
    const lastDate = input.dates?.[input.dates.length - 1] ?? "";

    if (pctFromHigh <= 0.02 && lastVol > avgVol * 1.5) {
      const strength = Math.round((1 - pctFromHigh) * 100 * (lastVol / avgVol));
      return scanOutput(input.symbol, "SCAN_52W_HIGH_BREAKOUT", "BUY", Math.min(strength, 100), lastDate, { pctFromHigh, volumeRatio: lastVol / avgVol });
    }
    return [];
  },
});

registerCalculator({
  meta: {
    name: "SCAN_PRICE_VOLUME_BREAKOUT",
    displayName: "Price + Volume Breakout",
    category: "scanner-breakout",
    frequency: "daily",
    description: "Price up >3% on volume >200% of 20-day average",
    requiredFields: ["closes", "volumes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 21 || !input.volumes) return [];
    const closes = input.closes;
    const volumes = input.volumes;
    const n = closes.length;
    const priceChgPct = (closes[n - 1] - closes[n - 2]) / closes[n - 2];
    const avgVol20 = volumes.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20;
    const volRatio = volumes[n - 1] / avgVol20;
    const lastDate = input.dates?.[n - 1] ?? "";

    if (priceChgPct > 0.03 && volRatio > 2) {
      return scanOutput(input.symbol, "SCAN_PRICE_VOLUME_BREAKOUT", "BUY",
        Math.min(Math.round(priceChgPct * 1000 * volRatio), 100), lastDate,
        { priceChangePct: priceChgPct, volumeRatio: volRatio });
    }
    return [];
  },
});

registerCalculator({
  meta: {
    name: "SCAN_VOLUME_SURGE",
    displayName: "Volume Surge",
    category: "scanner-breakout",
    frequency: "daily",
    description: "Volume >300% of 20-day average (unusual activity alert)",
    requiredFields: ["closes", "volumes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || !input.volumes || input.volumes.length < 21) return [];
    const n = input.volumes.length;
    const avgVol = input.volumes.slice(n - 21, n - 1).reduce((a, b) => a + b, 0) / 20;
    const ratio = input.volumes[n - 1] / avgVol;
    const lastDate = input.dates?.[n - 1] ?? "";

    if (ratio > 3) {
      return scanOutput(input.symbol, "SCAN_VOLUME_SURGE", "BUY", Math.min(Math.round(ratio * 20), 100), lastDate, { volumeRatio: ratio });
    }
    return [];
  },
});

// ============================================================================
// Momentum Scanners
// ============================================================================

registerCalculator({
  meta: {
    name: "SCAN_RSI_OVERSOLD",
    displayName: "RSI Oversold Reversal",
    category: "scanner-momentum",
    frequency: "daily",
    description: "RSI crossed above 30 from oversold territory",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 30) return [];
    const closes = input.closes;
    const n = closes.length;

    // Calculate RSI for last 2 days
    function rsi(data: number[], period = 14): number {
      if (data.length < period + 1) return 50;
      let avgG = 0, avgL = 0;
      for (let i = 1; i <= period; i++) {
        const ch = data[i] - data[i - 1];
        if (ch > 0) avgG += ch; else avgL -= ch;
      }
      avgG /= period; avgL /= period;
      for (let i = period + 1; i < data.length; i++) {
        const ch = data[i] - data[i - 1];
        avgG = (avgG * (period - 1) + Math.max(0, ch)) / period;
        avgL = (avgL * (period - 1) + Math.max(0, -ch)) / period;
      }
      return avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
    }

    const rsiNow = rsi(closes.slice(n - 16));
    const rsiPrev = rsi(closes.slice(n - 17, n - 1));
    const lastDate = input.dates?.[n - 1] ?? "";

    if (rsiPrev < 30 && rsiNow >= 30) {
      return scanOutput(input.symbol, "SCAN_RSI_OVERSOLD", "BUY", Math.round((30 - rsiPrev) * 3), lastDate, { rsiPrev, rsiNow });
    }
    return [];
  },
});

registerCalculator({
  meta: {
    name: "SCAN_MACD_BULLISH_CROSSOVER",
    displayName: "MACD Bullish Crossover",
    category: "scanner-momentum",
    frequency: "daily",
    description: "MACD line crossed above signal line",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 40) return [];
    const closes = input.closes;
    const n = closes.length;
    const ema12 = safeEMA(closes, 12);
    const ema26 = safeEMA(closes, 26);
    const macdLine = ema12.map((v, i) => v - ema26[i]);
    const signalLine = safeEMA(macdLine.slice(25), 9);

    if (signalLine.length < 2) return [];
    const sl = signalLine.length;
    const macdSlice = macdLine.slice(macdLine.length - sl);
    const lastDate = input.dates?.[n - 1] ?? "";

    const macdNow = macdSlice[sl - 1];
    const macdPrev = macdSlice[sl - 2];
    const sigNow = signalLine[sl - 1];
    const sigPrev = signalLine[sl - 2];

    if (macdPrev < sigPrev && macdNow > sigNow) {
      return scanOutput(input.symbol, "SCAN_MACD_BULLISH_CROSSOVER", "BUY",
        Math.min(Math.round(Math.abs(macdNow - sigNow) * 100), 100), lastDate,
        { macd: macdNow, signal: sigNow });
    }
    return [];
  },
});

registerCalculator({
  meta: {
    name: "SCAN_GOLDEN_CROSS",
    displayName: "Golden Cross (SMA50 > SMA200)",
    category: "scanner-momentum",
    frequency: "daily",
    description: "50-day SMA crossed above 200-day SMA",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 202) return [];
    const closes = input.closes;
    const n = closes.length;
    const sma50now = closes.slice(n - 50).reduce((a, b) => a + b, 0) / 50;
    const sma200now = closes.slice(n - 200).reduce((a, b) => a + b, 0) / 200;
    const sma50prev = closes.slice(n - 51, n - 1).reduce((a, b) => a + b, 0) / 50;
    const sma200prev = closes.slice(n - 201, n - 1).reduce((a, b) => a + b, 0) / 200;
    const lastDate = input.dates?.[n - 1] ?? "";

    if (sma50prev < sma200prev && sma50now > sma200now) {
      return scanOutput(input.symbol, "SCAN_GOLDEN_CROSS", "BUY", 90, lastDate, { sma50: sma50now, sma200: sma200now });
    }
    return [];
  },
});

// ============================================================================
// Value Scanners
// ============================================================================

registerCalculator({
  meta: {
    name: "SCAN_LOW_PE",
    displayName: "Low P/E Screen",
    category: "scanner-value",
    frequency: "daily",
    description: "P/E ratio below 15 with positive earnings",
    requiredFields: ["financials.peRatio"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const pe = input.financials?.peRatio;
    if (!pe || pe <= 0 || pe > 15) return [];
    const lastDate = input.period ?? new Date().toISOString().split("T")[0];
    return scanOutput(input.symbol, "SCAN_LOW_PE", "BUY", Math.round((15 - pe) / 15 * 100), lastDate, { pe });
  },
});

registerCalculator({
  meta: {
    name: "SCAN_HIGH_DIVIDEND_YIELD",
    displayName: "High Dividend Yield",
    category: "scanner-value",
    frequency: "daily",
    description: "Dividend yield above 3%",
    requiredFields: ["financials.dividendYield"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const dy = input.financials?.dividendYield;
    if (!dy || dy < 0.03) return [];
    const lastDate = input.period ?? new Date().toISOString().split("T")[0];
    return scanOutput(input.symbol, "SCAN_HIGH_DIVIDEND_YIELD", "BUY", Math.min(Math.round(dy * 1000), 100), lastDate, { dividendYield: dy });
  },
});

// ============================================================================
// Quality Scanners
// ============================================================================

registerCalculator({
  meta: {
    name: "SCAN_HIGH_ROE",
    displayName: "High ROE Screen",
    category: "scanner-quality",
    frequency: "quarterly",
    description: "ROE above 15% with positive earnings",
    requiredFields: ["financials.roe"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const roe = input.financials?.roe;
    if (!roe || roe < 0.15) return [];
    const lastDate = input.period ?? new Date().toISOString().split("T")[0];
    return scanOutput(input.symbol, "SCAN_HIGH_ROE", "BUY", Math.min(Math.round(roe * 300), 100), lastDate, { roe });
  },
});

registerCalculator({
  meta: {
    name: "SCAN_LOW_DEBT",
    displayName: "Low Debt Screen",
    category: "scanner-quality",
    frequency: "quarterly",
    description: "Debt/Equity below 0.5",
    requiredFields: ["financials.debtToEquity"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const de = input.financials?.debtToEquity;
    if (de === undefined || de === null || de < 0 || de > 0.5) return [];
    const lastDate = input.period ?? new Date().toISOString().split("T")[0];
    return scanOutput(input.symbol, "SCAN_LOW_DEBT", "BUY", Math.round((0.5 - de) / 0.5 * 100), lastDate, { debtEquity: de });
  },
});

registerCalculator({
  meta: {
    name: "SCAN_HIGH_FCF_YIELD",
    displayName: "High FCF Yield",
    category: "scanner-quality",
    frequency: "annual",
    description: "Free cash flow yield above 5%",
    requiredFields: ["financials.freeCashFlowYield"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    const fcfy = input.financials?.freeCashFlowYield;
    if (!fcfy || fcfy < 0.05) return [];
    const lastDate = input.period ?? new Date().toISOString().split("T")[0];
    return scanOutput(input.symbol, "SCAN_HIGH_FCF_YIELD", "BUY", Math.min(Math.round(fcfy * 800), 100), lastDate, { fcfYield: fcfy });
  },
});

// ============================================================================
// Technical Scanners
// ============================================================================

registerCalculator({
  meta: {
    name: "SCAN_BOLLINGER_SQUEEZE",
    displayName: "Bollinger Squeeze",
    category: "scanner-technical",
    frequency: "daily",
    description: "Bollinger Bands width at 52-week low (compression before breakout)",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 252) return [];
    const closes = input.closes;
    const n = closes.length;

    function bandWidth(slice: number[]): number {
      const sma = slice.reduce((a, b) => a + b, 0) / slice.length;
      const stdDev = Math.sqrt(slice.reduce((s, v) => s + Math.pow(v - sma, 2), 0) / slice.length);
      return (4 * stdDev) / sma * 100; // bandwidth %
    }

    const currentBW = bandWidth(closes.slice(n - 20));
    const bwHistory: number[] = [];
    for (let i = 252; i <= n; i++) {
      bwHistory.push(bandWidth(closes.slice(i - 20, i)));
    }
    const minBW = Math.min(...bwHistory);

    if (currentBW <= minBW * 1.1) {
      const lastDate = input.dates?.[n - 1] ?? "";
      return scanOutput(input.symbol, "SCAN_BOLLINGER_SQUEEZE", "BUY", 85, lastDate, { bandwidth: currentBW, minBandwidth: minBW });
    }
    return [];
  },
});

registerCalculator({
  meta: {
    name: "SCAN_ABOVE_ALL_MAS",
    displayName: "Above All Moving Averages",
    category: "scanner-technical",
    frequency: "daily",
    description: "Price above SMA20, SMA50, and SMA200 — strong uptrend",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 200) return [];
    const closes = input.closes;
    const n = closes.length;
    const lastClose = closes[n - 1];
    const sma20 = closes.slice(n - 20).reduce((a, b) => a + b, 0) / 20;
    const sma50 = closes.slice(n - 50).reduce((a, b) => a + b, 0) / 50;
    const sma200 = closes.slice(n - 200).reduce((a, b) => a + b, 0) / 200;
    const lastDate = input.dates?.[n - 1] ?? "";

    if (lastClose > sma20 && lastClose > sma50 && lastClose > sma200) {
      return scanOutput(input.symbol, "SCAN_ABOVE_ALL_MAS", "BUY", 80, lastDate, { price: lastClose, sma20, sma50, sma200 });
    }
    return [];
  },
});

registerCalculator({
  meta: {
    name: "SCAN_DEATH_CROSS",
    displayName: "Death Cross (SMA50 < SMA200)",
    category: "scanner-technical",
    frequency: "daily",
    description: "50-day SMA crossed below 200-day SMA — bearish signal",
    requiredFields: ["closes", "dates"],
    outputFields: ["value", "signal"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 202) return [];
    const closes = input.closes;
    const n = closes.length;
    const sma50now = closes.slice(n - 50).reduce((a, b) => a + b, 0) / 50;
    const sma200now = closes.slice(n - 200).reduce((a, b) => a + b, 0) / 200;
    const sma50prev = closes.slice(n - 51, n - 1).reduce((a, b) => a + b, 0) / 50;
    const sma200prev = closes.slice(n - 201, n - 1).reduce((a, b) => a + b, 0) / 200;
    const lastDate = input.dates?.[n - 1] ?? "";

    if (sma50prev > sma200prev && sma50now < sma200now) {
      return scanOutput(input.symbol, "SCAN_DEATH_CROSS", "SELL", 85, lastDate, { sma50: sma50now, sma200: sma200now });
    }
    return [];
  },
});

export const SCANNER_CALCULATOR_COUNT = 13;
