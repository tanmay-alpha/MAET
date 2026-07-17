/**
 * Symbol Normalizer — Standardize symbols across NSE and BSE
 */

// Common NSE→Yahoo suffix mapping
const NSE_SUFFIX = ".NS";
const BSE_SUFFIX = ".BO";

// Known symbol remaps (NSE symbol → canonical)
const SYMBOL_REMAPS: Record<string, string> = {
  "M&M": "M&M",
  "BAJAJ-AUTO": "BAJAJ-AUTO",
  "L&TFH": "L&TFH",
  "L&TIH": "L&TIH",
};

// BSE to NSE symbol mappings (partial — common cases)
const BSE_TO_NSE: Record<string, string> = {
  "500325": "RELIANCE",
  "532540": "TCS",
  "500180": "HDFCBANK",
};

export function normalizeNSESymbol(symbol: string): string {
  const upper = symbol.trim().toUpperCase();
  return SYMBOL_REMAPS[upper] ?? upper;
}

export function toYahooSymbol(symbol: string, exchange: "NSE" | "BSE" = "NSE"): string {
  const normalized = normalizeNSESymbol(symbol);
  const suffix = exchange === "NSE" ? NSE_SUFFIX : BSE_SUFFIX;
  if (normalized.endsWith(NSE_SUFFIX) || normalized.endsWith(BSE_SUFFIX)) {
    return normalized;
  }
  return `${normalized}${suffix}`;
}

export function fromYahooSymbol(yahooSymbol: string): { symbol: string; exchange: "NSE" | "BSE" } {
  if (yahooSymbol.endsWith(NSE_SUFFIX)) {
    return { symbol: yahooSymbol.slice(0, -3), exchange: "NSE" };
  }
  if (yahooSymbol.endsWith(BSE_SUFFIX)) {
    return { symbol: yahooSymbol.slice(0, -3), exchange: "BSE" };
  }
  return { symbol: yahooSymbol, exchange: "NSE" };
}

export function bseCodeToNSESymbol(bseCode: string): string | undefined {
  return BSE_TO_NSE[bseCode];
}

export function isValidSymbol(symbol: string): boolean {
  // NSE symbols: 1-10 chars, alphanumeric + & and -
  return /^[A-Z0-9&-]{1,10}$/.test(symbol.toUpperCase());
}
