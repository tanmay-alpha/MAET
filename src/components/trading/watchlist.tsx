import type { MarketQuote } from "@/lib/market-api";
import { type MarketCatalogItem } from "@/lib/market-catalog";
import { CompanySearchInput } from "@/components/market/company-search-input";
import { useTerminalStore } from "@/store/useTerminalStore";
import { useWatchlist } from "@/hooks/use-watchlist";
import { Laptop, Trash2 } from "lucide-react";

export function Watchlist({
  onSelect,
  quotes,
}: {
  onSelect: (company: MarketCatalogItem) => void;
  quotes: Map<string, MarketQuote>;
}) {
  const active = useTerminalStore((state) => state.activeSymbol);
  const setActiveSymbol = useTerminalStore((state) => state.setActiveSymbol);
  const { items, isSavedLocally, addItem, removeItem } = useWatchlist();

  return (
    <div className="flex h-full flex-col bg-panel">
      {/* Search Header */}
      <div className="border-b border-border p-2 space-y-1.5">
        <CompanySearchInput
          placeholder="Search NSE symbol, company..."
          onSelect={(company) => {
            setActiveSymbol(company.symbol);
            void addItem({ symbol: company.symbol, name: company.name });
            onSelect({ symbol: company.symbol, name: company.name });
          }}
        />
        {isSavedLocally && (
          <div className="flex items-center gap-1 text-[10px] text-muted-foreground px-1">
            <Laptop className="h-3 w-3 text-amber-400" />
            <span>Saved on this device</span>
          </div>
        )}
      </div>

      {/* Watchlist Table Header */}
      <div className="flex items-center justify-between border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div>Symbol</div>
        <div>LTP / Chg%</div>
      </div>

      {/* Watchlist Items List */}
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => {
          const quote = quotes.get(item.symbol);
          const price = quote?.price;
          const changePct = quote?.changePct;
          const source = quote?.source === "angelone" ? "Angel One" : quote?.source === "yahoo" ? "Yahoo" : quote?.source;

          return (
            <div
              key={item.symbol}
              title={source ? `Quote source: ${source}` : "Quote unavailable"}
              className={`group flex w-full items-center gap-3 px-3 py-2 text-xs transition-colors hover:bg-accent ${
                active === item.symbol ? "bg-accent font-semibold" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveSymbol(item.symbol);
                  onSelect(item);
                }}
                className="flex min-w-0 flex-1 items-center justify-between gap-2 text-left"
              >
                <div className="min-w-0">
                  <div className="font-medium truncate flex items-center gap-1">
                    <span>{item.symbol}</span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{item.name}</div>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1 font-mono tabular-nums">
                  <span className="text-foreground">{price !== undefined ? `₹${price.toFixed(2)}` : "—"}</span>
                  <span className={(changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}>
                    {changePct === undefined ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`}
                  </span>
                </div>
              </button>

              <div className="flex w-4 shrink-0 items-center justify-end">
                <button
                  type="button"
                  onClick={() => void removeItem(item.symbol)}
                  className="rounded p-1 text-muted-foreground opacity-0 transition-opacity hover:text-bear focus:opacity-100 group-hover:opacity-100"
                  title="Remove from watchlist"
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
