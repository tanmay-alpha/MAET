import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { TiltCard } from "@/components/trading/tilt-card";
import { EquityCurveChart } from "@/components/chart/equity-curve-chart";
import { QuickTradeModal } from "@/components/trading/quick-trade-modal";
import { PlusCircle } from "lucide-react";
import type { PaperPositionRow } from "../../server/modules/paper-trading/contracts";

export const Route = createFileRoute("/_app/portfolio")({
  head: () => ({
    meta: [{ title: "Portfolio — MAET" }],
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

function PortfolioPage() {
  const { account, positions, resetAccount, placeOrder, isTradingAvailable } = usePaperAccount();
  const { metrics, risk, trades, history, hasData } = usePortfolioAnalytics();
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState<"1W" | "1M" | "3M" | "1Y" | "ALL">("ALL");
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; side: "BUY" | "SELL" }>({
    isOpen: false,
    symbol: "",
    side: "BUY",
  });

  const positionSymbols = useMemo(
    () => [...new Set(positions.map((p) => p.symbol))],
    [positions]
  );

  const { quoteMap, streamConnected, isError } = useMarketQuotes(positionSymbols);

  const totalAllocation = useMemo(() => {
    if (metrics.positionsValue === 0) return [];
    return positions
      .map((p) => {
        const quote = quoteMap.get(p.symbol);
        const avgPrice = Number(p.averageEntryPrice);
        const currentPrice = quote?.price || avgPrice;
        const value = currentPrice * p.totalShares;
        return {
          symbol: p.symbol,
          value,
          pct: (value / metrics.totalValue) * 100,
        };
      })
      .sort((a, b) => b.value - a.value);
  }, [positions, metrics.positionsValue, metrics.totalValue, quoteMap]);

  const allocationColors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1", "#ef4444"];

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
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent flex items-center gap-1"
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
                onClick={() => window.confirm("Reset all positions and cash to ₹1,000,000?") && resetAccount()}
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
            icon={TrendingUp}
            label="Unrealized P&L"
            value={`${metrics.unrealizedPnl >= 0 ? "+" : ""}₹${metrics.unrealizedPnl.toFixed(2)}`}
            trend={metrics.unrealizedPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={TrendingUp}
            label="Realized P&L"
            value={`${metrics.realizedPnl >= 0 ? "+" : ""}₹${metrics.realizedPnl.toFixed(2)}`}
            trend={metrics.realizedPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={TrendingUp}
            label="Total P&L"
            value={`${metrics.totalPnl >= 0 ? "+" : ""}₹${metrics.totalPnl.toFixed(2)}`}
            sub={`${metrics.totalReturnPct >= 0 ? "+" : ""}${metrics.totalReturnPct.toFixed(2)}%`}
            trend={metrics.totalPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={DollarSign}
            label="Positions Value"
            value={`₹${metrics.positionsValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            sub={`${positions.length} active`}
          />
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Equity Curve */}
          <div className="lg:col-span-2 space-y-6">
            <TiltCard>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">Equity Curve</div>
                  <div className="flex gap-1 bg-accent/40 p-1 rounded-md">
                    {(["1W", "1M", "3M", "1Y", "ALL"] as const).map((period) => (
                      <button
                        key={period}
                        type="button"
                        onClick={() => setSelectedPeriod(period)}
                        className={`px-2.5 py-1 text-xs rounded font-medium transition ${
                          selectedPeriod === period ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
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
                  {positions.length > 0 ? `${positions.length} open` : "None"}
                </div>
              </div>

              {positions.length > 0 ? (
                <div className="space-y-3">
                  {positions.map((position: PaperPositionRow) => {
                    const quote = quoteMap.get(position.symbol);
                    const avgPrice = Number(position.averageEntryPrice);
                    const ltp = quote?.price || avgPrice;
                    const changePct = quote?.changePct || 0;
                    const totalVal = ltp * position.totalShares;
                    const pnl = (ltp - avgPrice) * position.totalShares;

                    return (
                      <div key={position.id} className="border border-border bg-panel rounded-lg p-4 hover:bg-accent/50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="font-semibold">{position.symbol}</div>
                          <div className={`text-sm font-medium ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Qty</div>
                            <div className="font-mono">{position.totalShares}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Avg</div>
                            <div className="font-mono">₹{avgPrice.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">LTP</div>
                            <div className="font-mono">₹{ltp.toFixed(2)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Value</div>
                            <div className="font-mono">₹{totalVal.toFixed(2)}</div>
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
                            onClick={() => {
                              if (window.confirm(`Are you sure you want to close position in ${position.symbol}?`)) {
                                placeOrder({
                                  symbol: position.symbol,
                                  exchange: "NSE",
                                  side: "SELL",
                                  type: "MARKET",
                                  quantity: position.totalShares,
                                });
                              }
                            }}
                            disabled={!isTradingAvailable}
                            className="rounded bg-bear hover:bg-bear/90 text-white px-2.5 py-1 text-[10px] font-semibold transition disabled:opacity-50"
                          >
                            Close Position
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-lg border border-border bg-panel p-8 text-center text-muted-foreground text-sm">
                  No open positions. Use Quick Trade or the Terminal to open positions.
                </div>
              )}
            </div>
          </div>

          {/* Allocation & Trade Stats */}
          <div className="space-y-6">
            <TiltCard>
              <div className="p-4 space-y-4">
                <div className="text-sm font-semibold mb-2">Asset Allocation</div>
                {totalAllocation.length > 0 ? (
                  <div className="space-y-3">
                    {totalAllocation.map((item, idx) => (
                      <div key={item.symbol} className="space-y-1">
                        <div className="flex justify-between text-xs font-medium">
                          <span>{item.symbol}</span>
                          <span className="font-mono">{item.pct.toFixed(1)}% (₹{item.value.toFixed(2)})</span>
                        </div>
                        <div className="h-2 w-full bg-accent/40 rounded-full overflow-hidden">
                          <div
                            className="h-full rounded-full transition-all"
                            style={{
                              width: `${item.pct}%`,
                              backgroundColor: allocationColors[idx % allocationColors.length],
                            }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-6 text-xs text-muted-foreground">
                    100% Cash (No open stock positions)
                  </div>
                )}
              </div>
            </TiltCard>

            <TiltCard>
              <div className="p-4 space-y-3 text-xs">
                <div className="text-sm font-semibold mb-2">Trade Statistics</div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Total Fills</span>
                  <span className="font-mono font-semibold">{trades.totalTrades}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Win Rate</span>
                  <span className="font-mono font-semibold text-bull">{trades.winRate.toFixed(1)}%</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Winning Fills</span>
                  <span className="font-mono text-bull">{trades.winningTrades}</span>
                </div>
                <div className="flex justify-between py-1 border-b border-border/40">
                  <span className="text-muted-foreground">Losing Fills</span>
                  <span className="font-mono text-bear">{trades.losingTrades}</span>
                </div>
              </div>
            </TiltCard>
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
