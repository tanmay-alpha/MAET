import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { trpc } from "@/lib/trpc";
import { MarketHeatmap } from "@/components/trading/market-heatmap";
import { BreadthGauge } from "@/components/trading/breadth-gauge";
import { CONTRACT_PANEL } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/heatmap")({
  head: () => ({ meta: [{ title: "Heatmap — MAET" }] }),
  component: Heatmap,
});

function Heatmap() {
  const { data: overview } = useQuery({
    queryKey: ["marketBreadth", "overview", "ALL_NSE"],
    queryFn: () => trpc.marketBreadth.getOverview.query({ universe: "ALL_NSE" }),
    refetchInterval: 30_000,
  });

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">NSE Verified Market Heatmap</h1>
            <p className="text-sm text-muted-foreground">
              Universe: ALL_NSE — weighted by verified market capitalization
            </p>
          </div>
          <div className="flex items-center gap-2 text-xs">
            <span className="rounded bg-primary/15 px-2.5 py-1 font-mono text-[11px] uppercase text-primary">
              ALL_NSE Verified
            </span>
            {overview?.asOf && (
              <span className="font-mono text-[11px] text-muted-foreground hidden sm:inline">
                As of: {new Date(overview.asOf).toLocaleDateString("en-IN", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {/* Main heatmap */}
          <div className="rounded-xl border border-border bg-panel p-3">
            <div className="mb-2 flex items-center justify-between px-1 text-xs uppercase tracking-wider text-muted-foreground">
              <span>ALL_NSE · Proportional to Market Cap</span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-bear/80" /> -3%
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-bull/80" /> +3%
                </span>
              </span>
            </div>
            <MarketHeatmap height={520} />
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <BreadthGauge />

            <div className="rounded-lg border border-border bg-panel p-4">
              <div className="text-sm font-medium mb-3">Heatmap Legend</div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bull" />
                  <span>Strong advance (&gt; +3%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bull/50" />
                  <span>Moderate advance (0% to +3%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bear/50" />
                  <span>Moderate decline (0% to -3%)</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bear" />
                  <span>Strong decline (&lt; -3%)</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <CONTRACT_PANEL message="Verified NSE market breadth & heatmap — cell area proportional to verified market capitalization" />
      </div>
    </div>
  );
}
