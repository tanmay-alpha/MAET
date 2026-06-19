import type { Quote } from "@shared/types";
import nifty50 from "../../../shared/symbols/nifty50.json";

export const SYMBOLS: readonly Quote[] = (nifty50 as Quote[]).filter((q) => q.isActive);

const byKey = new Map<string, Quote>();
for (const q of SYMBOLS) byKey.set(`${q.exchange}:${q.symbol}`, q);

export function lookupSymbol(exchange: "NSE" | "BSE", symbol: string): Quote | undefined {
  return byKey.get(`${exchange}:${symbol}`);
}

export function yahooTicker(quote: Quote): string {
  return quote.exchange === "NSE" ? `${quote.symbol}.NS` : `${quote.symbol}.BO`;
}
