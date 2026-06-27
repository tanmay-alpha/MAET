import { z } from "zod";

export const ExchangeSchema = z.enum(["NSE", "BSE"]);

export const QuoteSchema = z.object({
  exchange: ExchangeSchema,
  symbol: z.string().min(1),
  name: z.string(),
  token: z.string(),
  yahooTicker: z.string(),
  isin: z.string().optional(),
  isActive: z.boolean().default(true),
});
export type Quote = z.infer<typeof QuoteSchema>;

export const TickSchema = z.object({
  exchange: ExchangeSchema,
  symbol: z.string().min(1),
  price: z.number().positive(),
  volume: z.number().nonnegative(),
  ts: z.string().datetime(),
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  source: z.enum(["angelone", "yahoo", "nse"]).default("yahoo"),
  previousClose: z.number().positive().optional(),
  change: z.number().optional(),
  changePct: z.number().optional(),
  marketState: z.string().optional(),
  currency: z.string().optional(),
});
export type Tick = z.infer<typeof TickSchema>;

export const CandleSchema = z.object({
  symbol: z.string(),
  tf: z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]),
  ts: z.string().datetime(),
  open: z.number().nonnegative(),
  high: z.number().nonnegative(),
  low: z.number().nonnegative(),
  close: z.number().nonnegative(),
  volume: z.number().nonnegative(),
});
export type Candle = z.infer<typeof CandleSchema>;
