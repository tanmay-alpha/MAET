import { Link } from "@tanstack/react-router";
import { useMemo, type ReactNode } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { useWatchlist } from "@/hooks/use-watchlist";
import type { MarketQuote } from "@/lib/market-api";
import type { MarketCatalogItem } from "@/lib/market-catalog";
import { marketPhaseLabel, NIFTY50_SYMBOLS, rankNiftyMovers } from "./guest-market-movers";

function QuoteRow({ symbol, name, quote }: { symbol: string; name: string; quote?: MarketQuote }) {
  const source = quote?.source === "angelone" ? "Angel One" : quote?.source === "yahoo" ? "Yahoo" : quote?.source;
  return (
    <tr className="border-b border-border/60 text-xs hover:bg-accent/50" title={source ? `Quote source: ${source}` : "Quote unavailable"}>
      <td className="min-w-0 py-2 pr-3">
        <Link to="/stock/$symbol" params={{ symbol }} className="block font-medium hover:text-primary">{symbol}</Link>
        <span className="block max-w-44 truncate text-[10px] text-muted-foreground">{name}</span>
      </td>
      <td className="py-2 pr-3 text-right font-mono tabular-nums">{quote ? `₹${quote.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : "—"}</td>
      <td className={`py-2 text-right font-mono tabular-nums ${quote?.changePct === undefined ? "text-muted-foreground" : quote.changePct >= 0 ? "text-bull" : "text-bear"}`}>
        {quote?.changePct === undefined ? "—" : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`}
      </td>
    </tr>
  );
}

function GuestWatchlistRows({ items }: { items: MarketCatalogItem[] }) {
  const symbols = useMemo(() => items.map((item) => item.symbol), [items]);
  const { quoteMap } = useMarketQuotes(symbols);
  return <tbody>{items.map((item) => <QuoteRow key={item.symbol} symbol={item.symbol} name={item.name} quote={quoteMap.get(item.symbol)} />)}</tbody>;
}

/**
 * Public market workspace (NIFTY 50 movers, device watchlist, research links). Signed-out
 * visitors get it with a sign-in line; a signed-in user whose paper account could not be
 * loaded gets it with that account notice instead, so the page stays useful.
 */
export function GuestMarketDashboard({
  accountNotice = <p role="status" className="mt-2 text-xs text-muted-foreground">Paper account requires sign-in.</p>,
}: {
  accountNotice?: ReactNode;
}) {
  const { quoteMap, marketPhase, delayed, isError, isLoading } = useMarketQuotes(NIFTY50_SYMBOLS);
  const { items } = useWatchlist();
  const { gainers, losers } = useMemo(() => rankNiftyMovers(quoteMap), [quoteMap]);
  // Each quote request stays within the public endpoint's 50-symbol limit, including saved lists.
  const watchlistBatches = useMemo(() => {
    const batches: MarketCatalogItem[][] = [];
    for (let index = 0; index < items.length; index += 50) batches.push(items.slice(index, index + 50));
    return batches;
  }, [items]);
  const sources = [...new Set([...quoteMap.values()].map((quote) => quote.source === "angelone" ? "Angel One" : quote.source === "yahoo" ? "Yahoo" : quote.source))].join(" / ");

  return (
    <div className="h-full overflow-y-auto p-4">
      <header className="border-b border-border pb-3">
        <h1 className="text-xl font-semibold">Paper trading dashboard</h1>
        <p className="mt-1 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
          <span>{marketPhaseLabel(marketPhase)}</span>
          <span aria-hidden="true">·</span>
          <span>{isError ? "Quote service unavailable" : delayed ? "Delayed quotes" : "Live quotes"}</span>
          {sources && <span>· {sources}</span>}
        </p>
        {accountNotice}
        <nav aria-label="Research shortcuts" className="mt-3 flex items-center gap-5 text-xs font-medium text-primary">
          <Link to="/screener" className="hover:underline">Screener</Link>
          <Link to="/chart/$symbol" params={{ symbol: "RELIANCE" }} className="hover:underline">Charts</Link>
          <Link to="/strategies" className="hover:underline">Strategy Lab</Link>
        </nav>
      </header>

      <div className="flex flex-col gap-6 pt-4 lg:flex-row">
        <section aria-labelledby="nifty-movers" className="min-w-0 flex-1">
          <h2 id="nifty-movers" className="mb-3 text-sm font-semibold">NIFTY 50 movers</h2>
          <div className="flex flex-col gap-5 sm:flex-row lg:flex-col xl:flex-row">
            {([{ title: "Top 5 gainers", rows: gainers }, { title: "Top 5 losers", rows: losers }]).map(({ title, rows }) => (
              <section key={title} aria-label={title} className="min-w-0 flex-1">
                <h3 className="border-b border-border pb-2 text-xs font-medium text-muted-foreground">{title}</h3>
                <table className="w-full text-left">
                  <thead className="text-[10px] uppercase text-muted-foreground">
                    <tr><th className="py-2 font-normal">Symbol</th><th className="py-2 pr-3 text-right font-normal">LTP</th><th className="py-2 text-right font-normal">Chg%</th></tr>
                  </thead>
                  <tbody>{rows.map((item) => <QuoteRow key={item.symbol} symbol={item.symbol} name={item.name} quote={item.quote} />)}</tbody>
                </table>
                {rows.length === 0 && <p className="py-4 text-xs text-muted-foreground">{isLoading ? "Loading quotes…" : isError ? "Market quotes are temporarily unavailable." : `No ${title.includes("gainers") ? "gainers" : "losers"} in the available quotes.`}</p>}
              </section>
            ))}
          </div>
        </section>

        <section aria-labelledby="guest-watchlist" className="min-w-0 border-t border-border pt-4 lg:w-80 lg:shrink-0 lg:border-l lg:border-t-0 lg:pl-5 lg:pt-0 xl:w-96">
          <div className="mb-1 flex items-center justify-between gap-3">
            <h2 id="guest-watchlist" className="text-sm font-semibold">Guest watchlist</h2>
            <Link to="/watchlists" className="text-xs text-primary hover:underline">Watchlists</Link>
          </div>
          <p className="mb-3 text-[10px] text-muted-foreground">Saved on this device</p>
          <table className="w-full text-left">
            <thead className="border-b border-border text-[10px] uppercase text-muted-foreground">
              <tr><th className="py-2 font-normal">Symbol</th><th className="py-2 pr-3 text-right font-normal">LTP</th><th className="py-2 text-right font-normal">Chg%</th></tr>
            </thead>
            {watchlistBatches.map((batch, index) => <GuestWatchlistRows key={index} items={batch} />)}
          </table>
          {items.length === 0 && <p className="py-4 text-xs text-muted-foreground">Your guest watchlist is empty. Add symbols in Watchlists.</p>}
        </section>
      </div>
    </div>
  );
}
