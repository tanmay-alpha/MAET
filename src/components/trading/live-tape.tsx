import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { WATCHLIST } from "@/lib/market-catalog";

export function LiveTape({ rows = 12 }: { rows?: number }) {
  const symbols = WATCHLIST.slice(0, rows).map((item) => item.symbol);
  const { quoteMap, streamConnected } = useMarketQuotes(symbols);
  const quotes = symbols.map((symbol) => quoteMap.get(symbol)).filter((quote) => quote !== undefined);

  return (
    <div className="rounded-md border border-border bg-panel/80 backdrop-blur">
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5">
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
          <span className={`h-1.5 w-1.5 rounded-full ${streamConnected ? "bg-bull" : "bg-muted-foreground"}`} />
          Quote tape · Yahoo delayed
        </div>
        <div className="font-mono text-[10px] tabular text-muted-foreground">{quotes.length} quotes</div>
      </div>
      <div className="divide-y divide-border/60">
        {quotes.map((quote) => (
          <div key={quote.symbol} className="flex items-center gap-3 px-3 py-1 font-mono text-[11px] tabular">
            <span className="w-16 text-muted-foreground">{new Date(quote.ts).toLocaleTimeString("en-IN", { hour12: false })}</span>
            <span className="flex-1 truncate font-medium text-foreground">{quote.symbol}</span>
            <span className={`w-16 text-right ${(quote.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
              {quote.changePct === undefined ? "—" : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`}
            </span>
            <span className="w-20 text-right">{quote.price.toFixed(2)}</span>
            <span className="w-20 text-right text-muted-foreground">{quote.volume.toLocaleString("en-IN")}</span>
          </div>
        ))}
        {quotes.length === 0 && <div className="px-3 py-8 text-center text-xs text-muted-foreground">Waiting for real quotes…</div>}
      </div>
    </div>
  );
}
