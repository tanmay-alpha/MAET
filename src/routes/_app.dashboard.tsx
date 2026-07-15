import { createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowDownRight, ArrowUpRight, ReceiptText, TrendingUp, Wallet } from "lucide-react";
import { useMemo } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { INDICES } from "@/lib/market-catalog";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — MAET" }] }),
  component: Dashboard,
});

const INDEX_KEYS: Record<string, string> = {
  "NIFTY 50": "NIFTY50",
  "BANK NIFTY": "BANKNIFTY",
  SENSEX: "SENSEX",
  "NIFTY IT": "NIFTYIT",
  "NIFTY FMCG": "NIFTYFMCG",
  "INDIA VIX": "INDIAVIX",
};

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function StatCard({
  icon: Icon,
  label,
  value,
  sub,
  trend,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  sub: string;
  trend: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4">
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular tabular-nums">{value}</div>
      <div className={`mt-1 flex items-center gap-1 font-mono text-xs tabular tabular-nums ${trend === "up" ? "text-bull" : trend === "down" ? "text-bear" : "text-muted-foreground"}`}>
        {trend === "up" && <ArrowUpRight className="h-3 w-3" />}
        {trend === "down" && <ArrowDownRight className="h-3 w-3" />}
        {sub}
      </div>
    </div>
  );
}

