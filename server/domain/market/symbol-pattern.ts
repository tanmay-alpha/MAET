/**
 * Symbols accepted by the public market endpoints (covers M&M, BAJAJ-AUTO, indices).
 * Kept free of imports so schema modules loaded outside the server bundle (e.g. the
 * Playwright mock API under plain Node) don't pull in the bundled symbol JSON.
 */
export const MARKET_SYMBOL_PATTERN = /^[A-Z0-9&.-]+$/;
