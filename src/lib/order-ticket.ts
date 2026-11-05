import type { PaperOrderDraft } from "@/hooks/use-paper-account";

export type TicketOrderType = "MKT" | "LMT" | "SL";

/** Raw order-ticket form state; prices are the input strings as typed. */
export interface OrderTicketInput {
  symbol: string;
  exchange: "NSE" | "BSE";
  side: "BUY" | "SELL";
  type: TicketOrderType;
  quantity: number | null;
  limitPrice: string;
  triggerPrice: string;
  marketPrice: number | undefined;
  stopLoss: string;
  takeProfit: string;
}

export type OrderTicketResult = { ok: true; order: PaperOrderDraft } | { ok: false; error: string };

function positivePrice(raw: string): number | null {
  const value = Number(raw);
  return raw.trim() !== "" && Number.isFinite(value) && value > 0 ? value : null;
}

/** Validates the ticket and builds the paper order command it describes. */
export function buildTicketOrder(input: OrderTicketInput): OrderTicketResult {
  const { symbol, exchange, side, type, quantity } = input;
  if (!quantity) return { ok: false, error: "Quantity must be a positive integer." };

  if (input.stopLoss && positivePrice(input.stopLoss) === null) {
    return { ok: false, error: "Stop loss price must be positive." };
  }
  if (input.takeProfit && positivePrice(input.takeProfit) === null) {
    return { ok: false, error: "Take profit price must be positive." };
  }
  const brackets = {
    stopLossPrice: positivePrice(input.stopLoss) ?? undefined,
    takeProfitPrice: positivePrice(input.takeProfit) ?? undefined,
  };

  if (type === "MKT") {
    if (!input.marketPrice || input.marketPrice <= 0) {
      return { ok: false, error: "Market quote unavailable for MARKET order." };
    }
    return { ok: true, order: { type: "MARKET", symbol, exchange, side, quantity, ...brackets } };
  }

  const limitPrice = positivePrice(input.limitPrice);
  if (limitPrice === null) return { ok: false, error: "Limit price must be greater than 0." };

  if (type === "LMT") {
    return { ok: true, order: { type: "LIMIT", symbol, exchange, side, quantity, limitPrice, ...brackets } };
  }

  const stopPrice = positivePrice(input.triggerPrice);
  if (stopPrice === null) return { ok: false, error: "Trigger price must be greater than 0." };
  // Once triggered the order rests as a limit order, so the limit must leave room to
  // fill: a buy stop may pay up to its limit, a sell stop may sell down to its limit.
  if (side === "BUY" && stopPrice > limitPrice) {
    return { ok: false, error: "For a buy stop, the trigger price must be at or below the limit price." };
  }
  if (side === "SELL" && stopPrice < limitPrice) {
    return { ok: false, error: "For a sell stop, the trigger price must be at or above the limit price." };
  }
  return { ok: true, order: { type: "STOP_LOSS_LIMIT", symbol, exchange, side, quantity, stopPrice, limitPrice } };
}
