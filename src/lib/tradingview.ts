export function getTradingViewUrl(symbol: string, exchange = "NSE"): string {
  const safeSymbol = symbol.trim().toUpperCase().replace(/[^A-Z0-9&.-]/gu, "");
  const safeExchange = exchange === "BSE" ? "BSE" : "NSE";
  return `https://www.tradingview.com/chart/?symbol=${encodeURIComponent(`${safeExchange}:${safeSymbol}`)}`;
}
