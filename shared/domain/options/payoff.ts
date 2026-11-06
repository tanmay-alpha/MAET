/**
 * Multi-leg option position maths for the Payoff Lab: expiry payoff, mark-to-model P&L,
 * position Greeks and the analytic expiry profile (max profit/loss, breakevens).
 *
 * Every money figure is in rupees for the whole position: per-unit value × lots × lot size.
 * Futures are treated as delta-one on the underlying (no cost of carry), which is how a
 * covered call or protective put built from a future behaves at expiry.
 */
import { blackScholes, type OptionRight } from "./black-scholes";

export type Side = "buy" | "sell";
export type Instrument = OptionRight | "FUT";

export interface Leg {
  side: Side;
  instrument: Instrument;
  /** Strike for options; entry price for futures. */
  strike: number;
  lots: number;
  /** Entry premium per unit; ignored for futures. */
  premium: number;
}

export interface PricingScenario {
  /** Underlying price the position is valued at. */
  underlying: number;
  daysToExpiry: number;
  /** Calendar days from today; at or past `daysToExpiry` the legs are worth intrinsic value. */
  daysForward: number;
  /** Risk-free rate as a decimal. */
  rate: number;
  /** Implied volatility as a decimal, applied to every option leg. */
  volatility: number;
}

export interface PositionGreeks {
  /** Underlying-equivalent units: +65 behaves like being long 65 units. */
  delta: number;
  /** Change in delta per 1-point move in the underlying. */
  gamma: number;
  /** Rupees gained (+) or lost (−) per calendar day. */
  theta: number;
  /** Rupees per +1 volatility point. */
  vega: number;
}

export interface ExpiryProfile {
  /** Infinity when the payoff keeps rising as the underlying rallies. */
  maxProfit: number;
  /** Most negative expiry P&L; −Infinity when the loss keeps growing as the underlying rallies. */
  maxLoss: number;
  /** Underlying prices where the expiry P&L crosses zero, ascending. */
  breakevens: number[];
}

const DAYS_PER_YEAR = 365;

function signedUnits(leg: Leg, lotSize: number): number {
  return (leg.side === "buy" ? 1 : -1) * leg.lots * lotSize;
}

function expiryPnlPerUnit(leg: Leg, underlying: number): number {
  switch (leg.instrument) {
    case "FUT":
      return underlying - leg.strike;
    case "CE":
      return Math.max(underlying - leg.strike, 0) - leg.premium;
    case "PE":
      return Math.max(leg.strike - underlying, 0) - leg.premium;
  }
}

export function payoffAtExpiry(legs: readonly Leg[], underlying: number, lotSize: number): number {
  return legs.reduce((total, leg) => total + signedUnits(leg, lotSize) * expiryPnlPerUnit(leg, underlying), 0);
}

/** P&L if the position were valued with Black-Scholes `daysForward` days from today. */
export function pnlAfterDays(legs: readonly Leg[], scenario: PricingScenario, lotSize: number): number {
  const daysLeft = scenario.daysToExpiry - scenario.daysForward;
  if (daysLeft <= 0) return payoffAtExpiry(legs, scenario.underlying, lotSize);

  return legs.reduce((total, leg) => {
    const pnlPerUnit =
      leg.instrument === "FUT"
        ? scenario.underlying - leg.strike
        : blackScholes({
            right: leg.instrument,
            spot: scenario.underlying,
            strike: leg.strike,
            years: daysLeft / DAYS_PER_YEAR,
            rate: scenario.rate,
            volatility: scenario.volatility,
          }).price - leg.premium;
    return total + signedUnits(leg, lotSize) * pnlPerUnit;
  }, 0);
}

export function positionGreeks(legs: readonly Leg[], scenario: PricingScenario, lotSize: number): PositionGreeks {
  const years = Math.max(scenario.daysToExpiry - scenario.daysForward, 0) / DAYS_PER_YEAR;
  const totals: PositionGreeks = { delta: 0, gamma: 0, theta: 0, vega: 0 };
  for (const leg of legs) {
    const units = signedUnits(leg, lotSize);
    if (leg.instrument === "FUT") {
      totals.delta += units;
      continue;
    }
    const greeks = blackScholes({
      right: leg.instrument,
      spot: scenario.underlying,
      strike: leg.strike,
      years,
      rate: scenario.rate,
      volatility: scenario.volatility,
    });
    totals.delta += units * greeks.delta;
    totals.gamma += units * greeks.gamma;
    totals.theta += units * greeks.theta;
    totals.vega += units * greeks.vega;
  }
  return totals;
}

