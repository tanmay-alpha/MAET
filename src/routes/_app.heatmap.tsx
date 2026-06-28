import { createFileRoute } from "@tanstack/react-router";
import { MarketHeatmap } from "@/components/trading/market-heatmap";
import { BreadthGauge } from "@/components/trading/breadth-gauge";
import { Loadable, ChartSkeleton, Skel } from "@/components/trading/skeleton";
import { CONTRACT_PANEL } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/heatmap")({
  head: () => ({ meta: [{ title: "Heatmap — MAET" }] }),
  component: Heatmap,
});

function Heatmap() {
  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="border-b border-border px-5 py-3">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-lg font-semibold">Market Heatmap</h1>
            <p className="text-sm text-muted-foreground">NIFTY 50 — weighted by market cap</p>
          </div>
          <div className="flex gap-1 text-xs">
            <button className="rounded px-2.5 py-1 bg-accent text-foreground">NIFTY 50</button>
            <button className="rounded px-2.5 py-1 text-muted-foreground hover:text-foreground">BANK NIFTY</button>
            <button className="rounded px-2.5 py-1 text-muted-foreground hover:text-foreground">NSE 200</button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto p-4">
        <div className="grid gap-4 lg:grid-cols-[1.6fr_1fr]">
          {/* Main heatmap */}
          <div className="rounded-xl border border-border bg-panel p-3">
            <div className="mb-2 flex items-center justify-between px-1 text-xs uppercase tracking-wider text-muted-foreground">
              <span>NIFTY 50 · weighted by market cap</span>
              <span className="flex items-center gap-2">
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-bear/80" /> -3%
                </span>
                <span className="flex items-center gap-1">
                  <span className="h-2 w-3 rounded-sm bg-bull/80" /> +3%
                </span>
              </span>
            </div>
            <Loadable delay={700} skeleton={<ChartSkeleton height={500} />}>
              <MarketHeatmap height={500} />
            </Loadable>
          </div>

          {/* Side panel */}
          <div className="space-y-4">
            <Loadable
              delay={900}
              skeleton={
                <div className="rounded-lg border border-border bg-panel p-5 space-y-3">
                  <Skel w={140} h={10} />
                  <Skel w="100%" h={120} />
                  <Skel w="100%" h={6} />
                  <div className="flex justify-between">
                    <Skel w={50} h={10} />
                    <Skel w={50} h={10} />
                  </div>
                </div>
              }
            >
              <BreadthGauge />
            </Loadable>

            <div className="rounded-lg border border-border bg-panel p-4">
              <div className="text-sm font-medium mb-3">Heatmap Legend</div>
              <div className="space-y-2 text-xs text-muted-foreground">
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bull" />
                  <span>Strong positive performance</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bull/50" />
                  <span>Moderate positive</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bear/50" />
                  <span>Moderate negative</span>
                </div>
                <div className="flex items-center gap-2">
                  <div className="h-4 w-8 rounded bg-bear" />
                  <span>Strong negative</span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <CONTRACT_PANEL message="Market heatmap uses delayed Yahoo Finance quotes — box size proportional to market cap" />
      </div>
    </div>
  );
}
