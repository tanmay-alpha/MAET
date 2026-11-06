import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, DollarSign, TrendingUp, TrendingDown, type LucideIcon } from "lucide-react";
import { useMemo, useState } from "react";
import { usePortfolioAnalytics } from "@/hooks/use-portfolio-analytics";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { quoteFeedLabel } from "@/lib/quote-status";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { paperAccountBlockedReason } from "@/lib/paper-account-status";
import { PaperAccountNotice } from "@/components/common/signed-out-notice";
import { TiltCard } from "@/components/trading/tilt-card";
import { EquityCurveChart } from "@/components/chart/equity-curve-chart";
import { QuickTradeModal } from "@/components/trading/quick-trade-modal";
import { ResetAccountButton } from "@/components/trading/reset-account-button";
import { PortfolioPerformancePanel } from "@/components/trading/portfolio-performance-panel";
import { PlusCircle } from "lucide-react";
import type { PaperPositionRow } from "../../server/modules/paper-trading/contracts";
import { calculateMarkedUnrealisedPnl } from "@shared/domain/paper-trading/margin";
import { buildClosePositionOrder } from "@/lib/paper-orders";
import { ReturnsTaxSection } from "@/components/investing/returns-tax";
import { rupees } from "@/components/investing/display";

export const Route = createFileRoute("/_app/portfolio")({
  head: () => ({
    meta: [{ title: "Portfolio — MAET" }],
  }),
  component: PortfolioPage,
});

type ChartPeriod = "1W" | "1M" | "3M" | "1Y" | "ALL";
const PERIOD_DAYS: Record<Exclude<ChartPeriod, "ALL">, number> = { "1W": 7, "1M": 31, "3M": 92, "1Y": 366 };

function StatCard({ icon: Icon, label, value, sub, trend }: {
  icon: LucideIcon;
  label: string;
  /** null while the account is loading: a skeleton, never a placeholder figure. */
  value: string | null;
  sub?: string;
  trend?: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4" aria-busy={value === null}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-muted-foreground" />
          <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        </div>
        {trend === "up" && <TrendingUp className="h-4 w-4 text-bull" />}
        {trend === "down" && <TrendingDown className="h-4 w-4 text-bear" />}
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold">
        {value ?? <span aria-hidden className="inline-block h-7 w-28 animate-pulse rounded bg-accent" />}
      </div>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </div>
  );
}

