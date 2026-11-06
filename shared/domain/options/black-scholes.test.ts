import { describe, expect, it } from "bun:test";
import { blackScholes, normCdf, type OptionPricingInput } from "./black-scholes";

const textbook = { spot: 100, strike: 100, years: 1, rate: 0.05, volatility: 0.2 } as const;

function price(input: OptionPricingInput): number {
  return blackScholes(input).price;
}

describe("normCdf", () => {
  it("matches the standard normal distribution to double precision", () => {
    expect(normCdf(0)).toBe(0.5);
    expect(Math.abs(normCdf(1) - 0.8413447460685429)).toBeLessThan(1e-13);
    expect(Math.abs(normCdf(-1.96) - 0.024997895148220435)).toBeLessThan(1e-13);
    expect(Math.abs(normCdf(3) - 0.9986501019683699)).toBeLessThan(1e-13);
    expect(Math.abs(normCdf(-8) - 6.22096057427178e-16)).toBeLessThan(1e-20);
  });
});

describe("Black-Scholes price", () => {
  it("prices the textbook at-the-money option (S=100, K=100, T=1, r=5%, σ=20%)", () => {
    expect(price({ ...textbook, right: "CE" })).toBeCloseTo(10.4506, 4);
    expect(price({ ...textbook, right: "PE" })).toBeCloseTo(5.5735, 4);
  });

  it("satisfies put-call parity C − P = S − K·e^(−rT)", () => {
    const cases = [
      { spot: 100, strike: 100, years: 1, rate: 0.05, volatility: 0.2 },
      { spot: 24_010, strike: 24_500, years: 7 / 365, rate: 0.065, volatility: 0.14 },
      { spot: 52_000, strike: 50_000, years: 30 / 365, rate: 0.065, volatility: 0.18 },
      { spot: 1_320, strike: 1_500, years: 90 / 365, rate: 0.07, volatility: 0.35 },
    ];
    for (const input of cases) {
      const call = price({ ...input, right: "CE" });
      const put = price({ ...input, right: "PE" });
      const forwardGap = input.spot - input.strike * Math.exp(-input.rate * input.years);
      expect(call - put).toBeCloseTo(forwardGap, 8);
    }
  });

  it("is worth intrinsic value at expiry", () => {
    expect(price({ ...textbook, years: 0, spot: 112, right: "CE" })).toBe(12);
    expect(price({ ...textbook, years: 0, spot: 112, right: "PE" })).toBe(0);
    expect(price({ ...textbook, years: 0, spot: 93, right: "PE" })).toBe(7);
  });
});

describe("Black-Scholes Greeks", () => {
  it("keeps the one-year fixtures: theta per calendar day, vega and rho per percentage point", () => {
    const call = blackScholes({ ...textbook, right: "CE" });
    expect(call.delta).toBeCloseTo(0.636831, 5);
    expect(call.gamma).toBeCloseTo(0.018762, 5);
    expect(call.theta).toBeCloseTo(-0.017573, 5);
    expect(call.vega).toBeCloseTo(0.37524, 5);
    expect(call.rho).toBeCloseTo(0.532325, 5);

    const put = blackScholes({ ...textbook, right: "PE" });
    expect(put.delta).toBeCloseTo(-0.363169, 5);
    expect(put.gamma).toBeCloseTo(0.018762, 5);
    expect(put.theta).toBeCloseTo(-0.004542, 5);
    expect(put.vega).toBeCloseTo(0.37524, 5);
    expect(put.rho).toBeCloseTo(-0.418905, 5);
  });

  it("agrees with central finite differences of the price", () => {
    const cases: OptionPricingInput[] = [
      { ...textbook, right: "CE" },
      { ...textbook, right: "PE" },
      { spot: 24_010, strike: 24_200, years: 9 / 365, rate: 0.065, volatility: 0.14, right: "CE" },
      { spot: 24_010, strike: 23_800, years: 9 / 365, rate: 0.065, volatility: 0.14, right: "PE" },
      { spot: 1_320, strike: 1_200, years: 45 / 365, rate: 0.07, volatility: 0.32, right: "CE" },
    ];
    for (const input of cases) {
      const greeks = blackScholes(input);
      const mid = price(input);
      // A tiny bump keeps the central difference's truncation error out of delta;
      // the second difference needs a wider one so rounding does not swamp gamma.
      const deltaBump = input.spot * 1e-6;
      const gammaBump = input.spot * 1e-4;
      const dt = 1e-6;
      const dv = 1e-5;
      const dr = 1e-6;

      const delta =
        (price({ ...input, spot: input.spot + deltaBump }) - price({ ...input, spot: input.spot - deltaBump })) /
        (2 * deltaBump);
      const gamma =
        (price({ ...input, spot: input.spot + gammaBump }) - 2 * mid + price({ ...input, spot: input.spot - gammaBump })) /
        (gammaBump * gammaBump);
      // Theta is the value lost per calendar day as time to expiry shrinks.
      const theta = (price({ ...input, years: input.years - dt }) - mid) / dt / 365;
      const vega =
        (price({ ...input, volatility: input.volatility + dv }) -
          price({ ...input, volatility: input.volatility - dv })) /
        (2 * dv) /
        100;
      const rho =
        (price({ ...input, rate: input.rate + dr }) - price({ ...input, rate: input.rate - dr })) /
        (2 * dr) /
        100;

      expect(greeks.delta).toBeCloseTo(delta, 6);
      expect(Math.abs(greeks.gamma - gamma)).toBeLessThan(Math.max(1e-6, Math.abs(gamma) * 1e-3));
      expect(Math.abs(greeks.theta - theta)).toBeLessThan(Math.max(1e-5, Math.abs(theta) * 1e-3));
      expect(greeks.vega).toBeCloseTo(vega, 5);
      expect(greeks.rho).toBeCloseTo(rho, 5);
    }
  });
});
