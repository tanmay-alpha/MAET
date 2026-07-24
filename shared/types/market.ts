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

export const ExecutionQuoteSchema = z.object({
  exchange: z.enum(["NSE", "BSE"]),
  symbol: z.string().min(1),
  price: z.number().finite().positive(),
  volume: z.number().finite().nonnegative().optional(),
  ts: z.string().min(1),
  source: z.enum(["angelone", "yahoo", "nse", "simulated"]),
  quality: z.enum(["live", "delayed", "stale", "synthetic"]),
});
export type ExecutionQuote = z.infer<typeof ExecutionQuoteSchema>;

export interface ExecutionQuotePolicyConfig {
  maxAgeMs?: number;
  maxFutureMs?: number;
  allowDelayed?: boolean;
  allowSynthetic?: boolean;
}

export interface QuoteExecutionResult {
  executable: boolean;
  reason?: string;
  ageMs?: number;
}

export function evaluateExecutionQuote(
  quote: unknown,
  expectedSymbolOrNow?: string | number,
  nowOrConfig?: number | ExecutionQuotePolicyConfig,
  configArg: ExecutionQuotePolicyConfig = {}
): QuoteExecutionResult {
  let expectedSymbol: string | undefined = undefined;
  let now: number = Date.now();
  let config: ExecutionQuotePolicyConfig = configArg;

  if (typeof expectedSymbolOrNow === "string") {
    expectedSymbol = expectedSymbolOrNow;
    if (typeof nowOrConfig === "number") {
      now = nowOrConfig;
    } else if (nowOrConfig && typeof nowOrConfig === "object") {
      config = nowOrConfig;
    }
  } else if (typeof expectedSymbolOrNow === "number") {
    now = expectedSymbolOrNow;
    if (nowOrConfig && typeof nowOrConfig === "object") {
      config = nowOrConfig as ExecutionQuotePolicyConfig;
    }
  }

  const maxAgeMs = config.maxAgeMs ?? 5000;
  const maxFutureMs = config.maxFutureMs ?? 10000;
  const allowDelayed = config.allowDelayed ?? false;
  const allowSynthetic = config.allowSynthetic ?? false;

  if (!quote || typeof quote !== "object") {
    return { executable: false, reason: "No market quote available" };
  }

  const raw = quote as Record<string, any>;
  const quoteToParse = {
    ...raw,
    ts: raw.ts ?? raw.timestamp,
  };

  const parsed = ExecutionQuoteSchema.safeParse(quoteToParse);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    const field = issue?.path.join(".") || "quote";
    const msg = issue?.code === "invalid_type" && issue?.path.includes("ts")
      ? "missing timestamp"
      : issue?.message;
    return { executable: false, reason: `Quote validation failed for ${field}: ${msg}` };
  }

  const q = parsed.data;

  if (expectedSymbol && expectedSymbol.trim() !== "") {
    if (q.symbol.trim().toUpperCase() !== expectedSymbol.trim().toUpperCase()) {
      return {
        executable: false,
        reason: `Quote symbol mismatch: expected ${expectedSymbol.toUpperCase()} but received ${q.symbol.toUpperCase()}`,
      };
    }
  }

  if (q.quality === "stale") {
    return { executable: false, reason: "Quote quality is marked stale" };
  }

  if (q.quality === "synthetic" || q.source === "simulated") {
    if (!allowSynthetic) {
      return { executable: false, reason: "Synthetic quotes are rejected for execution" };
    }
  }

  if (q.quality === "delayed" || q.source === "yahoo") {
    if (!allowDelayed) {
      return { executable: false, reason: "Delayed quotes are rejected for execution" };
    }
  }

  const quoteTime = new Date(q.ts).getTime();
  if (Number.isNaN(quoteTime)) {
    return { executable: false, reason: "Quote timestamp is invalid" };
  }

  if (quoteTime > now + maxFutureMs) {
    return { executable: false, reason: `Quote timestamp is in the future by ${Math.round((quoteTime - now) / 1000)}s` };
  }

  const ageMs = now - quoteTime;
  if (ageMs > maxAgeMs) {
    return {
      executable: false,
      reason: `Quote is stale (${Math.round(ageMs / 1000)}s old > ${Math.round(maxAgeMs / 1000)}s limit)`,
      ageMs,
    };
  }

  return { executable: true, ageMs: Math.max(0, ageMs) };
}

export const CandleSchema = z.object({
  symbol: z.string(),
  tf: z.enum(["1m", "5m", "15m", "1h", "1d", "1wk"]),
  ts: z.string(),
  open: z.number().nonnegative(),
  high: z.number().nonnegative(),
  low: z.number().nonnegative(),
  close: z.number().nonnegative(),
  volume: z.number().nonnegative(),
  source: z.string().optional(),
});
export type Candle = z.infer<typeof CandleSchema>;
