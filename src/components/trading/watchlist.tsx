import { Search } from "lucide-react";
import type { MarketQuote } from "@/lib/market-api";
import { WATCHLIST } from "@/lib/market-catalog";

export function Watchlist({
  active,
  onSelect,
  quotes,
}: {
  active: string;
  onSelect: (symbol: string) => void;
  quotes: Map<string, MarketQuote>;
}) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="flex items-center gap-2 border-b border-border px-3 py-2">
        <Search className="h-3.5 w-3.5 text-muted-foreground" />
        <input
          placeholder="Search NSE / BSE"
          className="w-full bg-transparent text-xs outline-none placeholder:text-muted-foreground"
        />
      </div>
      <div className="grid grid-cols-12 border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="col-span-5">Symbol</div>
        <div className="col-span-4 text-right">LTP</div>
        <div className="col-span-3 text-right">Chg%</div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {WATCHLIST.map((item) => {
          const quote = quotes.get(item.symbol);
          const price = quote?.price;
          const changePct = quote?.changePct;
          return (
            <button
              key={item.symbol}
              onClick={() => onSelect(item.symbol)}
              className={`grid w-full grid-cols-12 items-center px-3 py-2 text-xs transition-colors hover:bg-accent ${active === item.symbol ? "bg-accent" : ""}`}
            >
              <div className="col-span-5 text-left">
                <div className="font-medium">{item.symbol}</div>
                <div className="truncate text-[10px] text-muted-foreground">{item.name}</div>
              </div>
              <div className="col-span-4 text-right font-mono tabular">{price?.toFixed(2) ?? "—"}</div>
              <div className={`col-span-3 text-right font-mono tabular ${(changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                {changePct === undefined ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
