/**
 * Options Greeks Calculator
 * Implements Black-Scholes model for option pricing and Greeks calculation
 */

import { formatPercent, formatRatio } from "./financial-metrics";

// Standard normal CDF approximation
function normalCDF(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - ((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

// Standard normal PDF
function normalPDF(x: number): number {
  return Math.exp(-0.5 * x * x) / Math.sqrt(2 * Math.PI);
}

// Black-Scholes d1 and d2
function calculateD1D2(
  S: number,  // Spot price
  K: number,  // Strike price
  T: number,  // Time to expiration (years)
  r: number,  // Risk-free rate
  sigma: number  // Volatility
): { d1: number; d2: number } {
  const d1 = (Math.log(S / K) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);
  return { d1, d2 };
}

// Calculate call option price using Black-Scholes
export function blackScholesCall(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  if (T <= 0) return Math.max(0, S - K);
  const { d1, d2 } = calculateD1D2(S, K, T, r, sigma);
  return S * normalCDF(d1) - K * Math.exp(-r * T) * normalCDF(d2);
}

// Calculate put option price using Black-Scholes
export function blackScholesPut(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  if (T <= 0) return Math.max(0, K - S);
  const { d1, d2 } = calculateD1D2(S, K, T, r, sigma);
  return K * Math.exp(-r * T) * normalCDF(-d2) - S * normalCDF(-d1);
}

// Delta - measures sensitivity to underlying price change
export function calculateDelta(
  S: number, K: number, T: number, r: number, sigma: number, isCall: boolean
): number {
  if (T <= 0) return isCall ? (S > K ? 1 : 0) : (S < K ? -1 : 0);
  const { d1 } = calculateD1D2(S, K, T, r, sigma);
  return isCall ? normalCDF(d1) : normalCDF(d1) - 1;
}

// Gamma - measures rate of change of delta
export function calculateGamma(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  if (T <= 0) return 0;
  const { d1 } = calculateD1D2(S, K, T, r, sigma);
  return normalPDF(d1) / (S * sigma * Math.sqrt(T));
}

// Theta - measures sensitivity to time decay (per day)
export function calculateTheta(
  S: number, K: number, T: number, r: number, sigma: number, isCall: boolean
): number {
  if (T <= 0) return 0;
  const { d1, d2 } = calculateD1D2(S, K, T, r, sigma);
  const term1 = -(S * normalPDF(d1) * sigma) / (2 * Math.sqrt(T));
  if (isCall) {
    return (term1 - r * K * Math.exp(-r * T) * normalCDF(d2)) / 365;
  } else {
    return (term1 + r * K * Math.exp(-r * T) * normalCDF(-d2)) / 365;
  }
}

// Vega - measures sensitivity to volatility (per 1% change)
export function calculateVega(
  S: number, K: number, T: number, r: number, sigma: number
): number {
  if (T <= 0) return 0;
  const { d1 } = calculateD1D2(S, K, T, r, sigma);
  return (S * normalPDF(d1) * Math.sqrt(T)) / 100; // Per 1% vol change
}

// Rho - measures sensitivity to interest rate (per 1% change)
export function calculateRho(
  S: number, K: number, T: number, r: number, sigma: number, isCall: boolean
): number {
  if (T <= 0) return 0;
  const { d2 } = calculateD1D2(S, K, T, r, sigma);
  if (isCall) {
    return (K * T * Math.exp(-r * T) * normalCDF(d2)) / 100;
  } else {
    return (-K * T * Math.exp(-r * T) * normalCDF(-d2)) / 100;
  }
}

// Calculate all Greeks
export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  theoreticalPrice: number;
}

export function calculateAllGreeks(
  S: number, K: number, T: number, r: number, sigma: number, isCall: boolean
): Greeks {
  const delta = calculateDelta(S, K, T, r, sigma, isCall);
  const gamma = calculateGamma(S, K, T, r, sigma);
  const theta = calculateTheta(S, K, T, r, sigma, isCall);
  const vega = calculateVega(S, K, T, r, sigma);
  const rho = calculateRho(S, K, T, r, sigma, isCall);
  const theoreticalPrice = isCall
    ? blackScholesCall(S, K, T, r, sigma)
    : blackScholesPut(S, K, T, r, sigma);

  return { delta, gamma, theta, vega, rho, theoreticalPrice };
}

// Options chain data structure
export interface OptionChainRow {
  strike: number;
  cePrice: number;
  ceDelta: number;
  ceGamma: number;
  ceTheta: number;
  ceVega: number;
  ceOI: number;
  ceVolume: number;
  pePrice: number;
  peDelta: number;
  peGamma: number;
  peTheta: number;
  peVega: number;
  peOI: number;
  peVolume: number;
  distanceATM: number; // % distance from spot
}

// Generate option chain
export function generateOptionChain(
  spotPrice: number,
  expiry: Date,
  riskFreeRate: number,
  volatility: number,
  strikes: number[] = []
): OptionChainRow[] {
  const now = new Date();
  const T = Math.max(0, (expiry.getTime() - now.getTime()) / (365 * 24 * 60 * 60 * 1000));

  // Generate strikes around ATM if not provided
  if (strikes.length === 0) {
    const atmStrike = Math.round(spotPrice / 50) * 50;
    for (let i = -10; i <= 10; i++) {
      strikes.push(atmStrike + i * 50);
    }
  }

  return strikes.map((strike) => {
    const ce = calculateAllGreeks(spotPrice, strike, T, riskFreeRate, volatility, true);
    const pe = calculateAllGreeks(spotPrice, strike, T, riskFreeRate, volatility, false);
    const distanceATM = ((strike - spotPrice) / spotPrice) * 100;

    return {
      strike,
      cePrice: ce.theoreticalPrice,
      ceDelta: ce.delta,
      ceGamma: ce.gamma,
      ceTheta: ce.theta,
      ceVega: ce.vega,
      ceOI: Math.floor(Math.random() * 1000000),
      ceVolume: Math.floor(Math.random() * 500000),
      pePrice: pe.theoreticalPrice,
      peDelta: pe.delta,
      peGamma: pe.gamma,
      peTheta: pe.theta,
      peVega: pe.vega,
      peOI: Math.floor(Math.random() * 1000000),
      peVolume: Math.floor(Math.random() * 500000),
      distanceATM,
    };
  });
}

// Calculate PCR (Put-Call Ratio)
export function calculatePCR(totalPutOI: number, totalCallOI: number): number {
  if (totalCallOI === 0) return 0;
  return totalPutOI / totalCallOI;
}

// Calculate Max Pain strike
export function calculateMaxPain(
  spotPrice: number,
  optionChain: OptionChainRow[]
): number {
  let maxPain = spotPrice;
  let minLoss = Infinity;

  for (const row of optionChain) {
    // Calculate total loss for both CE and PE holders at this strike
    let totalLoss = 0;

    for (const r of optionChain) {
      // Call holders lose if spot > strike
      const ceLoss = Math.max(0, spotPrice - r.strike);
      // Put holders lose if spot < strike
      const peLoss = Math.max(0, r.strike - spotPrice);

      totalLoss += ceLoss * r.ceOI + peLoss * r.peOI;
    }

    if (totalLoss < minLoss) {
      minLoss = totalLoss;
      maxPain = row.strike;
    }
  }

  return maxPain;
}

// Format Greeks for display
export function formatGreeks(greeks: Greeks): Record<string, string> {
  return {
    Delta: greeks.delta.toFixed(4),
    Gamma: greeks.gamma.toFixed(6),
    Theta: greeks.theta.toFixed(4),
    Vega: greeks.vega.toFixed(4),
    Rho: greeks.rho.toFixed(4),
    "Theoretical Price": `₹${greeks.theoreticalPrice.toFixed(2)}`,
  };
}