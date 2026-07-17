import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Activity, DollarSign, TrendingUp, TrendingDown, Clock, Calculator, PieChart, BarChart3, Award, Target, Zap, Shield, Calendar, Filter, Download, X, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { TiltCard } from "@/components/trading/tilt-card";
import { ContractPanel } from "@/components/common/contract-panel";
import { EquityCurveChart } from "@/components/chart/equity-curve-chart";
import type { MarketQuote } from "@/lib/market-api";
import { QuickTradeModal } from "@/components/trading/quick-trade-modal";
import { PlusCircle } from "lucide-react";

export const Route = createFileRoute("/_app/portfolio")({
  head: () => ({
    meta: [{ title: "Portfolio — MAET" }]
  }),
  component: PortfolioPage,
});

function StatCard({ icon: Icon, label, value, sub, trend }: {
  icon: LucideIcon;
  label: string;
  value: string;
  sub?: string;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
        {trend === "up" && <TrendingUp className="h-4 w-4 text-bull" />}
        {trend === "down" && <TrendingDown className="h-4 w-4 text-bear" />}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold">{value}</div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PositionCard({
  symbol,
  qty,
  avgPrice,
  ltp,
  pnl,
  totalValue,
  changePct
}: {
  symbol: string;
  qty: number;
  avgPrice: number;
  ltp: number;
  pnl: number;
  totalValue: number;
  changePct: number;
}) {
  return (
    <div className="border border-border bg-panel rounded-lg p-4 hover:bg-accent/50 transition-colors">
      <div className="flex items-center justify-between mb-2">
        <div className="font-semibold">{symbol}</div>
        <div className={`text-sm font-medium ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
          {pnl >= 0 ? "+" : ""}{pnl.toFixed(2)}
        </div>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div>
          <div className="text-muted-foreground">Qty</div>
          <div className="font-mono">{qty}</div>
        </div>
        <div>
          <div className="text-muted-foreground">Avg</div>
          <div className="font-mono">{avgPrice.toFixed(2)}</div>
        </div>
        <div>
          <div className="text-muted-foreground">LTP</div>
          <div className="font-mono">{ltp.toFixed(2)}</div>
        </div>
      </div>

      <div className="mt-2 flex justify-between items-center">
        <div className="font-semibold">{totalValue.toFixed(2)}</div>
        <div className={`text-xs ${changePct >= 0 ? "text-bull" : "text-bear"}`}>
          {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
        </div>
      </div>
    </div>
  );
}

function PortfolioPage() {
  const { account, reset, placeOrder } = usePaperAccount();
  const { metrics, risk, trades, history, hasData } = usePortfolioAnalytics();
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState<"1W" | "1M" | "3M" | "1Y" | "ALL">("ALL");
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; side: "BUY" | "SELL" }>({
    isOpen: false,
    symbol: "",
    side: "BUY",
  });

  // Get all unique symbols from positions
  const positionSymbols = useMemo(
    () => [...new Set(account.positions.map(position => position.symbol))],
    [account.positions]
  );

  const { quoteMap, streamConnected, isError } = useMarketQuotes(positionSymbols);

  const totalAllocation = useMemo(() => {
    if (metrics.positionsValue === 0) return [];
    return account.positions
      .map(p => {
        const quote = quoteMap.get(p.symbol);
        const currentPrice = quote?.price || p.avgPrice;
        const value = currentPrice * p.qty;
        return {
          symbol: p.symbol,
          value,
          pct: (value / metrics.totalValue) * 100,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [account.positions, metrics.positionsValue, metrics.totalValue, quoteMap]);

  const allocationColors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1", "#ef4444"];

  const topPerformers = useMemo(() => {
    return [...account.positions]
      .map(p => {
        const quote = quoteMap.get(p.symbol);
        const ltp = quote?.price || p.avgPrice;
        const changePct = quote?.changePct || 0;
        const pnl = (ltp - p.avgPrice) * p.qty;
        return { symbol: p.symbol, pnl, changePct, ltp };
      })
      .sort((a, b) => b.pnl - a.pnl);
  }, [account.positions, quoteMap]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => navigate({ to: "/" })}
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div>
                <h1 className="text-xl font-semibold">Portfolio</h1>
                <p className="text-xs text-muted-foreground">Paper trading performance</p>
              </div>
              <span className="text-sm text-muted-foreground">
                {isError
                  ? "Quote service unavailable"
                  : streamConnected
                  ? "Real-time quotes active"
                  : "Connecting to market data"}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setTradeModal({ isOpen: true, symbol: "", side: "BUY" })}
                className="flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-2 text-sm font-bold shadow transition-all"
              >
                <PlusCircle className="h-4 w-4" />
                Quick Trade
              </button>
              <button
                type="button"
                onClick={() => window.confirm("Reset all positions and cash to ₹1,000,000? This cannot be undone.") && reset()}
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent transition-all"
              >
                Reset
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon={DollarSign}
            label="Total Value"
            value={`₹${metrics.totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            sub={`₹${metrics.cash.toFixed(2)} cash`}
            trend={metrics.totalPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={Activity}
            label="Total P&L"
            value={`₹${metrics.totalPnl.toFixed(2)}`}
            sub={`${metrics.totalReturnPct >= 0 ? "+" : ""}${metrics.totalReturnPct.toFixed(2)}% return`}
            trend={metrics.totalPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={TrendingUp}
            label="Unrealized"
            value={`₹${metrics.unrealizedPnl.toFixed(2)}`}
            sub={`${account.positions.length} positions`}
            trend={metrics.unrealizedPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={TrendingDown}
            label="Realized"
            value={`₹${metrics.realizedPnl.toFixed(2)}`}
            sub={`${trades.totalTrades} closed trades`}
            trend={metrics.realizedPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={Clock}
            label="Today"
            value={`${metrics.dayPnl >= 0 ? "+" : ""}₹${metrics.dayPnl.toFixed(2)}`}
            sub={`${metrics.dayPnlPct >= 0 ? "+" : ""}${metrics.dayPnlPct.toFixed(2)}% day`}
            trend={metrics.dayPnl >= 0 ? "up" : "down"}
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Positions Column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Equity Curve */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <div className="flex items-center justify-between mb-3">
                  <h3 className="font-semibold flex items-center gap-2">
                    <TrendingUp className="h-4 w-4 text-primary" />
                    Equity Curve
                  </h3>
                  <div className="flex gap-1">
                    {(["1W", "1M", "3M", "1Y", "ALL"] as const).map((period) => (
                      <button
                        key={period}
                        onClick={() => setSelectedPeriod(period)}
                        className={`rounded px-2 py-0.5 text-[10px] font-medium ${
                          selectedPeriod === period
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {period}
                      </button>
                    ))}
                  </div>
                </div>
                {hasData && history.length > 0 ? (
                  <EquityCurveChart data={history} height={220} />
                ) : (
                  <div className="h-48 bg-panel/80 rounded border border-border flex items-center justify-center">
                    <div className="text-center">
                      <div className="text-sm text-muted-foreground">No trade history yet</div>
                      <div className="text-xs text-muted-foreground mt-1">Place orders to see your equity curve</div>
                    </div>
                  </div>
                )}
              </div>
            </TiltCard>

            {/* Positions */}
            <div>
              <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold">Positions</h2>
                <div className="text-sm text-muted-foreground">
                  {account.positions.length > 0 ? `${account.positions.length} open` : "None"}
                </div>
              </div>

              {account.positions.length > 0 ? (
                <div className="space-y-3">
                  {account.positions.map(position => {
                    const quote = quoteMap.get(position.symbol);
                    const ltp = quote?.price || position.avgPrice;
                    const changePct = quote?.changePct || 0;
                    const totalValue = ltp * position.qty;
                    const pnl = (ltp - position.avgPrice) * position.qty;

                    return (
                      <div key={position.symbol} className="border border-border bg-panel rounded-lg p-4 hover:bg-accent/50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold">{position.symbol}</div>
                          <div className={`text-sm font-medium ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Qty</div>
                            <div className="font-mono">{position.qty}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Avg</div>
                            <div className="font-mono">₹{position.avgPrice.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">LTP</div>
                            <div className="font-mono">₹{ltp.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Value</div>
                            <div className="font-mono">₹{totalValue.toFixed(2)}</div>
                          </div>
                        </div>
                        <div className="mt-2 flex justify-between items-center">
                          <div className="text-xs text-muted-foreground">{changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}% today</div>
                          <div className={`text-xs font-medium ${changePct >= 0 ? "text-bull" : "text-bear"}`}>
                            {changePct >= 0 ? "+" : ""}{changePct.toFixed(2)}%
                          </div>
                        </div>
                        <div className="mt-3 pt-2 border-t border-border/50 flex justify-end gap-1.5">
                          <button
                            onClick={() => setTradeModal({ isOpen: true, symbol: position.symbol, side: position.qty > 0 ? "BUY" : "SELL" })}
                            className="rounded bg-accent hover:bg-accent-elevated border border-border text-foreground px-2.5 py-1 text-[10px] font-semibold transition"
                          >
                            Trade
                          </button>
                          <button
                            onClick={() => {
                              if (window.confirm(`Are you sure you want to close your position in ${position.symbol}?`)) {
                                placeOrder({
                                  symbol: position.symbol,
                                  side: position.qty > 0 ? "SELL" : "BUY",
                                  qty: Math.abs(position.qty),
                                  type: "MARKET"
                                });
                              }
                            }}
                            className="rounded bg-bear hover:bg-bear/90 text-white px-2.5 py-1 text-[10px] font-semibold transition"
                          >
                            Exit
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="h-48 flex items-center justify-center border border-dashed border-border rounded-lg bg-panel/30">
                  <div className="text-center">
                    <div className="text-4xl mb-2">📋</div>
                    <h3 className="font-medium mb-1">No open positions</h3>
                    <p className="text-sm text-muted-foreground">
                      Use the terminal to buy and test your strategies
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Allocation */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <PieChart className="h-4 w-4 text-primary" />
                  Allocation
                </h3>
                {totalAllocation.length > 0 ? (
                  <div className="space-y-2">
                    {totalAllocation.map((item, idx) => (
                      <div key={item.symbol} className="flex items-center gap-2">
                        <div
                          className="h-2 rounded-full"
                          style={{
                            width: `${item.pct}%`,
                            backgroundColor: allocationColors[idx % allocationColors.length],
                            minWidth: "4px",
                          }}
                        />
                        <div className="flex-1 flex justify-between text-xs">
                          <span className="font-medium">{item.symbol}</span>
                          <span className="font-mono text-muted-foreground">{item.pct.toFixed(1)}%</span>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-sm text-muted-foreground">
                    No allocations yet
                  </div>
                )}
              </div>
            </TiltCard>

            {/* Risk Metrics */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <div className="flex items-center gap-2 mb-3">
                  <Shield className="h-4 w-4 text-primary" />
                  <h3 className="font-semibold">Risk Metrics</h3>
                </div>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Sharpe Ratio</span>
                    <span className="font-mono text-muted-foreground" title="Unavailable: verified daily portfolio returns are not stored">
                      {risk.sharpeRatio?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Max Drawdown</span>
                    <span className="font-mono text-muted-foreground" title="Unavailable: a historical daily portfolio value series is required">
                      {risk.maxDrawdownPct !== null ? `${risk.maxDrawdownPct.toFixed(2)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Volatility</span>
                    <span className="font-mono text-muted-foreground" title="Unavailable: verified daily portfolio returns are not stored">
                      {risk.volatility !== null ? `${risk.volatility.toFixed(1)}%` : "—"}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Beta</span>
                    <span className="font-mono text-muted-foreground" title="Unavailable: portfolio and benchmark return histories are required">
                      {risk.beta?.toFixed(2) ?? "—"}
                    </span>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Trade Stats */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3 flex items-center gap-2">
                  <Target className="h-4 w-4 text-primary" />
                  Trade Statistics
                </h3>
                <div className="space-y-3 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Trades</span>
                    <span className="font-mono font-medium">{trades.totalTrades}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Win Rate</span>
                    <span className={`font-mono font-medium ${trades.winRate >= 50 ? "text-bull" : "text-muted-foreground"}`}>
                      {trades.winRate.toFixed(1)}%
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Profit Factor</span>
                    <span className={`font-mono font-medium ${trades.profitFactor >= 1 ? "text-bull" : "text-bear"}`}>
                      {trades.profitFactor === Infinity ? "∞" : trades.profitFactor.toFixed(2)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Win</span>
                    <span className="font-mono text-bull">+₹{trades.avgWin.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Avg Loss</span>
                    <span className="font-mono text-bear">-₹{trades.avgLoss.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Largest Win</span>
                    <span className="font-mono text-bull">+₹{trades.largestWin.toFixed(2)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Largest Loss</span>
                    <span className="font-mono text-bear">-₹{Math.abs(trades.largestLoss).toFixed(2)}</span>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Top Movers */}
            {topPerformers.length > 0 && (
              <TiltCard>
                <div className="rounded-xl border border-border bg-panel p-4">
                  <h3 className="font-semibold mb-3">Position Performance</h3>
                  <div className="space-y-2">
                    {topPerformers.map((p) => (
                      <div key={p.symbol} className="flex items-center justify-between text-sm">
                        <span className="font-medium">{p.symbol}</span>
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">₹{p.ltp.toFixed(2)}</span>
                          <span className={`font-mono text-xs ${p.pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {p.pnl >= 0 ? "+" : ""}₹{p.pnl.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              </TiltCard>
            )}
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-8 rounded-lg border border-dashed border-border bg-panel/30 p-4 text-center">
          <div className="text-sm text-muted-foreground">
            Paper Trading — All values are simulated using Yahoo Finance delayed quotes. No real orders are placed.
          </div>
        </div>
      </div>

      <QuickTradeModal
        isOpen={tradeModal.isOpen}
        onClose={() => setTradeModal({ ...tradeModal, isOpen: false })}
        initialSymbol={tradeModal.symbol}
        initialSide={tradeModal.side}
      />
    </div>
  );
}