function PortfolioPage() {
  const { status, positions, resetAccount, placeOrder, isTradingAvailable, retry } = usePaperAccount();
  const { metrics, trades, history, performance, isPerformanceLoading, performanceError, signedIn } = usePortfolioAnalytics();
  const navigate = useNavigate();
  const [selectedPeriod, setSelectedPeriod] = useState<ChartPeriod>("ALL");
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; side: "BUY" | "SELL" }>({
    isOpen: false,
    symbol: "",
    side: "BUY",
  });

  const positionSymbols = useMemo(
    () => [...new Set(positions.map((p) => p.symbol))],
    [positions]
  );

  const { quoteMap, isError, delayed, marketPhase } = useMarketQuotes(positionSymbols);

  const visibleHistory = useMemo(() => {
    if (selectedPeriod === "ALL" || history.length === 0) return history;
    const cutoff = Date.parse(history[history.length - 1].date) - PERIOD_DAYS[selectedPeriod] * 86_400_000;
    return history.filter((point) => Date.parse(point.date) >= cutoff);
  }, [history, selectedPeriod]);

  const totalAllocation = useMemo(() => {
    if (!metrics || metrics.positionsValue === 0) return [];
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
  }, [positions, metrics, quoteMap]);

  const allocationColors = ["#3b82f6", "#8b5cf6", "#ec4899", "#f59e0b", "#10b981", "#6366f1", "#ef4444"];
  if (!signedIn) {
    return <div className="mx-auto max-w-7xl px-4 py-6">
      <h1 className="mb-4 text-xl font-semibold">Portfolio</h1>
      <ReturnsTaxSection />
    </div>;
  }

  const blockedReason = paperAccountBlockedReason(status);
  const failed = status === "unauthorized" || status === "unavailable";
  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex flex-wrap items-center gap-3">
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
                {quoteFeedLabel({ isError, delayed, marketPhase })}
              </span>
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                disabled={blockedReason !== null}
                title={blockedReason ?? undefined}
                onClick={() => setTradeModal({ isOpen: true, symbol: "", side: "BUY" })}
                className="flex items-center gap-1.5 rounded-lg bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-2 text-sm font-bold shadow transition-all disabled:cursor-not-allowed disabled:opacity-50"
              >
                <PlusCircle className="h-4 w-4" />
                Quick Trade
              </button>
              <ResetAccountButton
                accountStatus={status}
                onReset={resetAccount}
                confirmMessage="Reset all positions and cash to the starting balance?"
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent transition-all"
              >
                Reset
              </ResetAccountButton>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        <PaperAccountNotice status={status} onRetry={retry} />
        {/* Returns & tax reads the same account: nothing to compute when it failed to load. */}
        {!failed && <ReturnsTaxSection />}
        {/* Portfolio Summary */}
        {!failed && <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon={DollarSign}
            label="Total Value"
            value={metrics && rupees(metrics.totalValue)}
            sub={metrics ? `${rupees(metrics.cash)} cash` : undefined}
            trend={metrics ? (metrics.totalPnl >= 0 ? "up" : "down") : undefined}
          />
          <StatCard
            icon={TrendingUp}
            label="Unrealized P&L"
            value={metrics && `${metrics.unrealizedPnl >= 0 ? "+" : ""}${rupees(metrics.unrealizedPnl)}`}
            trend={metrics ? (metrics.unrealizedPnl >= 0 ? "up" : "down") : undefined}
          />
          <StatCard
            icon={TrendingUp}
            label="Realized P&L"
            value={metrics && `${metrics.realizedPnl >= 0 ? "+" : ""}${rupees(metrics.realizedPnl)}`}
            trend={metrics ? (metrics.realizedPnl >= 0 ? "up" : "down") : undefined}
          />
          <StatCard
            icon={TrendingUp}
            label="Total P&L"
            value={metrics && `${metrics.totalPnl >= 0 ? "+" : ""}${rupees(metrics.totalPnl)}`}
            sub={metrics ? `${metrics.totalReturnPct >= 0 ? "+" : ""}${metrics.totalReturnPct.toFixed(2)}%` : undefined}
            trend={metrics ? (metrics.totalPnl >= 0 ? "up" : "down") : undefined}
          />
          <StatCard
            icon={DollarSign}
            label="Positions Value"
            value={metrics && rupees(metrics.positionsValue)}
            sub={metrics ? `${positions.length} active` : undefined}
          />
        </div>}

        {status === "ready" && <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
          {/* Equity Curve */}
          <div className="lg:col-span-2 space-y-6">
            <TiltCard>
              <div className="p-4 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-semibold">
                    Equity Curve
                    <span className="ml-2 text-[10px] font-normal text-muted-foreground">daily closing snapshots</span>
                  </div>
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
                {visibleHistory.length > 0 ? (
                  <>
                    <EquityCurveChart data={visibleHistory} height={220} />
                    {(performance?.metrics.snapshotCount ?? 0) <= 1 && (
                      <div className="text-xs text-muted-foreground">
                        The curve starts at your starting cash (square) and grows by one point after each NSE close.
                      </div>
                    )}
                  </>
                ) : (
                  <div className="h-48 bg-panel/80 rounded border border-border flex items-center justify-center">
                    <div className="text-center px-4">
                      <div className="text-sm text-muted-foreground">
                        {!signedIn ? "Sign in to see your equity curve" : isPerformanceLoading ? "Loading equity curve…" : "No daily snapshots yet"}
                      </div>
                      {signedIn && !isPerformanceLoading && (
                        <div className="text-xs text-muted-foreground mt-1">
                          {performanceError
                            ? `Equity curve unavailable: ${performanceError}`
                            : "The first point is recorded during the next NSE session or after its close (15:45 IST)."}
                        </div>
                      )}
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
                    const isShort = position.side === "SHORT" || Number(position.totalShares) < 0;
                    const signedQty = isShort ? -Math.abs(position.totalShares) : Math.abs(position.totalShares);
                    const totalVal = ltp * Math.abs(position.totalShares);
                    const pnl = calculateMarkedUnrealisedPnl({ quantity: signedQty, averagePrice: avgPrice }, ltp);

                    return (
                      <div key={position.id} className="border border-border bg-panel rounded-lg p-4 hover:bg-accent/50 transition-colors">
                        <div className="flex items-center justify-between mb-2">
                          <div className="flex items-center gap-1.5 font-semibold">
                            <span>{position.symbol}</span>
                            <span className={`text-[9px] px-1 py-0.2 rounded font-mono ${isShort ? "bg-bear/20 text-bear" : "bg-bull/20 text-bull"}`}>
                              {isShort ? "SHORT" : "LONG"}
                            </span>
                          </div>
                          <div className={`text-sm font-medium ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {pnl >= 0 ? "+" : ""}{rupees(pnl)}
                          </div>
                        </div>
                        <div className="grid grid-cols-4 gap-2 text-xs">
                          <div>
                            <div className="text-muted-foreground">Qty</div>
                            <div className="font-mono">{Math.abs(position.totalShares)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Avg</div>
                            <div className="font-mono">{rupees(avgPrice)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">LTP</div>
                            <div className="font-mono">{rupees(ltp)}</div>
                          </div>
                          <div>
                            <div className="text-muted-foreground">Value</div>
                            <div className="font-mono">{rupees(totalVal)}</div>
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
                                void placeOrder(buildClosePositionOrder(position));
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
                          <span className="font-mono">{item.pct.toFixed(1)}% ({rupees(item.value)})</span>
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
              <div className="p-4">
                <div className="text-sm font-semibold mb-2">Performance</div>
                <PortfolioPerformancePanel
                  performance={performance}
                  isLoading={isPerformanceLoading}
                  error={performanceError}
                  signedIn={signedIn}
                />
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
        </div>}
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
