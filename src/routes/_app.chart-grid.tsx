import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { Maximize2, Grid3x3 } from "lucide-react";
import { LiveMiniChart } from "@/components/trading/live-mini-chart";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { CONTRACT_PANEL } from "@/components/common/contract-panel";

export const Route = createFileRoute("/_app/chart-grid")({
  head: () => ({ meta: [{ title: "Chart Grid — MAET" }] }),
  component: ChartGrid,
});

const GRID_SYMBOLS = ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK", "SBIN"];

function ChartCard({ symbol }: { symbol: string }) {
  const candles = useMarketCandles(symbol, "15m", "5d");
  const chartCloses = (candles.data?.candles ?? []).map((candle) => candle.close).slice(-60);

  return (
    <div className="group relative overflow-hidden rounded-lg border border-border bg-panel transition hover:border-primary/40">
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <Link to={`/chart/${symbol}` as any} className="font-semibold text-sm hover:text-primary">
          {symbol}
        </Link>
        <button type="button" aria-label="Maximize" className="rounded p-1 text-muted-foreground hover:bg-accent hover:text-foreground" title="Maximize chart">
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="aspect-[16/9] p-2">
        <LiveMiniChart data={chartCloses} height={120} />
      </div>
      <div className="flex items-center justify-between border-t border-border px-3 py-2 text-xs">
        <span className="text-muted-foreground">15m · 5D</span>
        <span className="flex items-center gap-1">
          <span className="h-1.5 w-1.5 rounded-full bg-bull animate-pulse" />
          Live
        </span>
      </div>
    </div>
  );
}

function ChartGrid() {
  const [layout, setLayout] = useState<"2x3" | "3x2">("2x3");

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-border px-5 py-3">
        <div className="flex items-center gap-3">
          <Grid3x3 className="h-5 w-5 text-primary" />
          <h1 className="text-lg font-semibold">Chart Grid</h1>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLayout("2x3")}
            className={`rounded px-3 py-1.5 text-xs ${layout === "2x3" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="2 by 3 grid layout"
          >
            2×3
          </button>
          <button
            type="button"
            onClick={() => setLayout("3x2")}
            className={`rounded px-3 py-1.5 text-xs ${layout === "3x2" ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`}
            aria-label="3 by 2 grid layout"
          >
            3×2
          </button>
        </div>
      </div>

      {/* Grid */}
      <div className="flex-1 overflow-auto p-4">
        <div
          className={`grid gap-4 ${
            layout === "2x3"
              ? "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
              : "grid-cols-1 md:grid-cols-2 lg:grid-cols-3"
          }`}
        >
          {GRID_SYMBOLS.map((s) => (
            <ChartCard key={s} symbol={s} />
          ))}
        </div>
      </div>

      {/* Bottom panel */}
      <div className="border-t border-border bg-panel p-3 text-center text-xs text-muted-foreground">
        <CONTRACT_PANEL message="Multi-chart layout — all charts use real market data from Yahoo Finance" />
      </div>
    </div>
  );
}
