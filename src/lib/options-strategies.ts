/**
 * Options Strategy Builder
 * Pre-built strategies with payoff calculation
 */

import { blackScholesCall, blackScholesPut } from "./options-greeks";

// Strategy Types
export type StrategyType =
  | "long-call"
  | "short-call"
  | "long-put"
  | "short-put"
  | "bull-call-spread"
  | "bear-put-spread"
  | "long-straddle"
  | "long-strangle"
  | "iron-condor"
  | "iron-butterfly"
  | "covered-call"
  | "protective-put";

export interface StrategyLeg {
  type: "call" | "put";
  position: "long" | "short";
  strike: number;
  premium: number;
  quantity: number;
}

export interface Strategy {
  name: string;
  type: StrategyType;
  legs: StrategyLeg[];
  maxProfit: number;
  maxLoss: number;
  breakeven: number[];
  probability: number;
}

// Calculate payoff for a single leg
function calculateLegPayoff(
  leg: StrategyLeg,
  spotPrice: number,
  expiry: Date,
  riskFreeRate: number,
  volatility: number
): number {
  const T = Math.max(0, (expiry.getTime() - Date.now()) / (365 * 24 * 60 * 60 * 1000));
  const multiplier = leg.position === "long" ? 1 : -1;

  const optionPrice = leg.type === "call"
    ? blackScholesCall(spotPrice, leg.strike, T, riskFreeRate, volatility)
    : blackScholesPut(spotPrice, leg.strike, T, riskFreeRate, volatility);

  const intrinsicValue = leg.type === "call"
    ? Math.max(0, spotPrice - leg.strike)
    : Math.max(0, leg.strike - spotPrice);

  // P&L = (intrinsic value - premium paid/received) * quantity * multiplier
  const pnl = (intrinsicValue - optionPrice) * leg.quantity * multiplier * 100; // Lot size assumed 100

  return pnl;
}

// Calculate total payoff for a strategy
export function calculateStrategyPayoff(
  strategy: Strategy,
  spotPrice: number,
  riskFreeRate: number,
  volatility: number,
  expiry: Date
): number {
  return strategy.legs.reduce((total, leg) => {
    return total + calculateLegPayoff(leg, spotPrice, expiry, riskFreeRate, volatility);
  }, 0);
}

// Generate payoff points for a range of spot prices
export function generatePayoffCurve(
  strategy: Strategy,
  spotPrice: number,
  riskFreeRate: number,
  volatility: number,
  expiry: Date,
  steps = 100
): Array<{ spot: number; payoff: number }> {
  const minSpot = spotPrice * 0.5;
  const maxSpot = spotPrice * 1.5;
  const step = (maxSpot - minSpot) / steps;

  const points: Array<{ spot: number; payoff: number }> = [];

  for (let i = 0; i <= steps; i++) {
    const spot = minSpot + i * step;
    const payoff = calculateStrategyPayoff(strategy, spot, riskFreeRate, volatility, expiry);
    points.push({ spot, payoff });
  }

  return points;
}

