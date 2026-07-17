/**
 * Portfolio Calculator Registrations
 * Registers risk metrics, performance, and attribution calculators
 */

import { registerCalculator } from "../../engine/calculator-registry";
import type { CalculatorInput, CalculatorOutput } from "../../engine/calculator-registry";

function portfolioOutput(
  symbol: string,
  metricName: string,
  value: number | null,
  date: string,
  components?: Record<string, number | null>
): CalculatorOutput[] {
  return [{ symbol, indicatorName: metricName, date, value, components }];
}

// ============================================================================
// Sharpe Ratio
// ============================================================================
registerCalculator({
  meta: {
    name: "SHARPE_RATIO",
    displayName: "Sharpe Ratio",
    category: "portfolio-risk",
    frequency: "daily",
    description: "Annualized Sharpe ratio (risk-free rate = 6.5% India benchmark)",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 30) return [];
    const closes = input.closes;
    const riskFreeDaily = 0.065 / 252; // 6.5% annualized

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const excess = returns.map((r) => r - riskFreeDaily);
    const meanExcess = excess.reduce((a, b) => a + b, 0) / excess.length;
    const variance = excess.reduce((s, r) => s + Math.pow(r - meanExcess, 2), 0) / excess.length;
    const stdDev = Math.sqrt(variance);

    const sharpe = stdDev > 0 ? (meanExcess / stdDev) * Math.sqrt(252) : null;
    const lastDate = input.dates?.[input.dates.length - 1] ?? "";
    return portfolioOutput(input.symbol, "SHARPE_RATIO", sharpe, lastDate);
  },
});

// ============================================================================
// Sortino Ratio
// ============================================================================
registerCalculator({
  meta: {
    name: "SORTINO_RATIO",
    displayName: "Sortino Ratio",
    category: "portfolio-risk",
    frequency: "daily",
    description: "Like Sharpe but uses only downside deviation",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 30) return [];
    const closes = input.closes;
    const riskFreeDaily = 0.065 / 252;

    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }

    const excess = returns.map((r) => r - riskFreeDaily);
    const meanExcess = excess.reduce((a, b) => a + b, 0) / excess.length;
    const downside = excess.filter((r) => r < 0);
    const downsideVariance = downside.length > 0
      ? downside.reduce((s, r) => s + r * r, 0) / downside.length
      : 0;
    const downsideStd = Math.sqrt(downsideVariance);

    const sortino = downsideStd > 0 ? (meanExcess / downsideStd) * Math.sqrt(252) : null;
    const lastDate = input.dates?.[input.dates.length - 1] ?? "";
    return portfolioOutput(input.symbol, "SORTINO_RATIO", sortino, lastDate);
  },
});

// ============================================================================
// Max Drawdown
// ============================================================================
registerCalculator({
  meta: {
    name: "MAX_DRAWDOWN",
    displayName: "Maximum Drawdown",
    category: "portfolio-risk",
    frequency: "daily",
    description: "Largest peak-to-trough decline in the price series",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 2) return [];
    const closes = input.closes;
    let peak = closes[0];
    let maxDD = 0;

    for (const price of closes) {
      if (price > peak) peak = price;
      const dd = peak > 0 ? (peak - price) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    const lastDate = input.dates?.[input.dates.length - 1] ?? "";
    return portfolioOutput(input.symbol, "MAX_DRAWDOWN", maxDD, lastDate);
  },
});

// ============================================================================
// Beta (vs Nifty 50)
// ============================================================================
registerCalculator({
  meta: {
    name: "BETA",
    displayName: "Beta (vs Nifty 50)",
    category: "portfolio-risk",
    frequency: "daily",
    description: "Systematic risk relative to Nifty 50",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    // Beta requires benchmark data — if not provided, skip
    const benchmarkCloses = input.params?.benchmarkCloses as number[] | undefined;
    if (!input.closes || !benchmarkCloses || input.closes.length < 30) return [];

    const n = Math.min(input.closes.length, benchmarkCloses.length);
    const stockReturns: number[] = [];
    const mktReturns: number[] = [];

    for (let i = 1; i < n; i++) {
      stockReturns.push((input.closes[i] - input.closes[i - 1]) / input.closes[i - 1]);
      mktReturns.push((benchmarkCloses[i] - benchmarkCloses[i - 1]) / benchmarkCloses[i - 1]);
    }

    const meanStock = stockReturns.reduce((a, b) => a + b, 0) / stockReturns.length;
    const meanMkt = mktReturns.reduce((a, b) => a + b, 0) / mktReturns.length;

    let cov = 0, varMkt = 0;
    for (let i = 0; i < stockReturns.length; i++) {
      cov += (stockReturns[i] - meanStock) * (mktReturns[i] - meanMkt);
      varMkt += Math.pow(mktReturns[i] - meanMkt, 2);
    }
    cov /= stockReturns.length;
    varMkt /= mktReturns.length;

    const beta = varMkt > 0 ? cov / varMkt : null;
    const lastDate = input.dates?.[input.dates.length - 1] ?? "";
    return portfolioOutput(input.symbol, "BETA", beta, lastDate);
  },
});

