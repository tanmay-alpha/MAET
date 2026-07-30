import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { CandlestickChartSimple as CandlestickChart } from "@/components/trading/candlestick-chart";
import { OrderPanel } from "@/components/trading/order-panel";
import { Watchlist } from "@/components/trading/watchlist";
import { useMarketCandles } from "@/hooks/use-market-candles";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import type { MarketCandle } from "@/lib/market-api";
import { WATCHLIST } from "@/lib/market-catalog";
import { ShieldAlert, RefreshCw, Layers, ClipboardList, History } from "lucide-react";
import { useTerminalStore } from "@/store/useTerminalStore";
import { DepthMeter } from "@/components/trading/depth-meter";
import type { PaperOrderRow, PaperPositionRow, PaperFillRow } from "../../server/modules/paper-trading/contracts";

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

  const { quoteMap } = useMarketQuotes(quoteSymbols);
  const { account, positions, orders, fills, placeOrder, cancelOrder, resetAccount, isTradingAvailable } = usePaperAccount();

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

  const { totalUnrealizedPnl, nav, freeMargin, marginUsagePercent } = useMemo(() => {
    let unrealized = 0;
    const cash = account ? Number(account.cashBalance) : 1000000;
    const allocated = account ? Number(account.allocatedMargin) : 0;

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
      totalUnrealizedPnl: unrealized,
      nav: netAssetVal,
      freeMargin: freeMarg,
      marginUsagePercent: Math.max(0, Math.min(100, usage)),
    };
  }, [positions, account, quoteMap]);

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
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Available Cash</span>
            <span className="font-mono text-xs font-semibold text-foreground">₹{account ? Number(account.cashBalance).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0.00"}</span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Allocated Margin (5x)</span>
            <span className="font-mono text-xs font-semibold text-foreground">₹{account ? Number(account.allocatedMargin).toLocaleString("en-IN", { maximumFractionDigits: 2 }) : "0.00"}</span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Unrealized P&L</span>
            <span className={`font-mono text-xs font-bold ${totalUnrealizedPnl >= 0 ? "text-bull" : "text-bear"}`}>
              {totalUnrealizedPnl >= 0 ? "+" : ""}₹{totalUnrealizedPnl.toLocaleString("en-IN", { maximumFractionDigits: 2 })}
            </span>
          </div>

          <div className="flex flex-col">
            <span className="text-[10px] uppercase tracking-wider text-muted-foreground">Free Margin</span>
            <span className="font-mono text-xs font-semibold text-foreground">₹{freeMargin.toLocaleString("en-IN", { maximumFractionDigits: 2 })}</span>
          </div>

          <div className="flex flex-col w-28">
            <div className="flex justify-between text-[9px] uppercase tracking-wider text-muted-foreground mb-1">
              <span>Margin Util</span>
              <span>{marginUsagePercent.toFixed(0)}%</span>
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
          <button
            onClick={() => resetAccount()}
            className="flex items-center gap-1.5 rounded border border-border bg-panel px-2.5 py-1 text-[11px] font-semibold text-muted-foreground hover:bg-accent hover:text-foreground transition"
            title="Reset paper account balance to initial cash"
          >
            <RefreshCw className="h-3 w-3" />
            Reset Account
          </button>
        </div>
      </div>

      <div className="flex flex-1 overflow-hidden">
        {/* Left Watchlist */}
        <div className="w-56 border-r border-border bg-panel">
          <Watchlist quotes={quoteMap as any} onSelect={() => {}} />
        </div>

        {/* Main Chart and Bottom Tabs Area */}
        <div className="flex flex-1 flex-col overflow-hidden">
          {/* Chart Header Bar */}
          <div className="flex items-center justify-between border-b border-border bg-panel px-3 py-1.5 text-xs">
            <div className="flex items-center gap-3">
              <span className="font-bold text-foreground">{current.symbol}</span>
              <span className="text-muted-foreground">{current.name}</span>
              {currentPrice !== undefined && (
                <span className="font-mono font-semibold text-foreground">₹{currentPrice.toFixed(2)}</span>
              )}
              {currentChange !== undefined && (
                <span className={`font-mono text-[11px] font-medium ${currentChange >= 0 ? "text-bull" : "text-bear"}`}>
                  {currentChange >= 0 ? "+" : ""}{currentChange.toFixed(2)} ({currentChangePct?.toFixed(2)}%)
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {INTERVALS.map((tf) => (
                <button
                  key={tf}
                  onClick={() => setInterval(tf)}
                  className={`rounded px-2 py-0.5 text-[11px] font-medium transition ${
                    interval === tf ? "bg-primary text-primary-foreground font-semibold" : "text-muted-foreground hover:bg-accent hover:text-foreground"
                  }`}
                >
                  {tf}
                </button>
              ))}
            </div>
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
          {account && (account.status === "LIQUIDATION_PENDING" || account.status === "LIQUIDATED") && (
            <div className="flex items-center gap-3 border-t border-b border-bear/20 bg-bear/10 px-4 py-2.5 text-xs text-bear">
              <ShieldAlert className="h-4 w-4 animate-bounce" />
              <div>
                <strong>MARGIN CALL LIQUIDATION:</strong> Your open positions were auto-liquidated due to insufficient margin. Account is locked. Click <strong>Reset Account</strong> to start again.
              </div>
            </div>
          )}

          {/* Bottom Tabs Panel */}
          <div className="border-t border-border bg-panel flex flex-col h-60 overflow-hidden">
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
                Pending Orders ({orders.filter((o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING").length})
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
                      const pnl = pos.totalShares * (ltp - avgPrice);

                      return (
                        <tr key={pos.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                          <td className="px-3 py-2 font-sans font-semibold text-foreground">{pos.symbol}</td>
                          <td className="px-3 py-2 text-right">{pos.totalShares}</td>
                          <td className="px-3 py-2 text-right">₹{avgPrice.toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">₹{ltp.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right font-bold ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                            {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)}
                          </td>
                          <td className="px-3 py-2 text-right">₹{Number(pos.marginLocked).toFixed(2)}</td>
                          <td className="px-3 py-2 text-right">
                            <button
                              onClick={() => {
                                placeOrder({
                                  symbol: pos.symbol,
                                  exchange: "NSE",
                                  side: "SELL",
                                  type: "MARKET",
                                  quantity: pos.totalShares,
                                });
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
                      <th className="px-3 py-1.5 text-right">Quantity</th>
                      <th className="px-3 py-1.5 text-right">Status</th>
                      <th className="px-3 py-1.5 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {orders
                      .filter((o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING")
                      .map((o: PaperOrderRow) => (
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
                          <td className="px-3 py-2 text-right">₹{o.limitPrice ? Number(o.limitPrice).toFixed(2) : o.stopPrice ? Number(o.stopPrice).toFixed(2) : "MKT"}</td>
                          <td className="px-3 py-2 text-right">{o.qty}</td>
                          <td className="px-3 py-2 text-right font-semibold text-amber-500">{o.status}</td>
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
                    {orders.filter((o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING").length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-3 py-10 text-center text-muted-foreground font-sans">
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
          </div>
        </div>

        {/* Right Order Panel & Depth */}
        <div className="w-72 border-l border-border bg-panel flex flex-col">
          <OrderPanel symbol={active} price={currentPrice} />
          <div className="border-t border-border p-2">
            <DepthMeter />
          </div>
        </div>
      </div>
    </div>
  );
}
