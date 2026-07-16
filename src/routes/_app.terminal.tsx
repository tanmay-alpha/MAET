import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { CandlestickChartSimple as CandlestickChart } from "@/components/trading/candlestick-chart";
import { OrderPanel } from "@/components/trading/order-panel";
import { Watchlist } from "@/components/trading/watchlist";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { settlePaperOrders, usePaperAccount } from "@/hooks/use-paper-account";
import type { MarketCandle } from "@/lib/market-api";
import { WATCHLIST, type MarketCatalogItem } from "@/lib/market-catalog";
import { Clock, ShieldAlert, Ban, RefreshCw, Layers, ClipboardList, History, ArrowUpRight, ArrowDownRight } from "lucide-react";
import { useTerminalStore } from "@/store/useTerminalStore";
import { DepthMeter } from "@/components/trading/depth-meter";

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

function Terminal() {
  const active = useTerminalStore((state) => state.activeSymbol);
  const [interval, setInterval] = useState("5m");
  const [activeTab, setActiveTab] = useState<"positions" | "orders" | "history">("positions");
  
  const current = useMemo(() => {
    return WATCHLIST.find((item) => item.symbol === active) || { symbol: active, name: active };
  }, [active]);
  const quoteSymbols = useMemo(() => {
    return [...new Set([...WATCHLIST_SYMBOLS, active])];
  }, [active]);

  const { quoteMap, streamConnected, isError: quoteError } = useMarketQuotes(quoteSymbols);
  const { account, placeOrder, cancelOrder, reset } = usePaperAccount();

  const liveQuote = quoteMap.get(active);
  const intervalConfig = INTERVAL_CONFIG[interval];
  const candleQuery = useMarketCandles(active, intervalConfig.timeframe, intervalConfig.range);
  
  const candles = useMemo(() => {
    return (candleQuery.data?.candles ?? []).map((candle) => ({
      t: new Date(candle.ts).getTime(),
      o: candle.open,
      h: candle.high,
      l: candle.low,
      c: candle.close,
      v: candle.volume,
    }));
  }, [candleQuery.data?.candles]);

  const currentPrice = liveQuote?.price;
  const currentChange = liveQuote?.change;
  const currentChangePct = liveQuote?.changePct;
  const lastCandle = candles[candles.length - 1];

  // Auto-settle orders when quotes change
  useEffect(() => {
    settlePaperOrders(quoteMap);
  }, [quoteMap]);

  // Recalculate Net Asset Value (NAV) dynamically in the UI
  const { totalUnrealizedPnl, nav, freeMargin, marginUsagePercent } = useMemo(() => {
    let unrealized = 0;
    account.positions.forEach((pos) => {
      const q = quoteMap.get(pos.symbol);
      const ltp = q?.price ?? pos.avgPrice;
      const pnl = pos.qty > 0 ? pos.qty * (ltp - pos.avgPrice) : Math.abs(pos.qty) * (pos.avgPrice - ltp);
      unrealized += pnl;
    });

    const netAssetVal = account.cash + unrealized;
    const freeMarg = netAssetVal - account.allocatedMargin;
    const usage = netAssetVal > 0 ? (account.allocatedMargin / netAssetVal) * 100 : 0;

    return {
      totalUnrealizedPnl: unrealized,
      nav: netAssetVal,
      freeMargin: freeMarg,
      marginUsagePercent: Math.max(0, Math.min(100, usage)),
    };
  }, [account.positions, account.cash, account.allocatedMargin, quoteMap]);

  return (
    <div className="flex h-[calc(100vh-7rem)] flex-col bg-background">
      {/* Top Account Summary Dashboard Bar */}
      <div className="flex flex-wrap items-center justify-between border-b border-border bg-panel/40 px-4 py-2 text-xs">
        <div className="flex flex-wrap items-center gap-6">
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Net Asset Value (NAV)</span>
            <span className="font-mono text-sm font-bold text-foreground">₹{nav.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Cash Balance</span>
            <span className="font-mono text-sm font-semibold text-foreground">₹{account.cash.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Unrealized P&L</span>
            <span className={`font-mono text-sm font-semibold flex items-center ${totalUnrealizedPnl >= 0 ? "text-bull" : "text-bear"}`}>
              {totalUnrealizedPnl >= 0 ? <ArrowUpRight className="h-3 w-3 mr-0.5" /> : <ArrowDownRight className="h-3 w-3 mr-0.5" />}
              ₹{totalUnrealizedPnl.toFixed(2)}
            </span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Locked Margin (5x)</span>
            <span className="font-mono text-sm font-semibold text-foreground">₹{account.allocatedMargin.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>
          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Free Margin</span>
            <span className={`font-mono text-sm font-semibold ${freeMargin >= 0 ? "text-foreground" : "text-bear font-bold"}`}>
              ₹{freeMargin.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>
          <div className="flex flex-col w-28">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground flex justify-between">
              <span>Margin Usage</span>
              <span className="font-mono font-medium text-foreground">{marginUsagePercent.toFixed(0)}%</span>
            </span>
            <div className="mt-1 h-1.5 w-full rounded-full bg-border overflow-hidden">
              <div 
                className={`h-full rounded-full transition-all duration-300 ${
                  marginUsagePercent > 80 ? "bg-bear animate-pulse" : marginUsagePercent > 50 ? "bg-yellow-500" : "bg-primary"
                }`}
                style={{ width: `${marginUsagePercent}%` }}
              />
            </div>
          </div>
        </div>

        <button 
          onClick={() => window.confirm("Are you sure you want to reset your paper account cash to ₹1,000,000 and wipe all trades?") && reset()}
          className="flex items-center gap-1.5 rounded border border-border bg-panel px-2.5 py-1 text-[11px] font-medium text-muted-foreground hover:bg-accent hover:text-foreground transition-all"
        >
          <RefreshCw className="h-3 w-3" />
          Reset Account
        </button>
      </div>

      {/* Main Terminal Viewport Grid */}
      <div className="grid flex-1 grid-cols-[250px_1fr_270px] overflow-hidden">
        {/* Left pane: Watchlist */}
        <div className="border-r border-border overflow-y-auto">
          <Watchlist onSelect={(item) => useTerminalStore.getState().setActiveSymbol(item.symbol)} quotes={quoteMap} />
        </div>

        {/* Middle pane: Chart & Position Panel */}
        <div className="flex flex-col overflow-hidden">
          {/* Symbol header bar */}
          <div className="flex items-center justify-between border-b border-border bg-panel px-4 py-2">
            <div className="flex items-baseline gap-2">
              <span className="text-base font-semibold text-foreground">{current.symbol}</span>
              <span className="text-xs text-muted-foreground">{current.name} · NSE</span>
            </div>
            <div className="flex items-baseline gap-4">
              <span className="font-mono text-lg font-bold text-foreground">{currentPrice?.toFixed(2) ?? "—"}</span>
              <span className={`font-mono text-xs font-semibold ${(currentChange ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                {currentChange === undefined
                  ? "Loading quote"
                  : `${currentChange >= 0 ? "+" : ""}${currentChange.toFixed(2)} (${(currentChangePct ?? 0).toFixed(2)}%)`}
              </span>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                {quoteError ? "Feed Offline" : streamConnected ? "● Live Stream" : "Connecting"}
              </span>
            </div>
          </div>

          {/* Timeframe selector bar */}
          <div className="flex items-center gap-1 border-b border-border bg-panel px-3 py-1 text-xs">
            {INTERVALS.map((item) => (
              <button
                key={item}
                onClick={() => setInterval(item)}
                className={`rounded px-2 py-0.5 text-[11px] transition-all ${
                  interval === item ? "bg-accent text-foreground font-semibold" : "text-muted-foreground hover:text-foreground"
                }`}
              >
                {item}
              </button>
            ))}
            <div className="mx-2 h-4 w-px bg-border" />
            <span className="rounded px-2 py-0.5 text-[11px] text-primary bg-primary/10 border border-primary/20 font-medium">Candlesticks</span>
            {lastCandle && (
              <div className="ml-auto flex items-center gap-2.5 text-[10px] font-mono tabular-nums text-muted-foreground">
                <span>O <span className="text-foreground">{lastCandle.o.toFixed(2)}</span></span>
                <span>H <span className="text-bull">{lastCandle.h.toFixed(2)}</span></span>
                <span>L <span className="text-bear">{lastCandle.l.toFixed(2)}</span></span>
                <span>C <span className="text-foreground">{lastCandle.c.toFixed(2)}</span></span>
              </div>
            )}
          </div>

          {/* Chart Canvas */}
          <div className="flex-1 overflow-hidden bg-background">
            {candles.length > 1 ? (
              <CandlestickChart data={candles} height={350} />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                {candleQuery.isError ? "Market candles are temporarily unavailable" : "Loading historical candles…"}
              </div>
            )}
          </div>

          {/* Locked/Liquidation Alert Banner */}
          {account.isLocked && (
            <div className="flex items-center gap-3 border-t border-b border-bear/20 bg-bear/10 px-4 py-2.5 text-xs text-bear">
              <ShieldAlert className="h-4 w-4 animate-bounce" />
              <div>
                <strong>MARGIN CALL LIQUIDATION:</strong> Your open positions were auto-liquidated due to insufficient margin. Account is locked. Click <strong>Reset Account</strong> to start again.
              </div>
            </div>
          )}

          {/* Bottom Tabs Panel: Positions / Pending Orders / History */}
          <div className="border-t border-border bg-panel flex flex-col h-60 overflow-hidden">
            <div className="flex items-center gap-1 border-b border-border bg-panel-elevated/40 px-3 text-xs">
              <button 
                onClick={() => setActiveTab("positions")}
                className={`flex items-center gap-1.5 border-b-2 py-2 px-3 transition-all ${
                  activeTab === "positions" ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <Layers className="h-3.5 w-3.5" />
                Positions ({account.positions.length})
              </button>
              <button 
                onClick={() => setActiveTab("orders")}
                className={`flex items-center gap-1.5 border-b-2 py-2 px-3 transition-all ${
                  activeTab === "orders" ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <ClipboardList className="h-3.5 w-3.5" />
                Pending Orders ({account.orders.filter(o => o.status === "pending" || o.status === "partial").length})
              </button>
              <button 
                onClick={() => setActiveTab("history")}
                className={`flex items-center gap-1.5 border-b-2 py-2 px-3 transition-all ${
                  activeTab === "history" ? "border-primary text-foreground font-semibold" : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                <History className="h-3.5 w-3.5" />
                Execution History
              </button>
            </div>

            <div className="flex-1 overflow-auto p-2">
              {activeTab === "positions" && (
                <table className="w-full text-[11px] font-mono tabular-nums text-left">
                  <thead>
                    <tr className="text-[10px] uppercase text-muted-foreground border-b border-border">
                      <th className="px-3 py-1.5">Symbol</th>
                      <th className="px-3 py-1.5 text-right">Direction</th>
                      <th className="px-3 py-1.5 text-right">Quantity</th>
                      <th className="px-3 py-1.5 text-right">Avg Entry</th>
                      <th className="px-3 py-1.5 text-right">LTP</th>
                      <th className="px-3 py-1.5 text-right">PnL (Unrealized)</th>
                      <th className="px-3 py-1.5 text-right">Margin (5x)</th>
                      <th className="px-3 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.positions.map((pos) => {
                      const quote = quoteMap.get(pos.symbol);
                      const ltp = quote?.price ?? pos.avgPrice;
                      const isLong = pos.qty > 0;
                      const pnl = isLong ? pos.qty * (ltp - pos.avgPrice) : Math.abs(pos.qty) * (pos.avgPrice - ltp);
                      const pnlPct = (pnl / (Math.abs(pos.qty) * pos.avgPrice)) * 100 * 5; // Leveraged return (5x)

                      return (
                        <tr key={pos.symbol} className="border-b border-border hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2 font-sans font-semibold text-foreground">{pos.symbol}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`rounded px-1.5 py-0.5 text-[9px] font-bold ${isLong ? "bg-bull/10 text-bull" : "bg-bear/10 text-bear"}`}>
                              {isLong ? "LONG" : "SHORT"}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">{Math.abs(pos.qty)}</td>
                          <td className="px-3 py-2 text-right">₹{pos.avgPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">₹{ltp.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right font-bold ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)} ({pnlPct.toFixed(2)}%)
                          </td>
                          <td className="px-3 py-2 text-right">₹{pos.marginLocked.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => {
                                placeOrder({
                                  symbol: pos.symbol,
                                  side: isLong ? "SELL" : "BUY",
                                  qty: Math.abs(pos.qty),
                                  type: "MARKET",
                                });
                              }}
                              className="rounded bg-bear hover:bg-bear/90 text-white px-2 py-0.5 text-[10px] font-semibold transition"
                            >
                              Exit Position
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                    {account.positions.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground font-sans">
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
                      <th className="px-3 py-1.5 text-right">Quantity</th>
                      <th className="px-3 py-1.5 text-right">Status</th>
                      <th className="px-3 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.orders
                      .filter(o => o.status === "pending" || o.status === "partial")
                      .map((o) => (
                        <tr key={o.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2 text-muted-foreground">
                            {new Date(o.placedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                          </td>
                          <td className="px-3 py-2 font-sans font-semibold text-foreground">{o.symbol}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-bold ${o.side === "BUY" ? "text-bull" : "text-bear"}`}>{o.side}</span>
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">{o.type}</td>
                          <td className="px-3 py-2 text-right">
                            {o.type === "LIMIT" 
                              ? `Limit: ₹${Number(o.limitPrice).toFixed(2)}` 
                              : `Trigger Stop: ₹${Number(o.stopPrice).toFixed(2)}`
                            }
                          </td>
                          <td className="px-3 py-2 text-right">
                            {o.status === "partial" ? `${o.filledQty}/${o.qty}` : o.qty}
                          </td>
                          <td className="px-3 py-2 text-right">
                            <span className="text-yellow-500 font-semibold uppercase text-[9px] border border-yellow-500/20 bg-yellow-500/10 px-1.5 py-0.5 rounded-full">
                              {o.status}
                            </span>
                          </td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => cancelOrder(o.id)}
                              className="rounded border border-border hover:bg-accent text-foreground px-2 py-0.5 text-[10px] font-semibold transition"
                            >
                              Cancel
                            </button>
                          </td>
                        </tr>
                      ))}
                    {account.orders.filter(o => o.status === "pending" || o.status === "partial").length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground font-sans">
                          No pending limit or trigger orders.
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
                      <th className="px-3 py-1.5">Placed At</th>
                      <th className="px-3 py-1.5">Symbol</th>
                      <th className="px-3 py-1.5 text-right">Side</th>
                      <th className="px-3 py-1.5 text-right">Qty</th>
                      <th className="px-3 py-1.5 text-right">Avg Fill</th>
                      <th className="px-3 py-1.5 text-right">Slippage</th>
                      <th className="px-3 py-1.5 text-right">Fees</th>
                      <th className="px-3 py-1.5 text-right">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {account.orders
                      .filter(o => o.status !== "pending" && o.status !== "partial")
                      .map((o) => (
                        <tr key={o.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2 text-muted-foreground">
                            {new Date(o.placedAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}
                          </td>
                          <td className="px-3 py-2 font-sans font-semibold text-foreground">{o.symbol}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`font-bold ${o.side === "BUY" ? "text-bull" : "text-bear"}`}>{o.side}</span>
                          </td>
                          <td className="px-3 py-2 text-right">{o.filledQty || o.qty}</td>
                          <td className="px-3 py-2 text-right">
                            {o.averageFillPrice ? `₹${o.averageFillPrice.toFixed(2)}` : "—"}
                          </td>
                          <td className="px-3 py-2 text-right text-muted-foreground">₹{o.slippageApplied.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right text-muted-foreground">₹{o.transactionFee.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            <span className={`inline-block font-semibold uppercase text-[9px] border px-1.5 py-0.5 rounded-full ${
                              o.status === "filled" ? "border-green-500/20 bg-green-500/10 text-green-500" :
                              o.status === "rejected" ? "border-red-500/20 bg-red-500/10 text-red-500" :
                              "border-border bg-panel-elevated text-muted-foreground"
                            }`}>
                              {o.status}
                              {o.rejectReason && ` (${o.rejectReason})`}
                            </span>
                          </td>
                        </tr>
                      ))}
                    {account.orders.filter(o => o.status !== "pending" && o.status !== "partial").length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground font-sans">
                          No historical executions.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>

        {/* Right pane: Order entry panel & Market Depth */}
        <div className="border-l border-border flex flex-col gap-4 overflow-y-auto bg-panel p-3">
          <OrderPanel
            symbol={active}
            price={currentPrice}
            availableCash={account.cash}
            onPlace={placeOrder}
          />
          <DepthMeter />
        </div>
      </div>
    </div>
  );
}
