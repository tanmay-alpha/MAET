import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CandlestickChart } from "@/components/trading/candlestick-chart";
import { OrderPanel } from "@/components/trading/order-panel";
import { ResetAccountButton } from "@/components/trading/reset-account-button";
import { Watchlist } from "@/components/trading/watchlist";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import type { MarketCandle } from "@/lib/market-api";
import { WATCHLIST } from "@/lib/market-catalog";
import { ShieldAlert, RefreshCw, Layers, ClipboardList, History, TrendingUp, BarChart3 } from "lucide-react";
import type { PaperOrderRow, PaperPositionRow, PaperFillRow } from "../../server/modules/paper-trading/contracts";
import { calculateMarkedUnrealisedPnl } from "@shared/domain/paper-trading/margin";
import { buildClosePositionOrder } from "@/lib/paper-orders";
import { extractPaperOverlay } from "@/components/trading/chart-paper-overlay";
import { PaperOrderStatus } from "@/components/trading/paper-order-status";
import { isWorkingOrderStatus } from "@shared/domain/paper-trading/order-status";
import { mapFillsToTradeMarkers } from "@/components/trading/chart-trade-markers";

import { useActiveSymbol } from "@/hooks/use-active-symbol";
import { Filter, Sparkles, X } from "lucide-react";

export const Route = createFileRoute("/_app/terminal")({
  head: () => ({ meta: [{ title: "Terminal — MAET" }] }),
  component: Terminal,
});

const INTERVALS = ["1m", "5m", "15m", "1h", "1D", "1W"];
const INTERVAL_CONFIG: Record<string, { timeframe: MarketCandle["tf"]; range: string }> = {
  "1m": { timeframe: "1m", range: "1d" },
  "5m": { timeframe: "5m", range: "5d" },
  "15m": { timeframe: "15m", range: "1mo" },
  "1h": { timeframe: "1h", range: "3mo" },
  "1D": { timeframe: "1d", range: "1y" },
  "1W": { timeframe: "1wk", range: "1y" },
};
const WATCHLIST_SYMBOLS = WATCHLIST.map((item) => item.symbol);

