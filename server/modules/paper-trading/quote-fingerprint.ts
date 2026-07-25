import { createHash } from "crypto";

export interface QuoteFingerprintInput {
  exchange: string;
  symbol: string;
  source: string;
  quality: string;
  timestamp?: string | number | Date;
  ts?: string | number | Date;
  price: number;
  volume?: number;
}

export function computeQuoteFingerprint(quote: QuoteFingerprintInput): string {
  const tsVal = quote.timestamp ?? quote.ts;
  const tsStr = tsVal
    ? (tsVal instanceof Date ? tsVal.toISOString() : new Date(tsVal).toISOString())
    : new Date().toISOString();

  const canonical = [
    quote.exchange || "NSE",
    (quote.symbol || "").trim().toUpperCase(),
    quote.source || "simulated",
    quote.quality || "live",
    tsStr,
    (quote.price || 0).toFixed(4),
    (quote.volume ?? 0).toString(),
  ].join(":");

  return createHash("sha256").update(canonical).digest("hex");
}