// ============================================================================
// Historical Volatility (portfolio-grade)
// ============================================================================
registerCalculator({
  meta: {
    name: "VOLATILITY_1Y",
    displayName: "1-Year Volatility",
    category: "portfolio-risk",
    frequency: "daily",
    description: "Annualized 1-year daily return standard deviation",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 30) return [];
    const closes = input.closes.slice(-252); // up to 1 year
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push(Math.log(closes[i] / closes[i - 1]));
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + Math.pow(r - mean, 2), 0) / returns.length;
    const vol = Math.sqrt(variance * 252) * 100;
    const lastDate = input.dates?.[input.dates.length - 1] ?? "";
    return portfolioOutput(input.symbol, "VOLATILITY_1Y", vol, lastDate);
  },
});

// ============================================================================
// CAGR
// ============================================================================
registerCalculator({
  meta: {
    name: "CAGR",
    displayName: "CAGR",
    category: "portfolio-performance",
    frequency: "daily",
    description: "Compound Annual Growth Rate over available price history",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 2) return [];
    const closes = input.closes;
    const n = closes.length;
    const years = n / 252; // trading days
    if (years < 0.5 || closes[0] <= 0) return [];
    const cagr = Math.pow(closes[n - 1] / closes[0], 1 / years) - 1;
    const lastDate = input.dates?.[n - 1] ?? "";
    return portfolioOutput(input.symbol, "CAGR", isFinite(cagr) ? cagr : null, lastDate);
  },
});

// ============================================================================
// Value at Risk (95%, Historical Simulation)
// ============================================================================
registerCalculator({
  meta: {
    name: "VAR_95",
    displayName: "VaR (95%, 1-day)",
    category: "portfolio-risk",
    frequency: "daily",
    description: "1-day Value at Risk at 95% confidence using historical simulation",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 60) return [];
    const closes = input.closes;
    const returns: number[] = [];
    for (let i = 1; i < closes.length; i++) {
      returns.push((closes[i] - closes[i - 1]) / closes[i - 1]);
    }
    returns.sort((a, b) => a - b);
    const idx = Math.floor(returns.length * 0.05);
    const var95 = returns[idx]; // negative number = loss
    const lastDate = input.dates?.[closes.length - 1] ?? "";
    return portfolioOutput(input.symbol, "VAR_95", var95, lastDate);
  },
});

// ============================================================================
// Calmar Ratio
// ============================================================================
registerCalculator({
  meta: {
    name: "CALMAR_RATIO",
    displayName: "Calmar Ratio",
    category: "portfolio-risk",
    frequency: "daily",
    description: "CAGR divided by maximum drawdown",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 60) return [];
    const closes = input.closes;
    const n = closes.length;
    const years = n / 252;
    if (years < 0.5 || closes[0] <= 0) return [];

    const cagr = Math.pow(closes[n - 1] / closes[0], 1 / years) - 1;

    let peak = closes[0];
    let maxDD = 0;
    for (const p of closes) {
      if (p > peak) peak = p;
      const dd = peak > 0 ? (peak - p) / peak : 0;
      if (dd > maxDD) maxDD = dd;
    }

    const calmar = maxDD > 0 ? cagr / maxDD : null;
    const lastDate = input.dates?.[n - 1] ?? "";
    return portfolioOutput(input.symbol, "CALMAR_RATIO", isFinite(calmar ?? NaN) ? calmar : null, lastDate);
  },
});

// ============================================================================
// Win Rate (for backtesting context)
// ============================================================================
registerCalculator({
  meta: {
    name: "WIN_RATE_20D",
    displayName: "Win Rate (20-day)",
    category: "portfolio-performance",
    frequency: "daily",
    description: "Percentage of days with positive returns over last 20 trading days",
    requiredFields: ["closes", "dates"],
    outputFields: ["value"],
  },
  calculate: (input: CalculatorInput): CalculatorOutput[] => {
    if (!input.closes || input.closes.length < 21) return [];
    const closes = input.closes.slice(-21);
    let wins = 0;
    for (let i = 1; i < closes.length; i++) {
      if (closes[i] > closes[i - 1]) wins++;
    }
    const winRate = (wins / 20) * 100;
    const lastDate = input.dates?.[input.dates.length - 1] ?? "";
    return portfolioOutput(input.symbol, "WIN_RATE_20D", winRate, lastDate);
  },
});

export const PORTFOLIO_CALCULATOR_COUNT = 9;
