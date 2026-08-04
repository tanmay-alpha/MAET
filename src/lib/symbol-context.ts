export interface SymbolContext {
  symbol: string;
  exchange: "NSE" | "BSE";
  companyId?: string;
  sourceContext?: "screener" | "watchlist" | "search" | "terminal" | "portfolio";
  screenerRunId?: string;
}

export const DEFAULT_SYMBOL_CONTEXT: SymbolContext = {
  symbol: "RELIANCE",
  exchange: "NSE",
  sourceContext: "terminal",
};

export function parseSymbolContext(raw: Record<string, unknown>): SymbolContext {
  const symbol = typeof raw.symbol === "string" && raw.symbol.trim()
    ? raw.symbol.trim().toUpperCase()
    : DEFAULT_SYMBOL_CONTEXT.symbol;
  
  const exchange: "NSE" | "BSE" = raw.exchange === "BSE" ? "BSE" : "NSE";

  const companyId = typeof raw.companyId === "string" && raw.companyId.trim()
    ? raw.companyId.trim()
    : undefined;

  const validSources = ["screener", "watchlist", "search", "terminal", "portfolio"] as const;
  const sourceContext = typeof raw.sourceContext === "string" && (validSources as readonly string[]).includes(raw.sourceContext)
    ? (raw.sourceContext as SymbolContext["sourceContext"])
    : undefined;

  const screenerRunId = typeof raw.screenerRunId === "string" && raw.screenerRunId.trim()
    ? raw.screenerRunId.trim()
    : undefined;

  return {
    symbol,
    exchange,
    companyId,
    sourceContext,
    screenerRunId,
  };
}

export function buildTerminalUrl(context: SymbolContext): string {
  const params = new URLSearchParams();
  params.set("symbol", context.symbol);
  params.set("exchange", context.exchange);
  if (context.companyId) params.set("companyId", context.companyId);
  if (context.sourceContext) params.set("sourceContext", context.sourceContext);
  if (context.screenerRunId) params.set("screenerRunId", context.screenerRunId);

  return `/terminal?${params.toString()}`;
}