// Pre-built strategies
export const STRATEGIES: Record<StrategyType, Omit<Strategy, "maxProfit" | "maxLoss" | "breakeven" | "probability">> = {
  "long-call": {
    name: "Long Call",
    type: "long-call",
    legs: [{ type: "call", position: "long", strike: 0, premium: 0, quantity: 1 }],
  },
  "short-call": {
    name: "Short Call",
    type: "short-call",
    legs: [{ type: "call", position: "short", strike: 0, premium: 0, quantity: 1 }],
  },
  "long-put": {
    name: "Long Put",
    type: "long-put",
    legs: [{ type: "put", position: "long", strike: 0, premium: 0, quantity: 1 }],
  },
  "short-put": {
    name: "Short Put",
    type: "short-put",
    legs: [{ type: "put", position: "short", strike: 0, premium: 0, quantity: 1 }],
  },
  "bull-call-spread": {
    name: "Bull Call Spread",
    type: "bull-call-spread",
    legs: [
      { type: "call", position: "long", strike: 0, premium: 0, quantity: 1 },
      { type: "call", position: "short", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "bear-put-spread": {
    name: "Bear Put Spread",
    type: "bear-put-spread",
    legs: [
      { type: "put", position: "long", strike: 0, premium: 0, quantity: 1 },
      { type: "put", position: "short", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "long-straddle": {
    name: "Long Straddle",
    type: "long-straddle",
    legs: [
      { type: "call", position: "long", strike: 0, premium: 0, quantity: 1 },
      { type: "put", position: "long", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "long-strangle": {
    name: "Long Strangle",
    type: "long-strangle",
    legs: [
      { type: "call", position: "long", strike: 0, premium: 0, quantity: 1 },
      { type: "put", position: "long", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "iron-condor": {
    name: "Iron Condor",
    type: "iron-condor",
    legs: [
      { type: "put", position: "long", strike: 0, premium: 0, quantity: 1 },
      { type: "put", position: "short", strike: 0, premium: 0, quantity: 1 },
      { type: "call", position: "short", strike: 0, premium: 0, quantity: 1 },
      { type: "call", position: "long", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "iron-butterfly": {
    name: "Iron Butterfly",
    type: "iron-butterfly",
    legs: [
      { type: "put", position: "long", strike: 0, premium: 0, quantity: 1 },
      { type: "put", position: "short", strike: 0, premium: 0, quantity: 1 },
      { type: "call", position: "short", strike: 0, premium: 0, quantity: 1 },
      { type: "call", position: "long", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "covered-call": {
    name: "Covered Call",
    type: "covered-call",
    legs: [
      { type: "call", position: "short", strike: 0, premium: 0, quantity: 1 },
    ],
  },
  "protective-put": {
    name: "Protective Put",
    type: "protective-put",
    legs: [
      { type: "put", position: "long", strike: 0, premium: 0, quantity: 1 },
    ],
  },
};

// Create a strategy with calculated values
export function createStrategy(
  type: StrategyType,
  spotPrice: number,
  strikes: number[],
  premiums: number[],
  riskFreeRate: number,
  volatility: number
): Strategy {
  const template = STRATEGIES[type];
  const legs = template.legs.map((leg, i) => ({
    ...leg,
    strike: strikes[i] || spotPrice,
    premium: premiums[i] || 0,
  }));

  // Calculate max profit and loss (simplified)
  let maxProfit: number;
  let maxLoss: number;
  let breakeven: number[] = [];

  switch (type) {
    case "long-call":
      maxProfit = Infinity;
      maxLoss = legs[0].premium * legs[0].quantity * 100;
      breakeven = [legs[0].strike + legs[0].premium];
      break;
    case "short-call":
      maxProfit = legs[0].premium * legs[0].quantity * 100;
      maxLoss = Infinity;
      breakeven = [legs[0].strike + legs[0].premium];
      break;
    case "bull-call-spread":
      maxProfit = (legs[1].strike - legs[0].strike - (legs[0].premium - legs[1].premium)) * legs[0].quantity * 100;
      maxLoss = (legs[0].premium - legs[1].premium) * legs[0].quantity * 100;
      breakeven = [legs[0].strike + legs[0].premium - legs[1].premium];
      break;
    case "iron-condor":
      maxProfit = (legs[1].premium + legs[2].premium - legs[0].premium - legs[3].premium) * legs[0].quantity * 100;
      maxLoss = maxProfit; // Symmetric iron condor
      breakeven = [
        legs[1].strike - maxProfit / (legs[0].quantity * 100),
        legs[2].strike + maxProfit / (legs[0].quantity * 100),
      ];
      break;
    default:
      maxProfit = Infinity;
      maxLoss = Infinity;
  }

  // Calculate probability (simplified - using delta)
  const delta = legs[0].type === "call" ? 0.5 : -0.5;
  const probability = Math.abs(delta) + 0.1;

  return {
    ...template,
    legs,
    maxProfit,
    maxLoss,
    breakeven,
    probability,
  };
}