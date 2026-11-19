/**
 * Symbols accepted by the public market endpoints (covers M&M, BAJAJ-AUTO, indices).
 * Kept free of imports so schema modules loaded outside the server bundle (e.g. the
 * Playwright mock API under plain Node) don't pull in the bundled symbol JSON.
 */
export const MARKET_SYMBOL_PATTERN = /^[A-Z0-9&.-]+$/;

/** Longest symbol a public market endpoint accepts (symbol columns are varchar(30)). */
export const MAX_MARKET_SYMBOL_LENGTH = 30;

/** A normalized (trimmed, upper-cased) symbol the public market endpoints accept. */
export function isMarketSymbol(symbol: string): boolean {
  return symbol.length > 0 && symbol.length <= MAX_MARKET_SYMBOL_LENGTH && MARKET_SYMBOL_PATTERN.test(symbol);
}