const inr = (value: number) => `₹${value.toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;

/** One account summary figure; a skeleton (no digits) until the account has loaded. */
function AccountFigure({ label, value, className = "text-xs font-semibold text-foreground" }: {
  label: string;
  value: string | null;
  className?: string;
}) {
  return (
    <div className="flex flex-col" aria-busy={value === null}>
      <span className="text-[10px] uppercase tracking-wider text-muted-foreground">{label}</span>
      {value === null
        ? <span aria-hidden className="mt-0.5 inline-block h-4 w-20 animate-pulse rounded bg-accent" />
        : <span className={`font-mono ${className}`}>{value}</span>}
    </div>
  );
}

function Terminal() {
  const navigate = useNavigate();
  const { activeSymbol: active, context, setSymbolContext } = useActiveSymbol();
  const [interval, setInterval] = useState("5m");
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "history">("positions");

  const current = useMemo(() => {
    return WATCHLIST.find((item) => item.symbol === active) || { symbol: active, name: active };
  }, [active]);
  const quoteSymbols = useMemo(() => {
    return [...new Set([...WATCHLIST_SYMBOLS, active])];
  }, [active]);

  const { quoteMap } = useMarketQuotes(quoteSymbols);
  const { status, account, positions, orders, fills, placeOrder, cancelOrder, resetAccount, isTradingAvailable } = usePaperAccount();

  const liveQuote = quoteMap.get(active);
  const intervalConfig = INTERVAL_CONFIG[interval];
  const candleQuery = useMarketCandles(active, intervalConfig.timeframe, intervalConfig.range);

  const candles = useMemo(() => {
    return (candleQuery.data?.candles || []).map((c) => ({
      t: new Date(c.ts).getTime(),
      o: c.open,
      h: c.high,
      l: c.low,
      c: c.close,
      v: c.volume,
    }));
  }, [candleQuery.data]);

  const currentPrice = liveQuote?.price;
  const currentChange = liveQuote?.change;
  const currentChangePct = liveQuote?.changePct;

  // Summary figures exist only for an account the server returned; there is no default balance.
  const summary = useMemo(() => {
    if (!account) return null;
    let unrealized = 0;
    const cash = Number(account.cashBalance);
    const allocated = Number(account.allocatedMargin);

    positions.forEach((pos: PaperPositionRow) => {
      const q = quoteMap.get(pos.symbol);
      const avgPrice = Number(pos.averageEntryPrice);
      const ltp = q?.price ?? avgPrice;
      const pnl = pos.totalShares * (ltp - avgPrice);
      unrealized += pnl;
    });

    const netAssetVal = cash + unrealized;
    const freeMarg = netAssetVal - allocated;
    const usage = netAssetVal > 0 ? (allocated / netAssetVal) * 100 : 0;

    return {
      cash,
      allocated,
      totalUnrealizedPnl: unrealized,
      nav: netAssetVal,
      freeMargin: freeMarg,
      marginUsagePercent: Math.max(0, Math.min(100, usage)),
    };
  }, [positions, account, quoteMap]);
  const marginUsagePercent = summary?.marginUsagePercent ?? 0;

  const paperOverlay = useMemo(
    () => extractPaperOverlay(active, positions, orders),
    [active, positions, orders]
  );
  const workingOrders = useMemo(() => orders.filter((o: PaperOrderRow) => isWorkingOrderStatus(o.status)), [orders]);

  const tradeMarkers = useMemo(
    () => mapFillsToTradeMarkers(fills, active),
    [fills, active]
  );

  const [chartType, setChartType] = useState<"candle" | "line">("candle");
  const [indicators, setIndicators] = useState({
    sma: false,
    ema: false,
    rsi: false,
    macd: false,
    volume: true,
  });

  // Restore saved chart preferences after mount; reading storage during render would
  // make the first client render differ from the server markup.
  useEffect(() => {
    const savedType = localStorage.getItem("maet_chart_type");
    if (savedType === "candle" || savedType === "line") setChartType(savedType);
    const savedInterval = localStorage.getItem("maet_chart_interval");
    if (savedInterval && savedInterval in INTERVAL_CONFIG) setInterval(savedInterval);
  }, []);

  const toggleIndicator = (key: keyof typeof indicators) => {
    setIndicators((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSetInterval = (tf: string) => {
    setInterval(tf);
    localStorage.setItem("maet_chart_interval", tf);
  };

  const handleSetChartType = (type: "candle" | "line") => {
    setChartType(type);
    localStorage.setItem("maet_chart_type", type);
  };

  const dataQuality = liveQuote?.quality ?? (candleQuery.data?.delayed ? "delayed" : "historical");
  const dataSource = liveQuote?.source ?? candleQuery.data?.source;

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col bg-background">
      {/* Top Account Summary Dashboard Bar: skeletons while loading; when the session was
          rejected or the server failed, the order ticket says so and no figures are shown. */}
      {(status === "ready" || status === "loading") && <div className="flex flex-wrap items-center justify-between border-b border-border bg-panel/40 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-6">
          <AccountFigure label="Net Asset Value (NAV)" value={summary && inr(summary.nav)} className="text-sm font-bold text-foreground" />
          <AccountFigure label="Available Cash" value={summary && inr(summary.cash)} />
          <AccountFigure label="Allocated Margin (5x)" value={summary && inr(summary.allocated)} />
          <AccountFigure
            label="Unrealized P&L"
            value={summary && `${summary.totalUnrealizedPnl >= 0 ? "+" : ""}${inr(summary.totalUnrealizedPnl)}`}
            className={`text-xs font-bold ${(summary?.totalUnrealizedPnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}
          />
          <AccountFigure label="Free Margin" value={summary && inr(summary.freeMargin)} />

          <div className="flex flex-col w-28">
            <div className="flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
              <span>Margin Util</span>
              <span>{summary ? `${marginUsagePercent.toFixed(0)}%` : ""}</span>
            </div>
            <div className="h-1.5 w-full rounded-full bg-accent overflow-hidden">
              <div
                className={`h-full transition-all duration-300 ${marginUsagePercent > 80 ? "bg-bear" : marginUsagePercent > 50 ? "bg-amber-500" : "bg-bull"}`}
                style={{ width: `${marginUsagePercent}%` }}
              />
            </div>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <ResetAccountButton
            accountStatus={status}
            onReset={resetAccount}
            confirmMessage="Reset the paper account to its initial cash? Open positions and orders are cleared."
            className="flex items-center gap-1.5 rounded border border-border bg-panel px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition"
          >
            <RefreshCw className="h-3 w-3" />
            Reset Account
          </ResetAccountButton>
        </div>
      </div>}

      {context.sourceContext === "screener" && (
        <div className="flex items-center justify-between border-b border-primary/20 bg-primary/10 px-4 py-1.5 text-xs text-primary">
          <div className="flex items-center gap-2 font-medium">
            <Filter className="h-3.5 w-3.5" />
            <span>Opened from Screener: <strong>{context.screenerRunId ?? "Custom Filter Match"}</strong></span>
            <span className="text-[10px] opacity-75">· Matched equity criteria</span>
          </div>
          <button
            type="button"
            onClick={() => setSymbolContext({ sourceContext: undefined, screenerRunId: undefined })}
            className="rounded p-0.5 hover:bg-primary/20"
            title="Dismiss context badge"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}

      {/* Three columns from lg up. Below lg they stack (chart and orders, then the ticket,
          then the watchlist) and this area scrolls, so every panel keeps a usable width. */}
      <div className="flex flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        {/* Left Watchlist */}
        <div className="order-3 w-full border-t border-border bg-panel lg:order-none lg:w-56 lg:shrink-0 lg:border-r lg:border-t-0">
          <Watchlist quotes={quoteMap as any} onSelect={(item) => setSymbolContext({ symbol: item.symbol, exchange: ((item as any).exchange as "NSE" | "BSE") || "NSE", sourceContext: "watchlist" })} />
        </div>

        {/* Main Chart and Bottom Tabs Area */}
        <div className="flex min-w-0 flex-col lg:flex-1 lg:overflow-hidden">
          {/* Chart Header Bar */}
          <div className="flex flex-wrap items-center justify-between border-b border-border bg-panel px-3 py-1.5 text-xs gap-2">
            <div className="flex items-center gap-3">
              <span className="font-bold text-foreground">{current.symbol}</span>
              <span className="text-muted-foreground hidden sm:inline">{current.name}</span>
              {currentPrice !== undefined && (
                <span className="font-mono font-semibold text-foreground">₹{currentPrice.toFixed(2)}</span>
              )}
              {currentChange !== undefined && (
                <span className={`font-mono text-[11px] font-medium ${currentChange >= 0 ? "text-bull" : "text-bear"}`}>
                  {currentChange >= 0 ? "+" : ""}{currentChange.toFixed(2)} ({currentChangePct?.toFixed(2)}%)
                </span>
              )}
              <span className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
                dataQuality === "live" ? "bg-bull/15 text-bull border border-bull/30" : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
              }`}>
                {dataSource === "angelone" ? "Angel One" : dataSource === "yahoo" ? "Yahoo" : dataSource ?? "Source unavailable"} · {dataQuality}
              </span>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Interval selector */}
              <div className="flex items-center gap-0.5 rounded border border-border bg-background p-0.5">
                {INTERVALS.map((tf) => (
                  <button
                    key={tf}
                    onClick={() => handleSetInterval(tf)}
                    className={`rounded px-1.5 py-0.5 text-[11px] font-medium transition ${
                      interval === tf ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {tf}
                  </button>
                ))}
              </div>

              {/* Chart type toggle */}
              <div className="flex items-center gap-0.5 rounded border border-border bg-background p-0.5 text-[11px]">
                <button
                  onClick={() => handleSetChartType("candle")}
                  className={`rounded px-2 py-0.5 font-medium transition ${chartType === "candle" ? "bg-accent text-foreground font-semibold" : "text-muted-foreground"}`}
                >
                  Candles
                </button>
                <button
                  onClick={() => handleSetChartType("line")}
                  className={`rounded px-2 py-0.5 font-medium transition ${chartType === "line" ? "bg-accent text-foreground font-semibold" : "text-muted-foreground"}`}
                >
                  Line
                </button>
              </div>

              {/* Indicators menu */}
              <div className="flex items-center gap-1 border-l border-border pl-2 text-[11px]">
                {(["sma", "ema", "rsi", "macd", "volume"] as const).map((key) => (
                  <button
                    key={key}
                    onClick={() => toggleIndicator(key)}
                    className={`rounded px-1.5 py-0.5 font-medium uppercase transition ${
                      indicators[key] ? "bg-primary/20 text-primary border border-primary/40" : "text-muted-foreground hover:bg-accent"
                    }`}
                  >
                    {key}
                  </button>
                ))}
              </div>

              {/* Navigation Actions */}
              <div className="flex items-center gap-1 border-l border-border pl-2 text-[11px]">
                <button
                  type="button"
                  onClick={() => void navigate({ to: `/chart/${active}` as any, search: { exchange: "NSE", sourceContext: "terminal" } as any })}
                  className="flex items-center gap-1 rounded px-2 py-0.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition"
                  title="Open full TradingView-style chart with drawings & indicators"
                >
                  <TrendingUp className="h-3 w-3 text-primary" />
                  Full Chart
                </button>
                <button
                  type="button"
                  onClick={() => void navigate({ to: "/backtest" as any, search: { symbol: active, sourceContext: "terminal" } as any })}
                  className="flex items-center gap-1 rounded px-2 py-0.5 font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition"
                  title="Test strategies on this symbol"
                >
                  <BarChart3 className="h-3 w-3 text-bull" />
                  Backtest
                </button>
              </div>
            </div>
          </div>

          {/* Chart Canvas */}
          <div className="min-h-[350px] overflow-hidden bg-background lg:min-h-0 lg:flex-1">
            {candles.length > 1 ? (
              <CandlestickChart
                data={candles}
                height={350}
                seriesType={chartType === "line" ? "line" : "candlestick"}
                indicators={indicators}
                chartState={{ zoom: 1, panOffset: 0, drawings: [] }}
                onChartStateChange={() => {}}
                drawingTool={null}
                trades={tradeMarkers}
                paperOverlay={paperOverlay}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {candleQuery.isError ? "Market candles are temporarily unavailable" : "Loading historical candles…"}
              </div>
            )}
          </div>

          {/* Locked/Liquidation Alert Banner */}
          {account && (account.status === "LIQUIDATION_PENDING" || account.status === "LIQUIDATED") && (
            <div className="flex items-center gap-3 border-t border-b border-bear/20 bg-bear/10 px-4 py-2.5 text-xs text-bear">
              <ShieldAlert className="h-4 w-4 animate-bounce" />
              <div>
                <strong>MARGIN CALL LIQUIDATION:</strong> Your open positions were auto-liquidated due to insufficient margin. Account is locked. Click <strong>Reset Account</strong> to start again.
              </div>
            </div>
          )}

          {/* Bottom Tabs Panel */}
          {status === "ready" && <div className="border-t border-border bg-panel flex shrink-0 flex-col h-60 overflow-hidden">
            <div className="flex items-center gap-1 border-b border-border bg-panel-elevated/40 px-3 text-xs">
              <button
                onClick={() => setActiveTab("positions")}
                className={`flex items-center gap-1.5 border-b-2 py-2 px-3 transition-all ${
                  activeTab === "positions" ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Positions ({positions.length})
              </button>
              <button
                onClick={() => setActiveTab("orders")}
                className={`flex items-center gap-1.5 border-b-2 py-2 px-3 transition-all ${
                  activeTab === "orders" ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Pending Orders ({workingOrders.length})
              </button>
              <button
                onClick={() => setActiveTab("history")}
                className={`flex items-center gap-1.5 border-b-2 py-2 px-3 transition-all ${
                  activeTab === "history" ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <History className="h-3.5 w-3.5" />
                Fills History ({fills.length})
              </button>
            </div>

            <div className="flex-1 overflow-auto p-2">
              {activeTab === "positions" && (
                <table className="w-full text-[11px] font-mono tabular-nums text-left">
                  <thead>
                    <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                      <th className="px-3 py-1.5">Symbol</th>
                      <th className="px-3 py-1.5 text-right">Quantity</th>
                      <th className="px-3 py-1.5 text-right">Avg Entry</th>
                      <th className="px-3 py-1.5 text-right">LTP</th>
                      <th className="px-3 py-1.5 text-right">PnL (Unrealized)</th>
                      <th className="px-3 py-1.5 text-right">Margin (5x)</th>
                      <th className="px-3 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {positions.map((pos: PaperPositionRow) => {
                      const quote = quoteMap.get(pos.symbol);
                      const avgPrice = Number(pos.averageEntryPrice);
                      const ltp = quote?.price ?? avgPrice;
                      const isShort = pos.side === "SHORT" || Number(pos.totalShares) < 0;
                      const signedQty = isShort ? -Math.abs(pos.totalShares) : Math.abs(pos.totalShares);
                      const pnl = calculateMarkedUnrealisedPnl({ quantity: signedQty, averagePrice: avgPrice }, ltp);

                      return (
                        <tr key={pos.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2 font-sans font-semibold text-foreground">
                            {pos.symbol}
                            <span className={`ml-1.5 inline-block text-[9px] px-1 py-0.2 rounded font-mono ${isShort ? "bg-bear/20 text-bear" : "bg-bull/20 text-bull"}`}>
                              {isShort ? "SHORT" : "LONG"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{Math.abs(pos.totalShares)}</td>
                          <td className="px-3 py-2 text-right">₹{avgPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">₹{ltp.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right font-bold ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">₹{Number(pos.marginLocked).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => {
                                void placeOrder(buildClosePositionOrder(pos));
                              }}
                              disabled={!isTradingAvailable}
                              className="rounded bg-bear hover:bg-bear/90 text-white px-2 py-0.5 text-[10px] font-semibold transition disabled:opacity-50"
                            >
                              Close Position
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {positions.length === 0 && (
                      <tr>
                        <td colSpan={7} className="px-3 py-10 text-center text-muted-foreground font-sans">
                          No open positions. Place an order to execute a trade.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === "orders" && (
                <table className="w-full text-[11px] font-mono tabular-nums text-left">
                  <thead>
                    <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                      <th className="px-3 py-1.5">Placed At</th>
                      <th className="px-3 py-1.5">Symbol</th>
                      <th className="px-3 py-1.5 text-right">Side</th>
                      <th className="px-3 py-1.5 text-right">Type</th>
                      <th className="px-3 py-1.5 text-right">Price</th>
                      <th className="px-3 py-1.5 text-right">Filled / Qty</th>
                      <th className="px-3 py-1.5 text-right">Remaining</th>
                      <th className="px-3 py-1.5 text-right">Avg Fill</th>
                      <th className="px-3 py-1.5 text-right">Status</th>
                      <th className="px-3 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {workingOrders.map((o: PaperOrderRow) => (
                        <tr key={o.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2 text-muted-foreground">
                            {new Date(o.placedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-3 py-2 font-sans font-semibold text-foreground">{o.symbol}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${o.side === "BUY" ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"}`}>
                              {o.side}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{o.type}</td>
                          <td className="px-3 py-2 text-right">{o.limitPrice ? `₹${Number(o.limitPrice).toFixed(2)}` : o.stopPrice ? `₹${Number(o.stopPrice).toFixed(2)}` : "MKT"}</td>
                          <td className="px-3 py-2 text-right">{o.filledQty}/{o.qty}</td>
                          <td className="px-3 py-2 text-right">{o.qty - o.filledQty}</td>
                          <td className="px-3 py-2 text-right">{o.filledQty > 0 && o.averageFillPrice ? `₹${Number(o.averageFillPrice).toFixed(2)}` : "—"}</td>
                          <td className="px-3 py-2 text-right">
                            <PaperOrderStatus status={o.status} />
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => cancelOrder(o.id)}
                              className="rounded bg-panel-elevated hover:bg-bear hover:text-white px-2 py-0.5 text-[10px] font-medium transition"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    {workingOrders.length === 0 && (
                      <tr>
                        <td colSpan={10} className="px-3 py-10 text-center text-muted-foreground font-sans">
                          No pending orders.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}

              {activeTab === "history" && (
                <table className="w-full text-[11px] font-mono tabular-nums text-left">
                  <thead>
                    <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                      <th className="px-3 py-1.5">Executed At</th>
                      <th className="px-3 py-1.5">Symbol</th>
                      <th className="px-3 py-1.5 text-right">Side</th>
                      <th className="px-3 py-1.5 text-right">Quantity</th>
                      <th className="px-3 py-1.5 text-right">Fill Price</th>
                      <th className="px-3 py-1.5 text-right">Slippage</th>
                      <th className="px-3 py-1.5 text-right">Fee</th>
                      <th className="px-3 py-1.5 text-right">Reason</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fills.map((f: PaperFillRow) => (
                      <tr key={f.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                        <td className="px-3 py-2 text-muted-foreground">
                          {new Date(f.executedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                        </td>
                        <td className="px-3 py-2 font-sans font-semibold text-foreground">{f.symbol}</td>
                        <td className="px-3 py-2 text-right">{f.side}</td>
                        <td className="px-3 py-2 text-right">{f.quantity}</td>
                        <td className="px-3 py-2 text-right">₹{Number(f.fillPrice).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">₹{Number(f.slippage).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right">₹{Number(f.fees).toFixed(2)}</td>
                        <td className="px-3 py-2 text-right text-muted-foreground">{f.executionReason}</td>
                      </tr>
                    ))}
                    {fills.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground font-sans">
                          No execution fills recorded yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>}
        </div>

        {/* Right Order Panel */}
        <div className="order-2 flex w-full flex-col border-t border-border bg-panel lg:order-none lg:w-72 lg:shrink-0 lg:border-l lg:border-t-0">
          <OrderPanel symbol={active} exchange={context.exchange} price={currentPrice} />
        </div>
      </div>
    </div>
  );
}
