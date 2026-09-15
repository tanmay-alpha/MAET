import React, { useId } from "react";
import { TrendingUp, TrendingDown, Layers, DollarSign, PieChart, ShieldAlert, CheckCircle2 } from "lucide-react";
import type { PortfolioBacktestResult } from "../../../server/domain/strategy/portfolio-engine";

interface Props {
  result: PortfolioBacktestResult;
}

export function PortfolioAnalyticsView({ result }: Props) {
  const gradientId = useId().replace(/:/g, "");
  const equityPoints = result.equityCurve ?? [];
  const minEquity = Math.min(...equityPoints.map((p) => p.equity), result.initialCapital);
  const maxEquity = Math.max(...equityPoints.map((p) => p.equity), result.initialCapital);
  const spread = maxEquity - minEquity || 1;

  const pointsStr = equityPoints
    .map((p, idx) => `${(idx / (equityPoints.length - 1)) * 100},${100 - ((p.equity - minEquity) / spread) * 100}`)
    .join(" ");

  const isProfitable = result.finalEquity >= result.initialCapital;
  const strokeColor = isProfitable ? "var(--color-bull)" : "var(--color-bear)";

  const topSymbols = Object.entries(result.attribution?.pnlBySymbol ?? {})
    .map(([symbol, data]) => ({ symbol, ...data }))
    .sort((a, b) => b.netPnl - a.netPnl);

  const topContributors = topSymbols.slice(0, 5);
  const bottomContributors = [...topSymbols].reverse().slice(0, 5);

  const sectorAllocations = Object.entries(result.attribution?.pnlBySector ?? {}).map(([sector, data]) => ({
    sector,
    ...data,
  }));

  const monthlyReturns = Object.entries(result.attribution?.pnlByMonth ?? {}).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      {/* Top Headline Cards */}
      <div className="grid gap-3 grid-cols-2 md:grid-cols-4 lg:grid-cols-6">
        <div className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Final Equity</span>
          <p className="mt-1 text-base font-bold font-mono">₹{result.finalEquity.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</p>
          <span className={`text-xs font-semibold ${isProfitable ? "text-bull" : "text-bear"}`}>
            {(result.totalReturn * 100).toFixed(2)}% Return
          </span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">CAGR / Volatility</span>
          <p className="mt-1 text-base font-bold font-mono">{(result.cagr * 100).toFixed(1)}%</p>
          <span className="text-xs text-muted-foreground">Sharpe: {result.sharpe.toFixed(2)}</span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Max Drawdown</span>
          <p className="mt-1 text-base font-bold font-mono text-bear">{(result.maxDrawdown * 100).toFixed(2)}%</p>
          <span className="text-xs text-muted-foreground">Calmar: {result.calmar.toFixed(2)}</span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Win Rate</span>
          <p className="mt-1 text-base font-bold font-mono">{(result.winRate * 100).toFixed(1)}%</p>
          <span className="text-xs text-muted-foreground">Profit Factor: {result.profitFactor.toFixed(2)}</span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Avg Exposure</span>
          <p className="mt-1 text-base font-bold font-mono">{result.exposure.toFixed(1)}%</p>
          <span className="text-xs text-muted-foreground">Turnover: ₹{result.turnover.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</span>
        </div>

        <div className="rounded-lg border border-border bg-panel p-3">
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Cost Drag</span>
          <p className="mt-1 text-base font-bold font-mono">{result.costDragPercent.toFixed(2)}%</p>
          <span className="text-xs text-muted-foreground">Costs: ₹{result.totalTransactionCosts.toFixed(0)}</span>
        </div>
      </div>

      {/* Equity & Drawdown Curves */}
      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-border bg-panel p-4">
          <div className="flex items-center justify-between pb-3 border-b border-border">
            <div className="flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Shared Capital Portfolio Equity Curve</span>
            </div>
            <span className="text-xs text-muted-foreground">{equityPoints.length} Daily MTM Points</span>
          </div>

          <div className="h-72 mt-3 w-full">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              <defs>
                <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
                  <stop offset="0%" stopColor={strokeColor} stopOpacity="0.35" />
                  <stop offset="100%" stopColor={strokeColor} stopOpacity="0" />
                </linearGradient>
              </defs>
              <polyline points={`0,100 ${pointsStr} 100,100`} fill={`url(#${gradientId})`} stroke="none" />
              <polyline points={pointsStr} fill="none" stroke={strokeColor} strokeWidth="0.8" />
            </svg>
          </div>
        </div>

        {/* Transaction Cost Reporting */}
        <div className="rounded-lg border border-border bg-panel p-4 space-y-3">
          <div className="flex items-center gap-2 pb-2 border-b border-border">
            <DollarSign className="h-4 w-4 text-primary" />
            <span className="text-sm font-semibold">Execution & Friction Costs</span>
          </div>

          <div className="space-y-2 text-xs">
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Gross Strategy PnL</span>
              <span className="font-mono font-semibold">₹{result.grossPnl.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Brokerage Fees</span>
              <span className="font-mono text-bear">
                ₹{result.trades.reduce((s, t) => s + t.fees, 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Spread Drag</span>
              <span className="font-mono text-bear">
                ₹{result.trades.reduce((s, t) => s + t.spreadCost, 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Slippage Drag</span>
              <span className="font-mono text-bear">
                ₹{result.trades.reduce((s, t) => s + t.slippage, 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between py-1 border-b border-border/50">
              <span className="text-muted-foreground">Market Impact Drag</span>
              <span className="font-mono text-bear">
                ₹{result.trades.reduce((s, t) => s + t.marketImpactCost, 0).toFixed(2)}
              </span>
            </div>
            <div className="flex justify-between py-1.5 font-bold border-t border-border">
              <span>Total Transaction Costs</span>
              <span className="font-mono text-bear">₹{result.totalTransactionCosts.toFixed(2)}</span>
            </div>
            <div className="flex justify-between py-1.5 font-bold text-sm bg-primary/5 p-2 rounded">
              <span>Net Portfolio PnL</span>
              <span className={`font-mono ${result.netPnl >= 0 ? "text-bull" : "text-bear"}`}>
                ₹{result.netPnl.toFixed(2)}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Attribution: Top & Bottom Contributors + Sector Allocation */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {/* Top Contributors */}
        <div className="rounded-lg border border-border bg-panel p-4">
          <span className="text-sm font-semibold flex items-center gap-2 mb-3">
            <CheckCircle2 className="h-4 w-4 text-bull" />
            Top Contributors
          </span>
          <div className="space-y-2 text-xs">
            {topContributors.map((c) => (
              <div key={c.symbol} className="flex justify-between items-center py-1 border-b border-border/50">
                <span className="font-mono font-semibold">{c.symbol}</span>
                <span className="font-mono text-bull font-medium">+₹{c.netPnl.toFixed(0)} ({c.tradeCount} trades)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Bottom Contributors */}
        <div className="rounded-lg border border-border bg-panel p-4">
          <span className="text-sm font-semibold flex items-center gap-2 mb-3">
            <ShieldAlert className="h-4 w-4 text-bear" />
            Bottom Contributors
          </span>
          <div className="space-y-2 text-xs">
            {bottomContributors.map((c) => (
              <div key={c.symbol} className="flex justify-between items-center py-1 border-b border-border/50">
                <span className="font-mono font-semibold">{c.symbol}</span>
                <span className="font-mono text-bear font-medium">₹{c.netPnl.toFixed(0)} ({c.tradeCount} trades)</span>
              </div>
            ))}
          </div>
        </div>

        {/* Sector Allocation */}
        <div className="rounded-lg border border-border bg-panel p-4">
          <span className="text-sm font-semibold flex items-center gap-2 mb-3">
            <PieChart className="h-4 w-4 text-primary" />
            Sector Breakdown
          </span>
          <div className="space-y-2 text-xs">
            {sectorAllocations.map((s) => (
              <div key={s.sector} className="flex justify-between items-center py-1 border-b border-border/50">
                <span className="font-medium">{s.sector}</span>
                <span className={`font-mono font-semibold ${s.netPnl >= 0 ? "text-bull" : "text-bear"}`}>
                  ₹{s.netPnl.toFixed(0)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Monthly Returns Matrix */}
      {monthlyReturns.length > 0 && (
        <div className="rounded-lg border border-border bg-panel p-4">
          <span className="text-sm font-semibold mb-3 block">Monthly Return Matrix</span>
          <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-12 gap-2 text-center text-xs">
            {monthlyReturns.map(([month, pnl]) => (
              <div
                key={month}
                className={`p-2 rounded border ${
                  pnl >= 0
                    ? "bg-bull/10 border-bull/30 text-bull"
                    : "bg-bear/10 border-bear/30 text-bear"
                }`}
              >
                <div className="text-[10px] text-muted-foreground font-mono">{month}</div>
                <div className="font-mono font-bold mt-1">₹{pnl.toFixed(0)}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
