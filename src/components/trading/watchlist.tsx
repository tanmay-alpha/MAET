import type { MarketQuote } from "@/lib/market-api";
import { WATCHLIST, type MarketCatalogItem } from "@/lib/market-catalog";
import { CompanySearchInput } from "@/components/market/company-search-input";

export function Watchlist({
  active,
  onSelect,
  quotes,
}: {
  active: string;
  onSelect: (company: MarketCatalogItem) => void;
  quotes: Map<string, MarketQuote>;
}) {
  return (
    <div className="flex h-full flex-col bg-panel">
      <div className="border-b border-border p-2">
        <CompanySearchInput
          placeholder="Search NSE symbol, company, or ISIN"
          onSelect={(company) => onSelect({ symbol: company.symbol, name: company.name })}
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
              onClick={() => onSelect(item)}
              className={`grid w-full grid-cols-12 items-center px-3 py-2 text-xs transition-colors hover:bg-accent ${active === item.symbol ? "bg-accent" : ""}`}
            >
              <div className="col-span-5 text-left">
                <div className="font-medium">{item.symbol}</div>
                <div className="truncate text-[10px] text-muted-foreground">{item.name}</div>
              </div>
              <div className="col-span-4 text-right font-mono tabular tabular-nums">{price?.toFixed(2) ?? "—"}</div>
              <div className={`col-span-3 text-right font-mono tabular tabular-nums ${(changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                {changePct === undefined ? "—" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
