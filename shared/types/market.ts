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

export const MarketDataSourceSchema = z.enum(["angelone", "yahoo", "nse", "simulated"]);
export type MarketDataSource = z.infer<typeof MarketDataSourceSchema>;

export const MarketDataQualitySchema = z.enum(["live", "delayed", "stale", "synthetic"]);
export type MarketDataQuality = z.infer<typeof MarketDataQualitySchema>;

export const TickSchema = z.object({
  exchange: ExchangeSchema,
  symbol: z.string().min(1),
  price: z.number().positive(),
  volume: z.number().nonnegative(),
  ts: z.string().datetime(),
  bid: z.number().positive().optional(),
  ask: z.number().positive().optional(),
  source: MarketDataSourceSchema.default("yahoo"),
  quality: MarketDataQualitySchema.default("delayed"),
  exchangeTimestamp: z.string().optional(),
  receivedAt: z.string().optional(),
  previousClose: z.number().positive().optional(),
  change: z.number().optional(),
  changePct: z.number().optional(),
  marketState: z.string().optional(),
  currency: z.string().optional(),
});
export type Tick = z.infer<typeof TickSchema>;

export interface ExecutionQuotePolicyConfig {
  maxAgeMs?: number;
  allowDelayed?: boolean;
  allowSynthetic?: boolean;
}

export interface QuoteExecutionResult {
  executable: boolean;
  reason?: string;
  ageMs?: number;
}

export function evaluateExecutionQuote(
  tick: Partial<Tick> | null | undefined,
  now: number = Date.now(),
  config: ExecutionQuotePolicyConfig = {}
): QuoteExecutionResult {
  const maxAgeMs = config.maxAgeMs ?? 5000;
  const allowDelayed = config.allowDelayed ?? false;
  const allowSynthetic = config.allowSynthetic ?? false;

  if (!tick) {
    return { executable: false, reason: "No market quote available" };
  }

  if (typeof tick.price !== "number" || !Number.isFinite(tick.price) || tick.price <= 0) {
    return { executable: false, reason: "Non-positive or non-finite quote price" };
  }

  if (tick.quality === "synthetic" || tick.source === "simulated") {
    if (!allowSynthetic) {
      return { executable: false, reason: "Synthetic quotes are rejected for execution" };
    }
  }

  if (tick.quality === "delayed" || tick.source === "yahoo") {
    if (!allowDelayed) {
      return { executable: false, reason: "Delayed quotes are rejected for execution" };
    }
  }

  if (!tick.ts) {
    return { executable: false, reason: "Quote is missing timestamp" };
  }

  const quoteTime = new Date(tick.ts).getTime();
  if (Number.isNaN(quoteTime)) {
    return { executable: false, reason: "Quote timestamp is invalid" };
  }

  const ageMs = Math.max(0, now - quoteTime);
  if (ageMs > maxAgeMs) {
    return { executable: false, reason: `Quote is stale (${Math.round(ageMs / 1000)}s old > ${Math.round(maxAgeMs / 1000)}s limit)`, ageMs };
  }

  return { executable: true, ageMs };
}

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
