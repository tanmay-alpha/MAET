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
      <div className="grid grid-cols-12 border-b border-border px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <div className="col-span-5">Symbol</div>
        <div className="col-span-4 text-right">LTP</div>
        <div className="col-span-3 text-right">Chg%</div>
      </div>

      {/* Watchlist Items List */}
      <div className="flex-1 overflow-y-auto">
        {items.map((item) => {
          const quote = quotes.get(item.symbol);
          const price = quote?.price;
          const changePct = quote?.changePct;
          const source = quote?.source ?? "db";

          return (
            <div
              key={item.symbol}
              className={`group grid w-full grid-cols-12 items-center px-3 py-2 text-xs transition-colors hover:bg-accent ${
                active === item.symbol ? "bg-accent font-semibold" : ""
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  setActiveSymbol(item.symbol);
                  onSelect(item);
                }}
                className="col-span-10 grid grid-cols-10 items-center text-left min-w-0"
              >
                <div className="col-span-6 min-w-0 pr-1">
                  <div className="font-medium truncate flex items-center gap-1">
                    <span>{item.symbol}</span>
                    <span className="text-[8px] uppercase text-muted-foreground opacity-75">{source.slice(0, 3)}</span>
                  </div>
                  <div className="truncate text-[10px] text-muted-foreground">{item.name}</div>
                </div>
                <div className="col-span-4 text-right font-mono tabular-nums text-foreground">
                  {price !== undefined ? `₹${price.toFixed(2)}` : "—"}
                </div>
              </button>

              <div className="col-span-2 flex items-center justify-end">
                <div className={`font-mono tabular-nums group-hover:hidden ${
                  (changePct ?? 0) >= 0 ? "text-bull" : "text-bear"
                }`}>
                  {changePct === undefined ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(1)}%`}
                </div>
                <button
                  type="button"
                  onClick={() => void removeItem(item.symbol)}
                  className="hidden group-hover:flex p-1 text-muted-foreground hover:text-bear rounded"
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
