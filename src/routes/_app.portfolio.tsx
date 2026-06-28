import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowLeft, Activity, DollarSign, TrendingUp, TrendingDown, Clock, Calculator, PieChart, BarChart3 } from "lucide-react";
import { useMemo } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { TiltCard } from "@/components/trading/tilt-card";
import { MarketHeatmap } from "@/components/trading/market-heatmap";
import { BreadthGauge } from "@/components/trading/breadth-gauge";
import { SectorStrip } from "@/components/trading/sector-strip";
import { ContractPanel } from "@/components/common/contract-panel";
import { Loadable } from "@/components/trading/skeleton";
import type { MarketQuote } from "@/lib/market-api";

export const Route = createFileRoute("/_app/portfolio")({
  head: () => ({
    meta: [{ title: "Portfolio — MAET" }]
  }),
  component: PortfolioPage,
});

function StatCard({ icon: Icon, label, value, sub, trend }: {
  icon: any;
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
  const { account, reset } = usePaperAccount();
  const navigate = useNavigate();

  // Get all unique symbols from positions
  const positionSymbols = useMemo(
    () => [...new Set(account.positions.map(position => position.symbol))],
    [account.positions]
  );

  const { quoteMap, streamConnected, isError } = useMarketQuotes(positionSymbols);

  // Calculate portfolio metrics
  const metrics = useMemo(() => {
    let unrealizedPnl = 0;
    let realizedPnl = account.realizedPnl;
    let positionsValue = 0;
    let totalValue = account.cash + positionsValue;
    let totalPnl = totalValue - account.initialCash;
    let dailyChange = 0;

    account.positions.forEach(position => {
      const quote = quoteMap.get(position.symbol);
      if (quote?.price) {
        const markToMarket = (quote.price - position.avgPrice) * position.qty;
        unrealizedPnl += markToMarket;
        positionsValue += quote.price * position.qty;
        totalValue = account.cash + positionsValue;

        if (quote.changePct !== undefined) {
          dailyChange += (quote.price - (quote.price / (1 + quote.changePct / 100))) * position.qty;
        }
      }
    });

    totalValue = account.cash + positionsValue;
    totalPnl = totalValue - account.initialCash;

    return {
      unrealizedPnl,
      realizedPnl,
      positionsValue,
      totalValue,
      totalPnl,
      dailyChange,
      hasPositions: account.positions.length > 0,
    };
  }, [account, quoteMap]);

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
              <h1 className="text-xl font-semibold">Paper Trading Portfolio</h1>
              <span className="text-sm text-muted-foreground">
                {isError
                  ? "Quote service unavailable"
                  : streamConnected
                  ? "Real-time quotes active"
                  : "Connecting to market data"}
              </span>
            </div>
            <button
              type="button"
              onClick={() => window.confirm("Reset all positions and cash?") && reset()}
              className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent"
            >
              Reset Portfolio
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Portfolio Summary */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <StatCard
            icon={DollarSign}
            label="Total Equity"
            value={`₹${metrics.totalValue.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`}
            trend={metrics.totalPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={Activity}
            label="Total P&L"
            value={`₹${metrics.totalPnl.toFixed(2)}`}
            sub={`₹${metrics.unrealizedPnl.toFixed(2)} unrealized`}
            trend={metrics.totalPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={TrendingUp}
            label="Unrealized"
            value={`₹${metrics.unrealizedPnl.toFixed(2)}`}
            sub={`₹${metrics.positionsValue.toFixed(2)} positions`}
            trend={metrics.unrealizedPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={TrendingDown}
            label="Realized"
            value={`₹${metrics.realizedPnl.toFixed(2)}`}
            sub="All-time gains"
            trend={metrics.realizedPnl >= 0 ? "up" : "down"}
          />
          <StatCard
            icon={Clock}
            label="Cash Balance"
            value={`₹${account.cash.toFixed(2)}`}
            sub={`Initial: ₹${account.initialCash.toFixed(2)}`}
          />
        </div>

        <div className="grid lg:grid-cols-3 gap-6">
          {/* Positions Column */}
          <div className="lg:col-span-2 space-y-4">
            {/* Positions Header */}
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-semibold">Open Positions</h2>
              <div className="text-sm text-muted-foreground">
                {metrics.hasPositions ? `Marked to market with Yahoo quotes` : "No open positions"}
              </div>
            </div>

            {/* Positions List */}
            {metrics.hasPositions ? (
              <div className="space-y-3">
                {account.positions.map(position => {
                  const quote = quoteMap.get(position.symbol);
                  const ltp = quote?.price || position.avgPrice;
                  const changePct = quote?.changePct || 0;
                  const totalValue = ltp * position.qty;
                  const pnl = (ltp - position.avgPrice) * position.qty;

                  return (
                    <PositionCard
                      key={position.symbol}
                      symbol={position.symbol}
                      qty={position.qty}
                      avgPrice={position.avgPrice}
                      ltp={ltp}
                      pnl={pnl}
                      totalValue={totalValue}
                      changePct={changePct}
                    />
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

            {/* Daily Performance */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Daily Performance</h3>
                <div className="text-center py-8">
                  <div className="text-3xl font-semibold text-bull mb-2">
                    {metrics.dailyChange >= 0 ? "+" : ""}₹{metrics.dailyChange.toFixed(2)}
                  </div>
                  <div className="text-sm text-muted-foreground">
                    Paper portfolio daily P&L
                  </div>
                </div>
              </div>
            </TiltCard>
          </div>

          {/* Sidebar */}
          <div className="space-y-4">
            {/* Account Info */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Account Info</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Initial Capital</span>
                    <span className="font-mono">₹{account.initialCash.toLocaleString("en-IN")}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Total Positions</span>
                    <span className="font-mono">{account.positions.length}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Filled Orders</span>
                    <span className="font-mono">
                      {account.orders.filter(o => o.status === "filled").length}
                    </span>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Performance Chart */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Performance</h3>
                <div className="h-32 bg-panel/80 rounded border border-border flex items-center justify-center">
                  <div className="text-center">
                    <div className="text-sm text-muted-foreground">Equity curve</div>
                    <div className="text-xs text-muted-foreground">P&L over time</div>
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Market Overview */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Market Overview</h3>
                <div className="space-y-2">
                  <div className="text-sm text-muted-foreground">
                    Market breadth from Yahoo data
                  </div>
                </div>
              </div>
            </TiltCard>

            {/* Risk Metrics */}
            <TiltCard>
              <div className="rounded-xl border border-border bg-panel p-4">
                <h3 className="font-semibold mb-3">Risk Metrics</h3>
                <div className="space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Max Drawdown</span>
                    <span className="font-mono text-bull">-0.0%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Win Rate</span>
                    <span className="font-mono">0%</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Sharpe Ratio</span>
                    <span className="font-mono">0.00</span>
                  </div>
                </div>
              </div>
            </TiltCard>
          </div>
        </div>

        {/* Educational Section */}
        <div className="mt-8 rounded-lg border border-dashed border-border bg-panel/30 p-6 text-center">
          <h3 className="text-lg font-semibold mb-2">Paper Trading Education</h3>
          <p className="text-sm text-muted-foreground max-w-2xl mx-auto">
            This is a simulated paper trading environment. All positions and performance are calculated
            using Yahoo Finance delayed quotes. No real money is at risk, and no broker order is sent.
            Use this to understand market mechanics and test your strategies before risking real capital.
          </p>
        </div>
      </div>
    </div>
  );
}