/**
 * Compile-time contract tests for the v3 paper order discriminated union.
 * Run via: bun run typecheck:frontend
 */
import type {
  PlacePaperMarketOrder,
  PlacePaperLimitOrder,
  PlacePaperStopLimitOrder,
} from "@shared/domain/paper-trading/types";

import type { ExecutionQuote } from "@shared/types";

const quote: ExecutionQuote = {
  exchange: "NSE",
  symbol: "RELIANCE",
  price: 2500,
  volume: 1000,
  ts: new Date().toISOString(),
  source: "angelone",
  quality: "live",
};

// ─── POSITIVE CHECKS ─────────────────────────────────────────────────────────

export const validMarket: PlacePaperMarketOrder = {
  type: "MARKET",
  symbol: "RELIANCE",
  side: "BUY",
  quantity: 10,
  quote,
};

export const validLimit: PlacePaperLimitOrder = {
  type: "LIMIT",
  symbol: "TCS",
  side: "BUY",
  quantity: 5,
  limitPrice: 3500,
};

export const validStopLimit: PlacePaperStopLimitOrder = {
  type: "STOP_LOSS_LIMIT",
  symbol: "HDFCBANK",
  side: "SELL",
  quantity: 5,
  stopPrice: 1400,
  limitPrice: 1395,
};

// ─── NEGATIVE CHECKS ─────────────────────────────────────────────────────────
// Use function-return form so @ts-expect-error suppresses the error on the
// immediately following `return` statement.

// LIMIT order missing required limitPrice
function requiresLimitPrice(): PlacePaperLimitOrder {
  // @ts-expect-error limitPrice is missing
  return { type: "LIMIT", symbol: "RELIANCE", side: "BUY", quantity: 10 };
}

// STOP_LOSS_LIMIT order missing required stopPrice and limitPrice
function requiresStopAndLimitPrice(): PlacePaperStopLimitOrder {
  // @ts-expect-error stopPrice and limitPrice are missing
  return { type: "STOP_LOSS_LIMIT", symbol: "RELIANCE", side: "SELL", quantity: 10 };
}

// MARKET order missing required quote
function requiresQuote(): PlacePaperMarketOrder {
  // @ts-expect-error quote is missing
  return { type: "MARKET", symbol: "RELIANCE", side: "BUY", quantity: 10 };
}

void requiresLimitPrice;
void requiresStopAndLimitPrice;
void requiresQuote;
