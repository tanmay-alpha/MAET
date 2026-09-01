import { describe, expect, it } from "bun:test";
import { calculateGreeks } from "./greeks";

const valuationInput = {
  spot: 100,
  strike: 100,
  riskFreeRate: 0.05,
  iv: 0.20,
  asOf: new Date("2026-01-01T00:00:00.000Z"),
  expiry: new Date("2027-01-01T00:00:00.000Z"),
};

describe("Black-Scholes Greeks", () => {
  it("matches the fixed one-year call fixture", () => {
    const greeks = calculateGreeks({ ...valuationInput, type: "call" });

    expect(greeks.delta).toBeCloseTo(0.636831, 5);
    expect(greeks.gamma).toBeCloseTo(0.018762, 5);
    expect(greeks.theta).toBeCloseTo(-0.017573, 5);
    expect(greeks.vega).toBeCloseTo(0.375240, 5);
    expect(greeks.rho).toBeCloseTo(0.532325, 5);
  });

  it("matches the fixed one-year put fixture", () => {
    const greeks = calculateGreeks({ ...valuationInput, type: "put" });

    expect(greeks.delta).toBeCloseTo(-0.363169, 5);
    expect(greeks.gamma).toBeCloseTo(0.018762, 5);
    expect(greeks.theta).toBeCloseTo(-0.004542, 5);
    expect(greeks.vega).toBeCloseTo(0.375240, 5);
    expect(greeks.rho).toBeCloseTo(-0.418905, 5);
  });
});
