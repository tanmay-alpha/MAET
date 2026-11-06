/**
 * Expiry profiles worked by hand for one NIFTY lot of 65 (NSE/FAOP/70616; NSE fo_mktlots.csv
 * still lists 65 for every expiry through Jun-2031 on 2026-11-07). Premiums are arbitrary inputs.
 */
import { describe, expect, it } from "bun:test";
import { expiryProfile, netPremium, pnlAfterDays, positionGreeks, type Leg } from "./payoff";

const LOT = 65;
const leg = (side: Leg["side"], instrument: Leg["instrument"], strike: number, premium: number, lots = 1): Leg => ({ side, instrument, strike, premium, lots });

const STRATEGIES: Array<{ name: string; legs: Leg[]; maxProfit: number; maxLoss: number; breakevens: number[]; net: number }> = [
  // Debit 120: loses the premium below 24000, breaks even at 24000 + 120.
  { name: "long call", legs: [leg("buy", "CE", 24000, 120)], maxProfit: Infinity, maxLoss: -120 * LOT, breakevens: [24120], net: -120 * LOT },
  // Credit 150; the worst case is the index at zero: −(24000 − 150) × 65.
  { name: "short put", legs: [leg("sell", "PE", 24000, 150)], maxProfit: 150 * LOT, maxLoss: -(24000 - 150) * LOT, breakevens: [23850], net: 150 * LOT },
  // Debit 200 − 110 = 90; width 200, so max profit 110.
  { name: "bull call spread", legs: [leg("buy", "CE", 24000, 200), leg("sell", "CE", 24200, 110)], maxProfit: 110 * LOT, maxLoss: -90 * LOT, breakevens: [24090], net: -90 * LOT },
  // Credit 60 + 70 − 20 − 25 = 85; wings 200 wide, so max loss 115; breakevens 23800 − 85 and 24200 + 85.
  {
    name: "iron condor",
    legs: [leg("buy", "PE", 23600, 20), leg("sell", "PE", 23800, 60), leg("sell", "CE", 24200, 70), leg("buy", "CE", 24400, 25)],
    maxProfit: 85 * LOT,
    maxLoss: -115 * LOT,
    breakevens: [23715, 24285],
    net: 85 * LOT,
  },
  // Credit 350; the rally side is unlimited, the fall is capped by the index at zero.
  { name: "short straddle", legs: [leg("sell", "CE", 24000, 180), leg("sell", "PE", 24000, 170)], maxProfit: 350 * LOT, maxLoss: -Infinity, breakevens: [23650, 24350], net: 350 * LOT },
  // Credit 2 × 110 − 200 = 20: +20 below 24000, peaks at 220 at 24200, then falls one-for-one to zero at 24420.
  { name: "1×2 call ratio spread", legs: [leg("buy", "CE", 24000, 200), leg("sell", "CE", 24200, 110, 2)], maxProfit: 220 * LOT, maxLoss: -Infinity, breakevens: [24420], net: 20 * LOT },
  // Long future at 24000 plus 23800 put at 90: floor (23800 − 24000) − 90 = −290; breakeven 24000 + 90.
  { name: "future plus protective put", legs: [leg("buy", "FUT", 24000, 0), leg("buy", "PE", 23800, 90)], maxProfit: Infinity, maxLoss: -290 * LOT, breakevens: [24090], net: -90 * LOT },
];

describe("expiry profile against hand-worked strategies", () => {
  for (const strategy of STRATEGIES) {
    it(`gives the ${strategy.name} its exact max profit, max loss and breakevens`, () => {
      const profile = expiryProfile(strategy.legs, LOT);
      expect(profile.maxProfit).toBe(strategy.maxProfit);
      expect(profile.maxLoss).toBe(strategy.maxLoss);
      expect(profile.breakevens).toHaveLength(strategy.breakevens.length);
      strategy.breakevens.forEach((price, index) => expect(profile.breakevens[index]!).toBeCloseTo(price, 9));
      expect(netPremium(strategy.legs, LOT)).toBe(strategy.net);
    });
  }

  it("bounds the short straddle's downside at the index reaching zero", () => {
    const straddle = STRATEGIES.find((strategy) => strategy.name === "short straddle")!.legs;
    expect(pnlAfterDays(straddle, { underlying: 0.01, daysToExpiry: 0, daysForward: 0, rate: 0.065, volatility: 0.14 }, LOT)).toBeCloseTo(-(24000 - 0.01 - 350) * LOT, 6);
  });
});

describe("expired contracts", () => {
  const condor = STRATEGIES.find((strategy) => strategy.name === "iron condor")!.legs;
  for (const [daysToExpiry, daysForward] of [[0, 0], [3, 5], [-2, 0]] as const) {
    it(`values every leg at intrinsic without NaN (expiry ${daysToExpiry}d, ${daysForward}d forward)`, () => {
      const scenario = { underlying: 24250, daysToExpiry, daysForward, rate: 0.065, volatility: 0.14 };
      // At 24250 only the 24200 call is in the money: 85 − 50 = 35 per unit.
      expect(pnlAfterDays(condor, scenario, LOT)).toBeCloseTo(35 * LOT, 9);
      expect(positionGreeks(condor, scenario, LOT)).toEqual({ delta: -LOT, gamma: 0, theta: 0, vega: 0 });
    });
  }
});

describe("position Greek units", () => {
  it("reports rupees per calendar day, per volatility point and per index point", () => {
    const condor = STRATEGIES.find((strategy) => strategy.name === "iron condor")!.legs;
    const scenario = { underlying: 24000, daysToExpiry: 30, daysForward: 0, rate: 0.065, volatility: 0.14 };
    const greeks = positionGreeks(condor, scenario, LOT);
    const pnl = (patch: Partial<typeof scenario>) => pnlAfterDays(condor, { ...scenario, ...patch }, LOT);
    // Central differences one unit wide: half a day, half a vol point, half an index point each side.
    const oneDay = pnl({ daysForward: 0.5 }) - pnl({ daysForward: -0.5 });
    const oneVolPoint = pnl({ volatility: 0.145 }) - pnl({ volatility: 0.135 });
    const oneIndexPoint = pnl({ underlying: 24000.5 }) - pnl({ underlying: 23999.5 });
    expect(Math.abs(oneDay - greeks.theta) / Math.abs(greeks.theta)).toBeLessThan(0.01);
    expect(Math.abs(oneVolPoint - greeks.vega) / Math.abs(greeks.vega)).toBeLessThan(0.01);
    expect(Math.abs(oneIndexPoint - greeks.delta) / Math.abs(greeks.delta)).toBeLessThan(0.01);
  });
});
