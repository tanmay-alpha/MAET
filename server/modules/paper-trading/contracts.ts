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

import { z } from "zod";

export const PaperMarketOrderSchema = z
  .object({
    type: z.literal("MARKET"),
    clientOrderId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(128),
    symbol: z.string().min(1).transform((s) => s.trim().toUpperCase()),
    exchange: z.enum(["NSE", "BSE"]),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().int().positive(),
    stopLossPrice: z.number().positive().optional(),
    takeProfitPrice: z.number().positive().optional(),
    trailingDistance: z.number().positive().optional(),
    trailingIsPercent: z.boolean().optional(),
  })
  .strict();

export const PaperLimitOrderSchema = z
  .object({
    type: z.literal("LIMIT"),
    clientOrderId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(128),
    symbol: z.string().min(1).transform((s) => s.trim().toUpperCase()),
    exchange: z.enum(["NSE", "BSE"]),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().int().positive(),
    limitPrice: z.number().positive(),
    stopLossPrice: z.number().positive().optional(),
    takeProfitPrice: z.number().positive().optional(),
  })
  .strict();

export const PaperStopLossLimitOrderSchema = z
  .object({
    type: z.literal("STOP_LOSS_LIMIT"),
    clientOrderId: z.string().uuid(),
    idempotencyKey: z.string().min(1).max(128),
    symbol: z.string().min(1).transform((s) => s.trim().toUpperCase()),
    exchange: z.enum(["NSE", "BSE"]),
    side: z.enum(["BUY", "SELL"]),
    quantity: z.number().int().positive(),
    stopPrice: z.number().positive(),
    limitPrice: z.number().positive(),
  })
  .strict();

export const PaperOrderCommandSchema = z.discriminatedUnion("type", [
  PaperMarketOrderSchema,
  PaperLimitOrderSchema,
  PaperStopLossLimitOrderSchema,
]);

export type PaperOrderCommandInput = z.infer<typeof PaperOrderCommandSchema>;

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
  trailingDistance?: number;
  trailingIsPercent?: boolean;
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
