import nifty50 from "@shared/symbols/nifty50.json";
import type { MarketQuote } from "@/lib/market-api";

export const NIFTY50_SYMBOLS = nifty50.map((company) => company.symbol);

export function rankNiftyMovers(quotes: ReadonlyMap<string, MarketQuote>) {
  const available = nifty50.flatMap((company) => {
    const quote = quotes.get(company.symbol);
    return quote && quote.changePct !== undefined && Number.isFinite(quote.changePct)
      ? [{ ...company, quote, changePct: quote.changePct }]
      : [];
  });
  return {
    gainers: available.filter((item) => item.changePct > 0).sort((a, b) => b.changePct - a.changePct || a.symbol.localeCompare(b.symbol)).slice(0, 5),
    losers: available.filter((item) => item.changePct < 0).sort((a, b) => a.changePct - b.changePct || a.symbol.localeCompare(b.symbol)).slice(0, 5),
  };
}

export function marketPhaseLabel(phase: string | undefined): string {
  switch (phase) {
    case "OPEN": return "Market open";
    case "PRE_OPEN": return "Market pre-open";
    case "CLOSED": return "Market closed";
    case "HOLIDAY": return "Market closed · holiday";
    case "AFTER_HOURS": return "Market closed · after hours";
    default: return "Market phase unavailable";
  }
}
