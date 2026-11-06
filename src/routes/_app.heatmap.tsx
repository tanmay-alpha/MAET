import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { fetchMarketQuotes } from "@/lib/market-api";
import { useSignedIn } from "@/hooks/use-signed-in";
import { MarketHeatmap, useHeatmapCells } from "@/components/trading/market-heatmap";
import { BreadthGauge, useBreadthOverview } from "@/components/trading/breadth-gauge";
import { NiftyHeatmap, NIFTY_SYMBOLS } from "@/components/landing/nifty-heatmap";

export const Route = createFileRoute("/_app/heatmap")({
  head: () => ({ meta: [{ title: "Heatmap — MAET" }] }),
  component: Heatmap,
});

function Heatmap() {
  const signedIn = useSignedIn();
  const heatmap = useHeatmapCells(signedIn);
  const { data: overview } = useBreadthOverview(signedIn);
  const cells = heatmap.data?.available ? heatmap.data.cells : [];
  const verified = cells.length > 0;
  // Without the all-NSE cells (signed out, or the database behind them is down) the page
  // falls back to the public NIFTY 50 quotes the landing page uses.
  const fallback = !signedIn || heatmap.isError || (heatmap.isSuccess && !verified);
  const nifty = useQuery({
    queryKey: ["landing-nifty50-quotes"],
    queryFn: ({ signal }) => fetchMarketQuotes(NIFTY_SYMBOLS, signal),
    enabled: fallback,
    staleTime: 10_000,
    refetchInterval: 15_000,
    refetchIntervalInBackground: false,
    retry: 2,
  });
  const fallbackReason = !signedIn
    ? "The all-NSE heatmap and breadth need a signed-in account"
    : heatmap.data?.reason ?? "The all-NSE heatmap is unavailable";
  const asOf = verified ? heatmap.data?.asOf : undefined;
  const breadth = overview?.available ? overview : undefined;

  return (
    <div className="flex h-full min-h-0 flex-col overflow-auto">
      <header className="border-b border-border px-4 py-2.5 sm:px-5">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg font-semibold">Market heatmap</h1>
          <span className="text-xs text-muted-foreground">
            {verified ? `All NSE · ${cells.length.toLocaleString("en-IN")} stocks · tile area by market cap` : "NIFTY 50 · equal tiles"}
          </span>
          {asOf && (
            <span className="font-mono text-[11px] text-muted-foreground">
              as of {new Date(asOf).toLocaleString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit", hour12: false })}
            </span>
          )}
        </div>
        {fallback && <p className="mt-1 text-[11px] text-muted-foreground">{fallbackReason}; showing NIFTY 50 from public quotes.</p>}
      </header>

      <div className="p-3 sm:p-4">
        {fallback ? (
          <NiftyHeatmap data={nifty.data} isError={nifty.isError} isPending={nifty.isPending} />
        ) : !verified ? (
          <p className="text-xs text-muted-foreground">Loading heatmap…</p>
        ) : (
          <div className={`grid gap-3 ${breadth ? "lg:grid-cols-[1fr_18rem]" : ""}`}>
            <div className="border border-border bg-panel">
              <div className="flex items-center justify-end gap-1 px-2 py-1.5 font-mono text-[11px] text-muted-foreground" aria-label="Colour scale from minus three percent to plus three percent">
                <span>−3%</span>
                <span className="h-2 w-3 bg-bear" />
                <span className="h-2 w-3 bg-bear/40" />
                <span className="h-2 w-3 bg-bull/40" />
                <span className="h-2 w-3 bg-bull" />
                <span>+3%</span>
              </div>
              <MarketHeatmap cells={cells} height={520} />
            </div>
            {breadth && <BreadthGauge data={breadth} />}
          </div>
        )}
      </div>
    </div>
  );
}
