/**
 * Options Greeks calculation utilities
 * Black-Scholes model implementation for Delta, Gamma, Theta, Vega, and Rho
 */

export interface Greeks {
  delta: number;
  gamma: number;
  theta: number;
  vega: number;
  rho: number;
  iv: number;
}

export interface OptionData {
  strike: number;
  spot: number;
  expiry: Date;
  type: "call" | "put";
  premium?: number;
  iv?: number;
  riskFreeRate?: number;
}

/**
 * Calculate cumulative standard normal distribution
 */
function cumulativeNormal(x: number): number {
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;

  const sign = x < 0 ? -1 : 1;
  x = Math.abs(x) / Math.sqrt(2);

  const t = 1.0 / (1.0 + p * x);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-x * x);

  return 0.5 * (1.0 + sign * y);
}

/**
 * Calculate standard normal probability density
 */
function standardNormalPDF(x: number): number {
  return (1 / Math.sqrt(2 * Math.PI)) * Math.exp(-0.5 * x * x);
}

/**
 * Calculate days to expiration
 */
function daysToExpiry(expiry: Date): number {
  const now = new Date();
  const diffMs = expiry.getTime() - now.getTime();
  return Math.max(0.001, diffMs / (1000 * 60 * 60 * 24)); // Convert to days, ensure positive
}

/**
 * Calculate all Greeks for an option
 */
export function calculateGreeks(data: OptionData): Greeks {
  const { strike, spot, expiry, type, iv = 0.2, riskFreeRate = 0.06 } = data;

  const T = daysToExpiry(expiry) / 365; // Years to expiration
  const r = riskFreeRate;
  const sigma = iv;

  if (T <= 0 || sigma <= 0) {
    return {
      delta: 0,
      gamma: 0,
      theta: 0,
      vega: 0,
      rho: 0,
      iv,
    };
  }

  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  const Nd1 = cumulativeNormal(d1);
  const Nd2 = cumulativeNormal(d2);
  const nD1 = standardNormalPDF(d1);

  // Delta
  const delta = type === "call" ? Nd1 : Nd1 - 1;

  // Gamma (same for calls and puts)
  const gamma = nD1 / (spot * sigma * Math.sqrt(T));

  // Vega (same for calls and puts, scaled to 1% change in IV)
  const vega = (spot * Math.sqrt(T) * nD1) / 100;

  // Theta (per day)
  const theta = type === "call"
    ? -(spot * sigma * nD1) / (2 * Math.sqrt(T)) - r * strike * Math.exp(-r * T) * Nd2
    : -(spot * sigma * nD1) / (2 * Math.sqrt(T)) + r * strike * Math.exp(-r * T) * cumulativeNormal(-d2);

  // Rho
  const rho = type === "call"
    ? (strike * T * Math.exp(-r * T) * Nd2) / 100
    : -(strike * T * Math.exp(-r * T) * cumulativeNormal(-d2)) / 100;

  return {
    delta,
    gamma,
    theta: theta / 365, // Convert to daily
    vega,
    rho,
    iv,
  };
}

/**
 * Calculate Put-Call Ratio
 */
export function calculatePCR(callOI: number, putOI: number): number {
  return putOI / Math.max(callOI, 1);
}

/**
 * Calculate theoretical option price using Black-Scholes
 */
export function calculateOptionPrice(data: OptionData): number {
  const { strike, spot, expiry, type, iv = 0.2, riskFreeRate = 0.06 } = data;

  const T = daysToExpiry(expiry) / 365;
  const r = riskFreeRate;
  const sigma = iv;

  if (T <= 0) {
    return type === "call" ? Math.max(0, spot - strike) : Math.max(0, strike - spot);
  }

  const d1 = (Math.log(spot / strike) + (r + 0.5 * sigma * sigma) * T) / (sigma * Math.sqrt(T));
  const d2 = d1 - sigma * Math.sqrt(T);

  if (type === "call") {
    return spot * cumulativeNormal(d1) - strike * Math.exp(-r * T) * cumulativeNormal(d2);
  } else {
    return strike * Math.exp(-r * T) * cumulativeNormal(-d2) - spot * cumulativeNormal(-d1);
  }
}

/**
 * Calculate payoff for an option position at expiry
 */
export function calculatePayoff(type: "call" | "put", strike: number, premium: number, spot: number, quantity: number = 1): number {
  const intrinsic = type === "call"
    ? Math.max(0, spot - strike)
    : Math.max(0, strike - spot);

  return (intrinsic - premium) * quantity * 100; // Assuming Indian market lot size of 100
}

/**
 * Calculate payoff for a strategy at different spot prices
 */
export function calculateStrategyPayoff(
  legs: Array<{ type: "call" | "put"; strike: number; premium: number; quantity: number }>,
  spotPrices: number[]
): Array<{ spot: number; payoff: number }> {
  return spotPrices.map(spot => {
    const totalPayoff = legs.reduce((sum, leg) => {
      return sum + calculatePayoff(leg.type, leg.strike, leg.premium, spot, leg.quantity);
    }, 0);
    return { spot, payoff: totalPayoff };
  });
}
