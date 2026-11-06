/**
 * Black-Scholes pricing and Greeks for European options on a non-dividend-paying
 * underlying. Pure functions: no I/O, no clock, safe to share between server and browser.
 *
 * Units, chosen to match how Indian option chains quote Greeks:
 *   - `years` is calendar time to expiry (days / 365);
 *   - `rate` and `volatility` are decimals (6.5% → 0.065, 14% → 0.14);
 *   - theta is the price change per calendar day; vega and rho are per percentage point.
 */

export type OptionRight = "CE" | "PE";

export interface OptionPricingInput {
  right: OptionRight;
  spot: number;
  strike: number;
  years: number;
  rate: number;
  volatility: number;
}

export interface OptionValuation {
  price: number;
  delta: number;
  gamma: number;
  /** Change in price per calendar day that passes. */
  theta: number;
  /** Change in price per +1 percentage point of volatility. */
  vega: number;
  /** Change in price per +1 percentage point of the risk-free rate. */
  rho: number;
}

const DAYS_PER_YEAR = 365;
const INV_SQRT_2PI = 1 / Math.sqrt(2 * Math.PI);

export function normPdf(x: number): number {
  return INV_SQRT_2PI * Math.exp(-0.5 * x * x);
}

/**
 * Standard normal CDF, Hart's double-precision rational approximation as published by
 * West, "Better approximations to cumulative normal functions" (2005). Accurate to about
 * 1e-14, so finite-difference checks of the Greeks stay meaningful.
 */
export function normCdf(x: number): number {
  const z = Math.abs(x);
  let tail: number;
  if (z > 37) {
    tail = 0;
  } else {
    const density = Math.exp(-0.5 * z * z);
    if (z < 7.07106781186547) {
      let numerator = 3.52624965998911e-2 * z + 0.700383064443688;
      numerator = numerator * z + 6.37396220353165;
      numerator = numerator * z + 33.912866078383;
      numerator = numerator * z + 112.079291497871;
      numerator = numerator * z + 221.213596169931;
      numerator = numerator * z + 220.206867912376;
      let denominator = 8.83883476483184e-2 * z + 1.75566716318264;
      denominator = denominator * z + 16.064177579207;
      denominator = denominator * z + 86.7807322029461;
      denominator = denominator * z + 296.564248779674;
      denominator = denominator * z + 637.333633378831;
      denominator = denominator * z + 793.826512519948;
      denominator = denominator * z + 440.413735824752;
      tail = (density * numerator) / denominator;
    } else {
      // Continued fraction for the far tail.
      let fraction = z + 0.65;
      fraction = z + 4 / fraction;
      fraction = z + 3 / fraction;
      fraction = z + 2 / fraction;
      fraction = z + 1 / fraction;
      tail = density / fraction / 2.506628274631;
    }
  }
  return x > 0 ? 1 - tail : tail;
}

function intrinsicValuation(right: OptionRight, spot: number, strike: number): OptionValuation {
  const isCall = right === "CE";
  const price = isCall ? Math.max(spot - strike, 0) : Math.max(strike - spot, 0);
  const delta = isCall ? (spot > strike ? 1 : 0) : spot < strike ? -1 : 0;
  return { price, delta, gamma: 0, theta: 0, vega: 0, rho: 0 };
}

/** Throws a RangeError for inputs the model is undefined for; returns intrinsic value at or after expiry. */
export function blackScholes({ right, spot, strike, years, rate, volatility }: OptionPricingInput): OptionValuation {
  if (!(spot > 0) || !(strike > 0) || !Number.isFinite(spot) || !Number.isFinite(strike)) {
    throw new RangeError("Spot and strike must be positive, finite prices");
  }
  if (!Number.isFinite(rate) || !Number.isFinite(years)) {
    throw new RangeError("Rate and time to expiry must be finite");
  }
  if (years <= 0) return intrinsicValuation(right, spot, strike);
  if (!(volatility > 0) || !Number.isFinite(volatility)) {
    throw new RangeError("Volatility must be positive before expiry");
  }

  const sqrtT = Math.sqrt(years);
  const d1 = (Math.log(spot / strike) + (rate + 0.5 * volatility * volatility) * years) / (volatility * sqrtT);
  const d2 = d1 - volatility * sqrtT;
  const discountedStrike = strike * Math.exp(-rate * years);
  const density = normPdf(d1);

  const gamma = density / (spot * volatility * sqrtT);
  const vegaPerUnitVol = spot * density * sqrtT;
  const timeDecay = -(spot * density * volatility) / (2 * sqrtT);

  if (right === "CE") {
    const nd2 = normCdf(d2);
    return {
      price: spot * normCdf(d1) - discountedStrike * nd2,
      delta: normCdf(d1),
      gamma,
      theta: (timeDecay - rate * discountedStrike * nd2) / DAYS_PER_YEAR,
      vega: vegaPerUnitVol / 100,
      rho: (years * discountedStrike * nd2) / 100,
    };
  }
  const nMinusD2 = normCdf(-d2);
  return {
    price: discountedStrike * nMinusD2 - spot * normCdf(-d1),
    delta: normCdf(d1) - 1,
    gamma,
    theta: (timeDecay + rate * discountedStrike * nMinusD2) / DAYS_PER_YEAR,
    vega: vegaPerUnitVol / 100,
    rho: (-years * discountedStrike * nMinusD2) / 100,
  };
}
