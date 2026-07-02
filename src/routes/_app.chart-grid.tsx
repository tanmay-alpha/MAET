import { createFileRoute, Link } from "@tanstack/react-router";
import { useState } from "react";
import { ExternalLink, Grid2X2, RefreshCw } from "lucide-react";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { MiniCandlestickChart } from "@/components/trading/mini-candlestick-chart";

export const Route = createFileRoute("/_app/chart-grid")({
  head: () => ({ meta: [{ title: "Chart Grid — MAET" }] }),
  component: ChartGrid,
});

const GRID_SYMBOLS = ["RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN"];

function ChartCard({ symbol }: { symbol: string }) {
  const candles = useMarketCandles(symbol, "15m", "5d");
  const latest = candles.data?.candles.at(-1);
  const previous = candles.data?.candles.at(-2);
  const changePct = latest && previous ? ((latest.close - previous.close) / previous.close) * 100 : undefined;

  return (
    <section className="min-w-0 overflow-hidden border border-border bg-background">
      <div className="flex items-center justify-between border-b border-border bg-panel px-3 py-2">
        <div className="flex items-center gap-3">
          <span className="font-mono text-xs font-semibold text-primary">{symbol}</span>
          <span className="font-mono text-[11px] text-muted-foreground">
            {latest?.close.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "—"}
          </span>
          <span className={`font-mono text-[11px] ${(changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
            {changePct === undefined ? "" : `${changePct >= 0 ? "+" : ""}${changePct.toFixed(2)}%`}
          </span>
        </div>
        <Link to="/chart/$symbol" params={{ symbol }} aria-label={`Open ${symbol} chart`} className="text-muted-foreground hover:text-primary">
          <ExternalLink className="h-3.5 w-3.5" />
        </Link>
      </div>
      {candles.isError ? (
        <div className="flex h-[230px] items-center justify-center text-xs text-bear">Chart data unavailable</div>
      ) : (
        <MiniCandlestickChart candles={candles.data?.candles ?? []} height={230} />
      )}
      <div className="flex items-center justify-between border-t border-border bg-panel px-3 py-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
        <span>15m · 5D</span>
        <span className="inline-flex items-center gap-1.5">
          {candles.isFetching && <RefreshCw className="h-3 w-3 animate-spin" />}
          Yahoo delayed
        </span>
      </div>
    </section>
  );
}

function ChartGrid() {
  const [columns, setColumns] = useState<2 | 3>(2);

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
        <div className="flex items-center gap-2">
          <Grid2X2 className="h-4 w-4 text-primary" />
          <span className="font-semibold">Chart grid</span>
          <span className="rounded bg-primary/15 px-1.5 py-0.5 font-mono text-[10px] uppercase text-primary">6 symbols</span>
        </div>
        <div className="flex items-center rounded border border-border bg-background p-0.5 text-xs">
          {[2, 3].map((value) => (
            <button
              key={value}
              type="button"
              onClick={() => setColumns(value as 2 | 3)}
              className={`rounded px-2.5 py-1 ${columns === value ? "bg-accent text-foreground" : "text-muted-foreground"}`}
            >
              {value} columns
            </button>
          ))}
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-2">
        <div className={`grid gap-2 ${columns === 2 ? "xl:grid-cols-2" : "lg:grid-cols-2 2xl:grid-cols-3"}`}>
          {GRID_SYMBOLS.map((symbol) => <ChartCard key={symbol} symbol={symbol} />)}
        </div>
      </div>
    </div>
  );
}
