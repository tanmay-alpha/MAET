/**
 * Black-Scholes against references that share no code with the implementation:
 * - Hull, "Options, Futures, and Other Derivatives": the BSM example S0 = 42, K = 40, r = 10%,
 *   σ = 20%, T = 0.5 gives c = 4.76 and p = 0.81; the Greek-letters chapter's running example
 *   S0 = 49, K = 50, r = 5%, σ = 20%, T = 20 weeks gives c = 2.40, Δ = 0.522, Γ = 0.066,
 *   Θ = −4.31 per year (−0.0118 per calendar day), vega 12.1 per unit σ, ρ = 8.91 per unit r.
 * - A normal CDF integrated here with Simpson's rule, instead of the implementation's rational
 *   approximation; the NIFTY prices below were also computed with scipy.stats.norm.
 */
import { describe, expect, it } from "bun:test";
import { blackScholes, normCdf, type OptionPricingInput } from "./black-scholes";

/** N(x) = 1/2 ± ∫₀^|x| φ(t) dt, composite Simpson with 4,000 panels. */
function simpsonNormCdf(x: number): number {
  const panels = 4000;
  const width = Math.abs(x) / panels;
  const density = (t: number) => Math.exp(-0.5 * t * t) / Math.sqrt(2 * Math.PI);
  let sum = density(0) + density(Math.abs(x));
  for (let index = 1; index < panels; index++) sum += (index % 2 === 1 ? 4 : 2) * density(index * width);
  const area = (sum * width) / 3;
  return x >= 0 ? 0.5 + area : 0.5 - area;
}

function referencePrice({ right, spot, strike, years, rate, volatility }: OptionPricingInput): number {
  const d1 = (Math.log(spot / strike) + (rate + volatility ** 2 / 2) * years) / (volatility * Math.sqrt(years));
  const d2 = d1 - volatility * Math.sqrt(years);
  const discounted = strike * Math.exp(-rate * years);
  return right === "CE"
    ? spot * simpsonNormCdf(d1) - discounted * simpsonNormCdf(d2)
    : discounted * simpsonNormCdf(-d2) - spot * simpsonNormCdf(-d1);
}

const HULL_PRICING = { spot: 42, strike: 40, years: 0.5, rate: 0.1, volatility: 0.2 };
const HULL_GREEKS: OptionPricingInput = { right: "CE", spot: 49, strike: 50, years: 20 / 52, rate: 0.05, volatility: 0.2 };
const NIFTY = { spot: 24000, years: 7 / 365, rate: 0.065, volatility: 0.14 };

describe("Black-Scholes against independent references", () => {
  it("agrees with a separately integrated normal CDF", () => {
    for (const x of [-6, -3, -1.5, -0.25, 0, 0.4, 1, 2.5, 5]) {
      expect(Math.abs(normCdf(x) - simpsonNormCdf(x))).toBeLessThan(1e-13);
    }
    expect(normCdf(-1)).toBeCloseTo(0.15865525393145707, 14); // scipy.stats.norm.cdf(-1)
  });

  it("reproduces Hull's call and put prices", () => {
    const call = blackScholes({ right: "CE", ...HULL_PRICING });
    const put = blackScholes({ right: "PE", ...HULL_PRICING });
    expect(call.price).toBeCloseTo(4.76, 2);
    expect(put.price).toBeCloseTo(0.81, 2);
    expect(call.price).toBeCloseTo(referencePrice({ right: "CE", ...HULL_PRICING }), 10);
    expect(put.price).toBeCloseTo(referencePrice({ right: "PE", ...HULL_PRICING }), 10);
    // Put-call parity: c − p = S − K e^(−rT).
    expect(call.price - put.price).toBeCloseTo(42 - 40 * Math.exp(-0.05), 10);
  });

  it("reproduces Hull's Greeks in the stated units", () => {
    const greeks = blackScholes(HULL_GREEKS);
    expect(greeks.price).toBeCloseTo(2.4, 2);
    expect(greeks.delta).toBeCloseTo(0.522, 3);
    expect(greeks.gamma).toBeCloseTo(0.066, 3);
    expect(greeks.theta).toBeCloseTo(-4.31 / 365, 4); // per calendar day
    expect(greeks.vega).toBeCloseTo(12.1 / 100, 3); // per volatility point
    expect(greeks.rho).toBeCloseTo(8.91 / 100, 4); // per rate point
  });

  it("matches scipy for a one-week NIFTY call and put", () => {
    const call = blackScholes({ right: "CE", strike: 24200, ...NIFTY });
    const put = blackScholes({ right: "PE", strike: 23800, ...NIFTY });
    expect(call.price).toBeCloseTo(113.54886623247694, 8);
    expect(call.theta).toBeCloseTo(-13.979330484976163, 8);
    expect(call.vega).toBeCloseTo(12.453866190743248, 8);
    expect(put.price).toBeCloseTo(92.17744308296551, 8);
    expect(put.delta).toBeCloseTo(-0.30656419011017766, 12);
  });

  it("has theta equal to the one-day price change and vega to the one-point change", () => {
    const base = { right: "CE" as const, strike: 24200, ...NIFTY };
    const today = blackScholes(base);
    const tomorrow = blackScholes({ ...base, years: base.years - 1 / 365 });
    const higherVol = blackScholes({ ...base, volatility: base.volatility + 0.01 });
    // A one-day step on a 7-day option is not infinitesimal: within 3% of the derivative.
    expect(Math.abs(tomorrow.price - today.price - today.theta) / Math.abs(today.theta)).toBeLessThan(0.03);
    expect(Math.abs(higherVol.price - today.price - today.vega) / today.vega).toBeLessThan(0.01);
  });

  it("returns intrinsic value with zero time value at or past expiry", () => {
    for (const years of [0, -1 / 365]) {
      expect(blackScholes({ right: "CE", spot: 24100, strike: 24000, years, rate: 0.065, volatility: 0.14 })).toEqual({ price: 100, delta: 1, gamma: 0, theta: 0, vega: 0, rho: 0 });
      expect(blackScholes({ right: "PE", spot: 24100, strike: 24000, years, rate: 0.065, volatility: 0 }).price).toBe(0);
    }
  });
});
