import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Github, Table2, FlaskConical, CandlestickChart, ArrowRight } from "lucide-react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { fetchMarketQuotes } from "@/lib/market-api";
import { MarketSource, NiftyHeatmap, NIFTY_SYMBOLS } from "@/components/landing/nifty-heatmap";
import { formatChange, quoteTime, sourceName } from "@/components/landing/market-presentation";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "MAET — Indian equity research & paper trading" },
      { name: "description", content: "Research Indian equities with public market quotes, charts, a stock screener and a paper-trading workspace. No real-money orders." },
      { property: "og:title", content: "MAET — Indian equity research & paper trading" },
      { property: "og:description", content: "Market research, charts and paper trading for Indian equities." },
    ],
  }),
  component: Landing,
});

const INDEX_SYMBOLS = ["NIFTY50", "BANKNIFTY", "SENSEX", "NIFTYIT", "NIFTYFMCG", "INDIAVIX"];
const INDEX_NAMES = ["NIFTY 50", "NIFTY BANK", "SENSEX", "NIFTY IT", "NIFTY FMCG", "INDIA VIX"];
const WATCH_SYMBOLS = ["RELIANCE", "HDFCBANK", "INFY", "TCS", "ICICIBANK", "BHARTIARTL"];
const SOURCE_URL = "https://github.com/tanmay-alpha/MAET";
const primaryLink = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded bg-primary px-4 py-2.5 text-sm font-medium text-primary-foreground hover:brightness-110 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-primary";

