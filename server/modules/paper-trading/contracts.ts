import type {
  paperAccounts,
  paperOrders,
  paperPositions,
  paperFills,
  paperLedgerEntries,
  paperOutboxEvents,
} from "../../db/schema";

export type PaperAccountRow = typeof paperAccounts.$inferSelect;
export type NewPaperAccountRow = typeof paperAccounts.$inferInsert;

export type PaperOrderRow = typeof paperOrders.$inferSelect;
export type NewPaperOrderRow = typeof paperOrders.$inferInsert;

export type PaperPositionRow = typeof paperPositions.$inferSelect;
export type NewPaperPositionRow = typeof paperPositions.$inferInsert;

export type PaperFillRow = typeof paperFills.$inferSelect;
export type NewPaperFillRow = typeof paperFills.$inferInsert;

export type PaperLedgerEntryRow = typeof paperLedgerEntries.$inferSelect;
export type NewPaperLedgerEntryRow = typeof paperLedgerEntries.$inferInsert;

export type PaperOutboxEventRow = typeof paperOutboxEvents.$inferSelect;
export type NewPaperOutboxEventRow = typeof paperOutboxEvents.$inferInsert;

export interface PaperOrderCommand {
  symbol: string;
  exchange?: string;
  side: "BUY" | "SELL";
  type: "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT";
  qty: number;
  limitPrice?: number;
  stopPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  clientOrderId?: string;
  idempotencyKey?: string;
}

export interface PaperQuoteInput {
  symbol: string;
  exchange: string;
  price: number;
  source: string;
  quality: string;
  ts: Date | string | number;
  volume?: number;
}

export interface PaperTradingState {
  account: PaperAccountRow;
  positions: PaperPositionRow[];
  orders: PaperOrderRow[];
  fills: PaperFillRow[];
  asOf: Date;
}

export interface MatchingReceipt {
  orderId: string;
  fillId: string;
  symbol: string;
  fillPrice: number;
  quantity: number;
  status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED";
  rejectReason?: string;
}
