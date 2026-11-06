import { Link } from "@tanstack/react-router";
import nifty50 from "@shared/symbols/nifty50.json";
import type { MarketQuotesResponse } from "@/lib/market-api";
import { formatChange, heatmapTone, marketSummary, quoteRange, quoteTime, sourceName } from "./market-presentation";

export const NIFTY_SYMBOLS = nifty50.map((company) => company.symbol);

export function MarketSource({ data, isError }: { data?: MarketQuotesResponse; isError: boolean }) {
  if (!data) return <p className="text-xs text-muted-foreground" role="status">{isError ? "Quotes unavailable. Try again shortly." : "Loading market quotes…"}</p>;
  return (
    <div className="text-xs leading-relaxed text-muted-foreground" data-testid="market-source">
      <p>{marketSummary(data)}{isError ? " · Refresh failed; showing last response" : ""}</p>
      <p>Quote times: {quoteRange(data.quotes) ?? "No quotes returned"}</p>
    </div>
  );
}

export function NiftyHeatmap({ data, isError, isPending }: { data?: MarketQuotesResponse; isError: boolean; isPending: boolean }) {
  const quoteMap = new Map(data?.quotes.map((quote) => [quote.symbol, quote]));
  const available = nifty50.filter((company) => quoteMap.get(company.symbol)?.changePct !== undefined).length;
  return (
    <div className="border border-border bg-panel p-2 sm:p-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-2 pb-4">
        <MarketSource data={data} isError={isError} />
        <span className="font-mono text-[11px] text-muted-foreground">{available}/{nifty50.length} changes available</span>
      </div>
      <div className="grid grid-cols-5 gap-1 lg:grid-cols-10" aria-label="NIFTY 50 constituent price changes" aria-busy={isPending}>
        {nifty50.map((company) => {
          const quote = quoteMap.get(company.symbol);
          const description = quote
            ? `${company.name} · ₹${quote.price.toLocaleString("en-IN")} · ${sourceName(quote.source)} · ${quote.quality} · ${quoteTime(quote.ts)} IST`
            : `${company.name} · Quote unavailable`;
          return (
            <Link key={company.symbol} to="/stock/$symbol" params={{ symbol: company.symbol }}
              title={description} data-testid="heatmap-tile"
              className={`flex min-h-11 min-w-0 flex-col items-center justify-center gap-0.5 px-1 py-1 text-center outline-offset-2 transition hover:brightness-125 focus-visible:outline-2 focus-visible:outline-foreground sm:min-h-20 sm:gap-1 sm:py-3 ${heatmapTone(quote?.changePct)}`}>
              <span className="max-w-full truncate text-[10px] font-semibold tracking-tight sm:text-[11px]">{company.symbol}</span>
              <span className="font-mono text-[10px] tabular-nums sm:text-xs">{formatChange(quote?.changePct)}</span>
              {!quote && <span className="sr-only text-[9px] sm:not-sr-only">{isPending ? "Loading" : "Unavailable"}</span>}
            </Link>
          );
        })}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3 px-2 pt-3 pb-1 text-[11px] text-muted-foreground">
        <span>Equal-size tiles · change from previous close · select a stock to chart</span>
        <span className="flex items-center gap-1 font-mono" aria-label="Colour scale from minus two percent or lower to plus two percent or higher">
          <span>−2% or less</span><i className="h-2 w-3 bg-[#9f3540]" /><i className="h-2 w-3 bg-[#70313c]" /><i className="h-2 w-3 bg-panel-elevated" /><i className="h-2 w-3 bg-[#235c50]" /><i className="h-2 w-3 bg-[#287b66]" /><span>+2% or more</span>
        </span>
      </div>
    </div>
  );
}
