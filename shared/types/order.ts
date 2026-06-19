import { z } from "zod";
import { ExchangeSchema } from "./market";

export const OrderSideSchema = z.enum(["BUY", "SELL"]);
export const OrderTypeSchema = z.enum(["MARKET", "LIMIT", "SL", "SL-M"]);
export const OrderStatusSchema = z.enum([
  "pending",
  "partial",
  "filled",
  "cancelled",
  "rejected",
]);

export const OrderSchema = z.object({
  id: z.string(),
  userId: z.string(),
  symbol: z.string(),
  exchange: ExchangeSchema,
  side: OrderSideSchema,
  qty: z.number().int().positive(),
  type: OrderTypeSchema,
  limitPrice: z.number().positive().optional(),
  status: OrderStatusSchema,
  idempotencyKey: z.string().min(1),
  placedAt: z.string().datetime(),
  filledAt: z.string().datetime().optional(),
  rejectReason: z.string().optional(),
});
export type Order = z.infer<typeof OrderSchema>;

export const FillSchema = z.object({
  orderId: z.string(),
  qty: z.number().int().positive(),
  price: z.number().positive(),
  ts: z.string().datetime(),
  fee: z.number().nonnegative().default(0),
});
export type Fill = z.infer<typeof FillSchema>;

export const PositionSchema = z.object({
  userId: z.string(),
  symbol: z.string(),
  exchange: ExchangeSchema,
  qty: z.number().int(),
  avgPrice: z.number().nonnegative(),
  realizedPnl: z.number(),
  updatedAt: z.string().datetime(),
});
export type Position = z.infer<typeof PositionSchema>;
