import { describe, expect, it } from "bun:test";
import { INDEX_CONTRACT_DEFAULTS, indexContractDefaults } from "./index-contracts";
import {
  expiryProfile,
  netPremium,
  payoffAtExpiry,
  pnlAfterDays,
  positionGreeks,
  templateLegs,
  type Leg,
} from "./payoff";
import { blackScholes } from "./black-scholes";

const NIFTY_LOT = 65;

const ironCondor: Leg[] = [
  { side: "buy", instrument: "PE", strike: 23_800, lots: 2, premium: 10 },
  { side: "sell", instrument: "PE", strike: 23_900, lots: 2, premium: 30 },
  { side: "sell", instrument: "CE", strike: 24_100, lots: 2, premium: 32 },
  { side: "buy", instrument: "CE", strike: 24_200, lots: 2, premium: 12 },
];

describe("expiry profile", () => {
  it("finds a long straddle's breakevens at strike ± total premium, with unlimited upside", () => {
    const straddle: Leg[] = [
      { side: "buy", instrument: "CE", strike: 24_000, lots: 1, premium: 120 },
      { side: "buy", instrument: "PE", strike: 24_000, lots: 1, premium: 110 },
    ];
    const profile = expiryProfile(straddle, NIFTY_LOT);

    expect(profile.breakevens).toEqual([23_770, 24_230]);
    expect(profile.maxProfit).toBe(Infinity);
    expect(profile.maxLoss).toBe(-230 * NIFTY_LOT);
    for (const breakeven of profile.breakevens) {
      expect(payoffAtExpiry(straddle, breakeven, NIFTY_LOT)).toBeCloseTo(0, 9);
    }
  });

  it("finds an iron condor's breakevens at the short strikes ∓ net credit", () => {
    const profile = expiryProfile(ironCondor, NIFTY_LOT);

    expect(profile.breakevens).toEqual([23_860, 24_140]);
  });

  it("makes an iron condor's max profit the net credit × lots × lot size and its max loss the wing width less the credit", () => {
    const creditPerUnit = 30 + 32 - 10 - 12;
    const profile = expiryProfile(ironCondor, NIFTY_LOT);

    expect(netPremium(ironCondor, NIFTY_LOT)).toBe(creditPerUnit * 2 * NIFTY_LOT);
    expect(profile.maxProfit).toBe(creditPerUnit * 2 * NIFTY_LOT);
    expect(profile.maxLoss).toBe(-(100 - creditPerUnit) * 2 * NIFTY_LOT);
  });

  it("detects the unlimited loss of a naked short call analytically", () => {
    const shortCall: Leg[] = [{ side: "sell", instrument: "CE", strike: 24_000, lots: 1, premium: 100 }];
    const profile = expiryProfile(shortCall, NIFTY_LOT);

    expect(profile.maxLoss).toBe(-Infinity);
    expect(profile.maxProfit).toBe(100 * NIFTY_LOT);
    expect(profile.breakevens).toEqual([24_100]);
  });

  it("bounds a long put's profit by the underlying's floor at zero", () => {
    const longPut: Leg[] = [{ side: "buy", instrument: "PE", strike: 1_000, lots: 1, premium: 40 }];
    const profile = expiryProfile(longPut, 500);

    expect(profile.maxProfit).toBe((1_000 - 40) * 500);
    expect(profile.maxLoss).toBe(-40 * 500);
    expect(profile.breakevens).toEqual([960]);
  });

  it("treats a future as delta one: a covered call has capped upside and a downside floor at zero", () => {
    const coveredCall: Leg[] = [
      { side: "buy", instrument: "FUT", strike: 24_000, lots: 1, premium: 0 },
      { side: "sell", instrument: "CE", strike: 24_100, lots: 1, premium: 80 },
    ];
    const profile = expiryProfile(coveredCall, NIFTY_LOT);

    expect(profile.maxProfit).toBe((100 + 80) * NIFTY_LOT);
    expect(profile.maxLoss).toBe(-(24_000 - 80) * NIFTY_LOT);
    expect(profile.breakevens).toEqual([23_920]);
  });
});

describe("mark-to-model P&L", () => {
  const market = { underlying: 24_010, daysToExpiry: 9, rate: 0.065, volatility: 0.14 };

  it("values each leg with Black-Scholes before expiry and at intrinsic on expiry day", () => {
    const legs: Leg[] = [{ side: "sell", instrument: "CE", strike: 24_100, lots: 1, premium: 80 }];
    const model = blackScholes({
      right: "CE",
      spot: 24_010,
      strike: 24_100,
      years: 9 / 365,
      rate: 0.065,
      volatility: 0.14,
    });

    expect(pnlAfterDays(legs, { ...market, daysForward: 0 }, NIFTY_LOT)).toBeCloseTo(
      -(model.price - 80) * NIFTY_LOT,
      9,
    );
    expect(pnlAfterDays(legs, { ...market, daysForward: 9 }, NIFTY_LOT)).toBe(
      payoffAtExpiry(legs, 24_010, NIFTY_LOT),
    );
  });

  it("aggregates position Greeks as signed leg Greeks × lots × lot size", () => {
    const greeks = positionGreeks(ironCondor, { ...market, daysForward: 0 }, NIFTY_LOT);
    const legGreeks = ironCondor.map((leg) =>
      blackScholes({
        right: leg.instrument as "CE" | "PE",
        spot: 24_010,
        strike: leg.strike,
        years: 9 / 365,
        rate: 0.065,
        volatility: 0.14,
      }),
    );
    const signs = [1, -1, -1, 1];
    const units = 2 * NIFTY_LOT;
    const sum = (key: "delta" | "gamma" | "theta" | "vega") =>
      legGreeks.reduce((total, leg, index) => total + signs[index]! * units * leg[key], 0);

    expect(greeks.delta).toBeCloseTo(sum("delta"), 9);
    expect(greeks.gamma).toBeCloseTo(sum("gamma"), 9);
    expect(greeks.theta).toBeCloseTo(sum("theta"), 9);
    expect(greeks.vega).toBeCloseTo(sum("vega"), 9);
    // A short iron condor earns time decay and loses when volatility rises.
    expect(greeks.theta).toBeGreaterThan(0);
    expect(greeks.vega).toBeLessThan(0);
  });
});

describe("strategy templates", () => {
  it("places an iron condor's strikes around the ATM strike and leaves premiums to the user", () => {
    expect(templateLegs("Iron condor", 24_010, 50)).toEqual([
      { side: "buy", instrument: "PE", strike: 23_800 },
      { side: "sell", instrument: "PE", strike: 23_900 },
      { side: "sell", instrument: "CE", strike: 24_100 },
      { side: "buy", instrument: "CE", strike: 24_200 },
    ]);
  });

  it("builds a long straddle at the strike nearest to spot", () => {
    expect(templateLegs("Long straddle", 51_960, 100)).toEqual([
      { side: "buy", instrument: "CE", strike: 52_000 },
      { side: "buy", instrument: "PE", strike: 52_000 },
    ]);
  });
});

describe("index contract defaults", () => {
  it("uses the NSE lot sizes and near-the-money strike steps", () => {
    expect(INDEX_CONTRACT_DEFAULTS).toEqual({
      NIFTY: { lotSize: 65, strikeStep: 50 },
      BANKNIFTY: { lotSize: 30, strikeStep: 100 },
      FINNIFTY: { lotSize: 60, strikeStep: 50 },
    });
    expect(indexContractDefaults(" banknifty ")).toEqual({ lotSize: 30, strikeStep: 100 });
    expect(indexContractDefaults("RELIANCE")).toBeUndefined();
  });
});
