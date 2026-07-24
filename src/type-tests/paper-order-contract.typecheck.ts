/**
 * Compile-time contract tests for the v3 paper order discriminated union.
 * Run via: bun run typecheck:frontend
 */
import type {
  PaperAccount,
  PaperOrder,
  PlacePaperLimitOrder,
  PlacePaperMarketOrder,
  PlacePaperStopLimitOrder,
} from "@shared/domain/paper-trading/types";
import type { PaperExecutionRequest } from "@shared/domain/paper-trading/execution";
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

// @ts-expect-error marketPrice is not part of MARKET contract
const invalidMarketPrice: PlacePaperMarketOrder = { type: "MARKET", symbol: "RELIANCE", side: "BUY", quantity: 10, quote, marketPrice: 2500 };

const partialQuote = {
  symbol: "RELIANCE",
  price: 2500,
};

// @ts-expect-error complete ExecutionQuote required
const invalidPartialQuote: PlacePaperMarketOrder = { type: "MARKET", symbol: "RELIANCE", side: "BUY", quantity: 10, quote: partialQuote };

// @ts-expect-error quote is required for MARKET
const invalidMissingQuote: PlacePaperMarketOrder = { type: "MARKET", symbol: "RELIANCE", side: "BUY", quantity: 10 };

// @ts-expect-error limitPrice is required for LIMIT
const invalidMissingLimitPrice: PlacePaperLimitOrder = { type: "LIMIT", symbol: "RELIANCE", side: "BUY", quantity: 10 };

// @ts-expect-error stopPrice is required for STOP_LOSS_LIMIT
const invalidMissingStopPrice: PlacePaperStopLimitOrder = { type: "STOP_LOSS_LIMIT", symbol: "RELIANCE", side: "SELL", quantity: 10, limitPrice: 990 };

// @ts-expect-error limitPrice is required for STOP_LOSS_LIMIT
const invalidMissingStopLimitPrice: PlacePaperStopLimitOrder = { type: "STOP_LOSS_LIMIT", symbol: "RELIANCE", side: "SELL", quantity: 10, stopPrice: 1000 };

declare const account: PaperAccount;
declare const order: PaperOrder;

// @ts-expect-error callers cannot supply authoritative fillPrice
const invalidExecutionAuthority: PaperExecutionRequest = { account, order, fillQuantity: 10, quote, reason: "USER_ORDER", fillPrice: 2500 };

void invalidMarketPrice;
void invalidPartialQuote;
void invalidMissingQuote;
void invalidMissingLimitPrice;
void invalidMissingStopPrice;
void invalidMissingStopLimitPrice;
void invalidExecutionAuthority;
