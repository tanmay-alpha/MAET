import type {
  ExecutionQuote,
  MarketDataQuality,
  MarketDataSource,
} from "../../types/market";

export type PaperAccountStatus =
  | "ACTIVE"
  | "LIQUIDATION_PENDING"
  | "LIQUIDATED";

export type PaperOrderType =
  | "MARKET"
  | "LIMIT"
  | "STOP_LOSS_LIMIT";

export type PaperOrderStatus =
  | "PENDING"
  | "TRIGGERED"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "CANCELLED"
  | "REJECTED";

export type PaperExecutionReason =
  | "USER_ORDER"
  | "STOP_TRIGGER"
  | "TRAILING_STOP"
  | "MARGIN_LIQUIDATION";

export interface PaperPosition {
  symbol: string;
  quantity: number; // positive for Long, negative for Short
  averagePrice: number;
  marginLocked: number;
  realisedPnl: number;
  unrealisedPnl: number;
  updatedAt: string;
}

export interface PaperFill {
  id: string;
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;

  referencePrice: number;
  fillPrice: number;
  slippage: number;
  fees: number;
  realisedPnl: number;

  quoteSource: MarketDataSource;
  quoteQuality: MarketDataQuality;
  quoteTimestamp: string;
  exchange: "NSE" | "BSE";

  reason: PaperExecutionReason;
  executedAt: string;
}

export interface PaperOrder {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  type: PaperOrderType;
  status: PaperOrderStatus;

  limitPrice?: number;
  stopPrice?: number;
  triggeredAt?: string;

  filledQuantity: number;
  averageFillPrice?: number;

  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  trailingHighWatermark?: number;
  trailingLowWatermark?: number;
  trailingIsPercent?: boolean;

  createdAt: string;
  updatedAt: string;
  rejectionReason?: string;
  parentOrderId?: string;

  // Provenance fields captured at placement/fill
  quoteSource?: MarketDataSource;
  quoteQuality?: MarketDataQuality;
  quoteTimestamp?: string;
  referencePrice?: number;
}

export interface PaperAccount {
  version: 3;
  initialCash: number;
  cash: number;
  allocatedMargin: number;
  maintenanceMargin: number;
  realisedPnl: number;

  status: PaperAccountStatus;
  lockReason?: string;
  lockedAt?: string;
  liquidationCompletedAt?: string;

  positions: PaperPosition[];
  orders: PaperOrder[];
  fills: PaperFill[];
}

export type PlacePaperMarketOrder = {
  type: "MARKET";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  quote: ExecutionQuote;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  trailingIsPercent?: boolean;
};

export type PlacePaperLimitOrder = {
  type: "LIMIT";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  limitPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
};

export type PlacePaperStopLimitOrder = {
  type: "STOP_LOSS_LIMIT";
  symbol: string;
  side: "BUY" | "SELL";
  quantity: number;
  stopPrice: number;
  limitPrice: number;
};

export type PlacePaperOrder =
  | PlacePaperMarketOrder
  | PlacePaperLimitOrder
  | PlacePaperStopLimitOrder;