function Landing() {
  const indices = useMarketQuotes(INDEX_SYMBOLS);
  // Keep the public constituent snapshot within the endpoint's 50-symbol limit.
  // Polling avoids exceeding the shared stream's symbol cap alongside the indices.
  const constituents = useQuery({
    queryKey: ["landing-nifty50-quotes"],
    queryFn: ({ signal }) => fetchMarketQuotes(NIFTY_SYMBOLS, signal),
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });
  const quotes = new Map(constituents.data?.quotes.map((quote) => [quote.symbol, quote]));

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="sticky top-0 z-50 border-b border-border bg-background">
        <div className="mx-auto flex h-14 max-w-7xl items-center gap-4 px-4 sm:px-6">
          <Link to="/" aria-label="MAET home" className="flex shrink-0 items-center gap-2.5">
            <CandlestickChart aria-hidden="true" className="h-6 w-6 text-primary" />
            <span className="text-base font-semibold tracking-[0.16em]">MAET</span>
          </Link>
          <nav aria-label="Landing navigation" className="ml-8 hidden items-center gap-6 text-xs text-muted-foreground md:flex">
            <a href="#scanner" className="hover:text-foreground">Markets</a>
            <a href="#heatmap" className="hover:text-foreground">Heatmap</a>
            <a href="#paper" className="hover:text-foreground">Paper trading</a>
            <a href="#lab" className="hover:text-foreground">Strategy lab</a>
          </nav>
          <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="ml-auto hidden items-center gap-2 text-xs text-muted-foreground hover:text-foreground sm:flex"><Github className="h-4 w-4" /> Source</a>
          <Link to="/terminal" className={`${primaryLink} ml-auto px-3 py-2 text-xs sm:ml-0`}>
            <span className="sm:hidden">Terminal</span><span className="hidden sm:inline">Open terminal</span><ArrowUpRight aria-hidden="true" className="h-3.5 w-3.5" />
          </Link>
        </div>
      </header>

      <main>
        <section className="border-b border-border">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 py-12 sm:px-6 sm:py-16 lg:grid-cols-[1.1fr_1fr] lg:gap-16 lg:py-20">
            <div>
              <p className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Indian equity research · Paper execution</p>
              <h1 className="mt-5 max-w-xl font-serif text-[clamp(2.9rem,5.5vw,5rem)] leading-[1.04] tracking-tight">A workspace for studying the market.</h1>
              <p className="mt-5 max-w-lg text-sm leading-7 text-muted-foreground sm:text-base">Screen Indian equities, inspect price charts and test trades in a paper account. Research and execution practice, without real-money orders.</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <Link to="/terminal" className={primaryLink}>Open terminal <ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
                <Link to="/screener" className="inline-flex items-center gap-2 rounded border border-border px-4 py-2.5 text-sm font-medium hover:bg-panel"><Table2 aria-hidden="true" className="h-4 w-4" /> Explore screener</Link>
              </div>
              <p className="mt-5 text-xs text-muted-foreground">Public market research. Sign-in required for saved paper trades.</p>
            </div>

            <div className="min-w-0 border border-border bg-panel">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <h2 className="text-sm font-medium">Market watch</h2>
                <span className="text-[10px] uppercase tracking-widest text-muted-foreground">NSE equities</span>
              </div>
              <table className="w-full text-left text-xs" aria-label="Latest public equity quotes">
                <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <tr><th className="px-4 py-3 font-normal">Symbol</th><th className="px-2 py-3 text-right font-normal">Price · ₹</th><th className="px-4 py-3 text-right font-normal">Change</th></tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {WATCH_SYMBOLS.map((symbol) => {
                    const quote = quotes.get(symbol);
                    return <tr key={symbol} title={quote ? `${sourceName(quote.source)} · ${quote.quality} · ${quoteTime(quote.ts)} IST` : "Quote unavailable"}>
                      <th className="px-4 py-3 font-medium"><Link to="/stock/$symbol" params={{ symbol }} className="hover:text-primary">{symbol}</Link></th>
                      <td className="px-2 py-3 text-right font-mono tabular-nums">{quote?.price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }) ?? "—"}</td>
                      <td className={`px-4 py-3 text-right font-mono tabular-nums ${quote?.changePct === undefined || quote.changePct === 0 ? "text-muted-foreground" : quote.changePct > 0 ? "text-bull" : "text-bear"}`}>{formatChange(quote?.changePct)}</td>
                    </tr>;
                  })}
                </tbody>
              </table>
              <div className="border-t border-border px-4 py-3"><MarketSource data={constituents.data} isError={constituents.isError} /></div>
            </div>
          </div>
        </section>

        <section id="scanner" className="scroll-mt-20 border-b border-border">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
            <div className="mb-4 flex flex-wrap items-end justify-between gap-3"><h2 className="text-sm font-medium">Indices &amp; sectors</h2><MarketSource data={indices.data} isError={indices.isError} /></div>
            <div className="grid grid-cols-2 gap-px border border-border bg-border md:grid-cols-3 lg:grid-cols-6">
              {INDEX_SYMBOLS.map((symbol, index) => {
                const quote = indices.quoteMap.get(symbol);
                return <div key={symbol} className="bg-background px-4 py-4" data-testid="landing-index">
                  <h3 className="text-[10px] tracking-widest text-muted-foreground">{INDEX_NAMES[index]}</h3>
                  <p className="mt-2 font-mono text-lg tabular-nums">{quote?.price.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}</p>
                  <p className={`mt-1 font-mono text-xs tabular-nums ${quote?.changePct === undefined || quote.changePct === 0 ? "text-muted-foreground" : quote.changePct > 0 ? "text-bull" : "text-bear"}`}>{formatChange(quote?.changePct)}</p>
                </div>;
              })}
            </div>
          </div>
        </section>

        <section id="heatmap" className="scroll-mt-20 border-b border-border">
          <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6 sm:py-16">
            <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
              <div><p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Market overview</p><h2 className="mt-2 font-serif text-4xl sm:text-5xl">NIFTY 50 heatmap</h2></div>
              <p className="max-w-sm text-sm leading-6 text-muted-foreground">Constituent price changes, not index weights. Missing quotes stay uncoloured.</p>
            </div>
            <NiftyHeatmap data={constituents.data} isError={constituents.isError} isPending={constituents.isPending} />
          </div>
        </section>

        <section className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:px-6 sm:py-16 md:grid-cols-2 md:gap-16">
          <div id="paper" className="scroll-mt-20">
            <CandlestickChart aria-hidden="true" className="h-5 w-5 text-primary" />
            <h2 className="mt-4 font-serif text-4xl">Paper trading</h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">Place market, limit and stop orders in a simulated account. Review positions, fills and P&amp;L in the terminal. No orders are routed to a broker.</p>
            <ul className="mt-5 space-y-2 border-l border-border pl-4 text-sm text-muted-foreground"><li>Market-quote-based paper fills</li><li>Account order and position history</li><li>Sign-in required to save trades</li></ul>
            <Link to="/terminal" className="mt-6 inline-flex items-center gap-2 text-sm hover:text-primary">View paper terminal <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
          </div>
          <div id="lab" className="scroll-mt-20 border-t border-border pt-8 md:border-t-0 md:border-l md:pt-0 md:pl-12">
            <FlaskConical aria-hidden="true" className="h-5 w-5 text-primary" />
            <h2 className="mt-4 font-serif text-4xl">Strategy lab</h2>
            <p className="mt-4 max-w-lg text-sm leading-7 text-muted-foreground">Define entry and exit rules, run a historical backtest and inspect the results. Compare an idea against past price data before using it in a paper account.</p>
            <ul className="mt-5 space-y-2 border-l border-border pl-4 text-sm text-muted-foreground"><li>Rule-based strategy editor</li><li>Historical candle backtests</li><li>Trade-by-trade results and equity curves</li></ul>
            <Link to="/strategies" className="mt-6 inline-flex items-center gap-2 text-sm hover:text-primary">Explore strategy lab <ArrowRight aria-hidden="true" className="h-4 w-4" /></Link>
          </div>
        </section>

        <section className="border-y border-border bg-panel">
          <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
            <h2 className="mb-5 text-xs uppercase tracking-[0.18em] text-muted-foreground">Market coverage</h2>
            <div className="grid gap-5 sm:grid-cols-3 sm:gap-8">
              {[['NSE equities', 'Public quotes, price charts and stock research.'], ['NSE indices', 'Broad-market and sector index quotes.'], ['SENSEX', 'BSE benchmark index quote.']].map(([title, description]) => <div key={title}><h3 className="text-sm font-medium">{title}</h3><p className="mt-1 text-xs leading-6 text-muted-foreground">{description}</p></div>)}
            </div>
          </div>
        </section>

        <section className="mx-auto flex max-w-7xl flex-col items-start justify-between gap-6 px-4 py-12 sm:px-6 sm:py-16 md:flex-row md:items-center">
          <div><h2 className="font-serif text-4xl">Start with a stock.</h2><p className="mt-3 text-sm text-muted-foreground">Open the screener to find a symbol, then inspect its chart.</p></div>
          <Link to="/screener" className={primaryLink}>Explore screener <ArrowUpRight aria-hidden="true" className="h-4 w-4" /></Link>
        </section>
      </main>

      <footer className="border-t border-border">
        <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6">
          <div className="flex flex-wrap items-center justify-between gap-5">
            <span className="text-sm font-semibold tracking-[0.16em]">MAET</span>
            <nav aria-label="Footer" className="flex flex-wrap gap-5 text-xs text-muted-foreground">
              <a href={`${SOURCE_URL}/blob/main/docs/ARCHITECTURE.md`} target="_blank" rel="noreferrer" className="hover:text-foreground">Docs</a>
              <Link to="/admin/data-quality" className="hover:text-foreground">Data Status</Link>
              <a href={SOURCE_URL} target="_blank" rel="noreferrer" className="hover:text-foreground">Source on GitHub</a>
            </nav>
          </div>
          <p className="mt-5 max-w-3xl text-xs leading-6 text-muted-foreground">Data sources: quotes may come from Angel One or Yahoo Finance; historical candles use Yahoo Finance. Source, quality and exchange timestamps are shown with the quotes. Availability and delays vary by provider and market session.</p>
          <p className="mt-2 text-xs leading-6 text-muted-foreground">Research and education only. Not a broker, investment adviser or SEBI-registered intermediary. No real-money trading.</p>
        </div>
      </footer>
    </div>
  );
}