/** Premium received (+, credit) or paid (−, debit) when the position is opened. */
export function netPremium(legs: readonly Leg[], lotSize: number): number {
  return legs.reduce(
    (total, leg) => (leg.instrument === "FUT" ? total : total - signedUnits(leg, lotSize) * leg.premium),
    0,
  );
}

/**
 * The expiry P&L is piecewise linear in the underlying, bending only at option strikes,
 * and the underlying cannot fall below zero. So its extremes sit at zero, at a strike, or
 * out in the right tail, whose slope is the net units of calls and futures. That makes the
 * profile exact: no price grid, no sampling error, and "unlimited" is decided by a sign.
 */
export function expiryProfile(legs: readonly Leg[], lotSize: number): ExpiryProfile {
  const strikes = legs.filter((leg) => leg.instrument !== "FUT").map((leg) => leg.strike);
  const kinks = [0, ...[...new Set(strikes)].sort((a, b) => a - b)];
  const values = kinks.map((price) => payoffAtExpiry(legs, price, lotSize));
  const tailSlope = legs.reduce((slope, leg) => (leg.instrument === "PE" ? slope : slope + signedUnits(leg, lotSize)), 0);

  const breakevens: number[] = [];
  kinks.forEach((price, index) => {
    const value = values[index]!;
    if (value === 0 && price > 0) breakevens.push(price);
    if (index === kinks.length - 1) return;
    const nextPrice = kinks[index + 1]!;
    const nextValue = values[index + 1]!;
    if (value * nextValue < 0) {
      breakevens.push(price + (-value * (nextPrice - price)) / (nextValue - value));
    }
  });
  const lastPrice = kinks.at(-1)!;
  const lastValue = values.at(-1)!;
  if (tailSlope !== 0 && lastValue !== 0 && Math.sign(lastValue) !== Math.sign(tailSlope)) {
    breakevens.push(lastPrice - lastValue / tailSlope);
  }

  return {
    maxProfit: tailSlope > 0 ? Infinity : Math.max(...values),
    maxLoss: tailSlope < 0 ? -Infinity : Math.min(...values),
    breakevens,
  };
}

export const STRATEGY_TEMPLATES = [
  "Long straddle",
  "Short strangle",
  "Bull call spread",
  "Bear put spread",
  "Iron condor",
  "Iron butterfly",
  "Covered call",
  "Protective put",
] as const;

export type StrategyTemplate = (typeof STRATEGY_TEMPLATES)[number];

export type TemplateLeg = Pick<Leg, "side" | "instrument" | "strike">;

/**
 * Legs of a template placed around the strike nearest to spot. Premiums and lots are left
 * to the user: the lab never invents prices.
 */
export function templateLegs(template: StrategyTemplate, spot: number, strikeStep: number): TemplateLeg[] {
  const atm = Math.round(spot / strikeStep) * strikeStep;
  const leg = (side: Side, instrument: Instrument, strike: number): TemplateLeg => ({ side, instrument, strike });
  switch (template) {
    case "Long straddle":
      return [leg("buy", "CE", atm), leg("buy", "PE", atm)];
    case "Short strangle":
      return [leg("sell", "PE", atm - 2 * strikeStep), leg("sell", "CE", atm + 2 * strikeStep)];
    case "Bull call spread":
      return [leg("buy", "CE", atm), leg("sell", "CE", atm + 2 * strikeStep)];
    case "Bear put spread":
      return [leg("sell", "PE", atm - 2 * strikeStep), leg("buy", "PE", atm)];
    case "Iron condor":
      return [
        leg("buy", "PE", atm - 4 * strikeStep),
        leg("sell", "PE", atm - 2 * strikeStep),
        leg("sell", "CE", atm + 2 * strikeStep),
        leg("buy", "CE", atm + 4 * strikeStep),
      ];
    case "Iron butterfly":
      return [
        leg("buy", "PE", atm - 4 * strikeStep),
        leg("sell", "PE", atm),
        leg("sell", "CE", atm),
        leg("buy", "CE", atm + 4 * strikeStep),
      ];
    case "Covered call":
      return [leg("buy", "FUT", spot), leg("sell", "CE", atm + 2 * strikeStep)];
    case "Protective put":
      return [leg("buy", "FUT", spot), leg("buy", "PE", atm - 2 * strikeStep)];
  }
}