function Dashboard() {
  const { account, reset } = usePaperAccount();
  const symbols = useMemo(
    () => [...new Set([...account.positions.map((position) => position.symbol), ...Object.values(INDEX_KEYS)])],
    [account.positions]
  );
  const { quoteMap, streamConnected, isError } = useMarketQuotes(symbols);
  const unrealizedPnl = account.positions.reduce((total, position) => {
    const ltp = quoteMap.get(position.symbol)?.price;
    return total + (ltp === undefined ? 0 : (ltp - position.avgPrice) * position.qty);
  }, 0);
  const positionsValue = account.positions.reduce((total, position) => {
    const mark = quoteMap.get(position.symbol)?.price ?? position.avgPrice;
    return total + mark * position.qty;
  }, 0);
  const equity = account.cash + positionsValue;
  const totalPnl = equity - account.initialCash;
  const filledOrders = account.orders.filter((order) => order.status === "filled").length;
  const pendingOrders = account.orders.filter((order) => order.status === "pending").length;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex items-end justify-between">
        <div>
          <h1 className="text-xl font-semibold">Paper trading dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {isError ? "Market quote service unavailable" : streamConnected ? "● Angel One Live Feed (NSE Stream Connected)" : "Connecting to market quotes"}
            {" · "}paper account is stored in this browser
          </p>
        </div>
        <button
          type="button"
          onClick={() => window.confirm("Reset all paper positions and orders?") && reset()}
          className="rounded-md border border-border bg-panel px-3 py-1.5 text-xs hover:bg-accent"
        >
          Reset paper account
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <StatCard icon={Wallet} label="Paper equity" value={money(equity)} sub={`${money(account.cash)} cash`} trend="flat" />
        <StatCard icon={Activity} label="Total P&L" value={money(totalPnl)} sub="Since account reset" trend={totalPnl > 0 ? "up" : totalPnl < 0 ? "down" : "flat"} />
        <StatCard icon={TrendingUp} label="Unrealized" value={money(unrealizedPnl)} sub={`${money(account.realizedPnl)} realized`} trend={unrealizedPnl > 0 ? "up" : unrealizedPnl < 0 ? "down" : "flat"} />
        <StatCard icon={ReceiptText} label="Paper orders" value={String(account.orders.length)} sub={`${filledOrders} filled · ${pendingOrders} pending`} trend="flat" />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <div className="rounded-lg border border-border bg-panel lg:col-span-2">
          <div className="border-b border-border px-4 py-3">
            <div className="text-sm font-medium">Open paper positions</div>
            <div className="text-xs text-muted-foreground">Marked against the current Yahoo quote when available</div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr><th className="px-4 py-2 text-left">Symbol</th><th className="text-right">Qty</th><th className="text-right">Avg</th><th className="text-right">LTP</th><th className="px-4 text-right">P&amp;L</th></tr>
              </thead>
              <tbody>
                {account.positions.map((position) => {
                  const ltp = quoteMap.get(position.symbol)?.price;
                  const pnl = ltp === undefined ? undefined : (ltp - position.avgPrice) * position.qty;
                  return (
                    <tr key={position.symbol} className="border-t border-border">
                      <td className="px-4 py-2.5 font-medium">{position.symbol}</td>
                      <td className="text-right font-mono tabular tabular-nums">{position.qty}</td>
                      <td className="text-right font-mono tabular tabular-nums">{position.avgPrice.toFixed(2)}</td>
                      <td className="text-right font-mono tabular tabular-nums">{ltp?.toFixed(2) ?? "—"}</td>
                      <td className={`px-4 text-right font-mono tabular tabular-nums ${(pnl ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                        {pnl === undefined ? "—" : `${pnl >= 0 ? "+" : ""}${pnl.toFixed(2)}`}
                      </td>
                    </tr>
                  );
                })}
                {account.positions.length === 0 && (
                  <tr className="border-t border-border"><td colSpan={5} className="px-4 py-10 text-center text-muted-foreground">No paper positions yet. Use the terminal to place one.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-4 py-3 text-sm font-medium">Live indices</div>
          <div className="divide-y divide-border">
            {INDICES.map((index) => {
              const quote = quoteMap.get(INDEX_KEYS[index.symbol]);
              return (
                <div key={index.symbol} className="flex items-center justify-between px-4 py-2.5 text-xs">
                  <div className="font-medium">{index.symbol}</div>
                  <div className="text-right">
                    <div className="font-mono tabular tabular-nums">{quote?.price.toLocaleString("en-IN") ?? "—"}</div>
                    <div className={`font-mono text-[10px] tabular tabular-nums ${(quote?.changePct ?? 0) >= 0 ? "text-bull" : "text-bear"}`}>
                      {quote?.changePct === undefined ? "Waiting for quote" : `${quote.changePct >= 0 ? "+" : ""}${quote.changePct.toFixed(2)}%`}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-panel">
        <div className="border-b border-border px-4 py-3">
          <div className="text-sm font-medium">Recent paper orders</div>
          <div className="text-xs text-muted-foreground">These are simulated executions; no broker request is made.</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
              <tr><th className="px-4 py-2 text-left">Time</th><th className="text-left">Symbol</th><th>Side</th><th className="text-right">Qty</th><th className="text-right">Fill/trigger</th><th className="px-4 text-right">Status</th></tr>
            </thead>
            <tbody>
              {account.orders.slice(0, 20).map((order) => (
                <tr key={order.id} className="border-t border-border">
                  <td className="px-4 py-2.5 font-mono tabular tabular-nums text-muted-foreground">{new Date(order.placedAt).toLocaleTimeString("en-IN")}</td>
                  <td className="font-medium">{order.symbol}</td>
                  <td className="text-center"><span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${order.side === "BUY" ? "bg-bull/20 text-bull" : "bg-bear/20 text-bear"}`}>{order.side}</span></td>
                  <td className="text-right font-mono tabular tabular-nums">{order.qty}</td>
                  <td className="text-right font-mono tabular tabular-nums">{(order.fillPrice ?? order.triggerPrice)?.toFixed(2) ?? "—"}</td>
                  <td className={`px-4 text-right ${order.status === "filled" ? "text-bull" : order.status === "rejected" ? "text-bear" : "text-muted-foreground"}`} title={order.rejectReason}>{order.status}</td>
                </tr>
              ))}
              {account.orders.length === 0 && (
                <tr className="border-t border-border"><td colSpan={6} className="px-4 py-10 text-center text-muted-foreground">No paper orders recorded.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="mt-4 rounded-lg border border-border bg-panel px-4 py-8 text-center">
        <div className="text-sm font-medium">No saved strategy runs</div>
        <div className="mt-1 text-xs text-muted-foreground">The previous performance table contained demo numbers and has been removed.</div>
      </div>
    </div>
  );
}
