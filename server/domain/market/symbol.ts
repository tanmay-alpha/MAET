import type { Quote } from "@shared/types";
import nifty50 from "../../../shared/symbols/nifty50.json";

export const SYMBOLS: readonly Quote[] = (nifty50 as Quote[]).filter((q) => q.isActive);

export type MarketSymbol = {
  symbol: string;
  ticker: string;
  exchange: "NSE" | "BSE";
};

export const INDEX_SYMBOLS: readonly MarketSymbol[] = [
  { symbol: "NIFTY50", ticker: "^NSEI", exchange: "NSE" },
  { symbol: "BANKNIFTY", ticker: "^NSEBANK", exchange: "NSE" },
  { symbol: "SENSEX", ticker: "^BSESN", exchange: "BSE" },
  { symbol: "NIFTYIT", ticker: "^CNXIT", exchange: "NSE" },
  { symbol: "NIFTYFMCG", ticker: "^CNXFMCG", exchange: "NSE" },
  { symbol: "INDIAVIX", ticker: "^INDIAVIX", exchange: "NSE" },
];

const byKey = new Map<string, Quote>();
const byToken = new Map<string, Quote>();
for (const q of SYMBOLS) byKey.set(`${q.exchange}:${q.symbol}`, q);
for (const q of SYMBOLS) byToken.set(q.token, q);

export function registerMarketSymbols(quotes: Quote[]): void {
  for (const quote of quotes) {
    byKey.set(`${quote.exchange}:${quote.symbol}`, quote);
    byToken.set(quote.token, quote);
  }
}

export function lookupSymbol(exchange: "NSE" | "BSE", symbol: string): Quote | undefined {
  return byKey.get(`${exchange}:${symbol}`);
}

export function lookupSymbolByToken(token: string): Quote | undefined {
  return byToken.get(token);
}

export function yahooTicker(quote: Quote): string {
  const configured = quote.yahooTicker?.trim();
  if (configured?.startsWith("^") || configured?.endsWith(".NS") || configured?.endsWith(".BO")) {
    return configured;
  }
  const base = configured || quote.symbol;
  return quote.exchange === "NSE" ? `${base}.NS` : `${base}.BO`;
}

export function resolveMarketSymbol(symbol: string): MarketSymbol {
  const normalized = symbol.trim().toUpperCase();
  const index = INDEX_SYMBOLS.find((item) => item.symbol === normalized);
  if (index) return index;

  const quote = lookupSymbol("NSE", normalized) ?? lookupSymbol("BSE", normalized);
  if (quote) {
    return { symbol: quote.symbol, ticker: yahooTicker(quote), exchange: quote.exchange };
  }

  return { symbol: normalized, ticker: `${normalized}.NS`, exchange: "NSE" };
}
