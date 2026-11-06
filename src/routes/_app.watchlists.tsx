import { createFileRoute, Link } from "@tanstack/react-router";
import { useMemo } from "react";
import { X } from "lucide-react";
import { WatchlistPanel } from "@/components/workspace/watchlist-panel";
import { CompanySearchInput } from "@/components/market/company-search-input";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { useSignedIn } from "@/hooks/use-signed-in";
import { useWatchlist } from "@/hooks/use-watchlist";
import { sourceName } from "@/lib/quote-source";
import type { MarketCatalogItem } from "@/lib/market-catalog";

export const Route = createFileRoute("/_app/watchlists")({
  head: () => ({ meta: [{ title: "Watchlists — MAET" }] }),
  component: WatchlistsPage,
});

function GuestRows({ items, onRemove }: { items: MarketCatalogItem[]; onRemove: (symbol: string) => void }) {
  const symbols = useMemo(() => items.map((item) => item.symbol), [items]);
  const { quoteMap } = useMarketQuotes(symbols);

  return (
    <tbody>
      {items.map((item) => {
        const quote = quoteMap.get(item.symbol);
        const change = quote?.changePct;
        return (
          <tr
            key={item.symbol}
            className="border-b border-border/60 last:border-0 hover:bg-accent/30"
            title={quote ? `Quote source: ${sourceName(quote.source)}` : "Quote unavailable"}
          >
            <td className="min-w-0 py-2 pl-3 pr-2">
              <Link to="/stock/$symbol" params={{ symbol: item.symbol }} className="block font-medium hover:text-primary">
                {item.symbol}
              </Link>
              <span className="block max-w-[11rem] truncate text-[10px] text-muted-foreground sm:max-w-xs">{item.name}</span>
            </td>
            <td className="py-2 pr-3 text-right font-mono tabular-nums">
              {quote ? `₹${quote.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}
            </td>
            <td className={`py-2 pr-2 text-right font-mono tabular-nums ${change === undefined ? "text-muted-foreground" : change >= 0 ? "text-bull" : "text-bear"}`}>
              {change === undefined ? "—" : `${change >= 0 ? "+" : ""}${change.toFixed(2)}%`}
            </td>
            <td className="w-8 py-2 pr-2 text-right">
              <button
                type="button"
                onClick={() => onRemove(item.symbol)}
                aria-label={`Remove ${item.symbol}`}
                className="rounded p-1 text-muted-foreground hover:text-bear"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </td>
          </tr>
        );
      })}
    </tbody>
  );
}

/** The browser-stored list signed-out visitors keep (the same one the dashboard shows). */
function GuestWatchlist() {
  const { items, addItem, removeItem } = useWatchlist();
  // The public quotes endpoint takes at most 50 symbols per request.
  const batches = useMemo(() => {
    const result: MarketCatalogItem[][] = [];
    for (let index = 0; index < items.length; index += 50) result.push(items.slice(index, index + 50));
    return result;
  }, [items]);

  return (
    <section aria-labelledby="guest-watchlist" className="rounded border border-border bg-panel">
      <div className="flex flex-wrap items-baseline gap-x-2 border-b border-border px-3 py-2">
        <h2 id="guest-watchlist" className="text-sm font-semibold">
          Guest watchlist
        </h2>
        <span className="text-[11px] text-muted-foreground">Saved in this browser · {items.length} symbols</span>
      </div>
      <div className="border-b border-border p-2">
        <CompanySearchInput placeholder="Add a symbol or company" onSelect={(company) => void addItem({ symbol: company.symbol, name: company.name })} />
      </div>
      {items.length === 0 ? (
        <p className="px-3 py-4 text-xs text-muted-foreground">The guest watchlist is empty.</p>
      ) : (
        <table className="w-full text-left text-xs">
          <thead className="border-b border-border text-[10px] uppercase text-muted-foreground">
            <tr>
              <th className="py-2 pl-3 font-normal">Symbol</th>
              <th className="py-2 pr-3 text-right font-normal">LTP</th>
              <th className="py-2 pr-2 text-right font-normal">Chg%</th>
              <th className="py-2 pr-2">
                <span className="sr-only">Remove</span>
              </th>
            </tr>
          </thead>
          {batches.map((batch, index) => (
            <GuestRows key={index} items={batch} onRemove={(symbol) => void removeItem(symbol)} />
          ))}
        </table>
      )}
    </section>
  );
}

function WatchlistsPage() {
  const signedIn = useSignedIn();

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="border-b border-border px-4 py-3 sm:px-5">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Watchlists</h1>
      </header>
      <div className="mx-auto w-full max-w-5xl space-y-3 p-4 sm:p-5">
        {signedIn ? (
          <WatchlistPanel />
        ) : (
          <>
            <SignedOutNotice feature="Named watchlists" />
            <GuestWatchlist />
          </>
        )}
      </div>
    </div>
  );
}
