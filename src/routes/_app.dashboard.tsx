import { createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowDownRight, ArrowUpRight, ReceiptText, TrendingUp, Wallet, PlusCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { INDICES } from "@/lib/market-catalog";
import { QuickTradeModal } from "@/components/trading/quick-trade-modal";
import type { PaperPositionRow, PaperOrderRow } from "../../server/modules/paper-trading/contracts";

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
  const { account, positions, orders, fills, resetAccount } = usePaperAccount();
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; side: "BUY" | "SELL" }>({
    isOpen: false,
    symbol: "",
    side: "BUY",
  });

  const symbols = useMemo(
    () => [...new Set([...positions.map((position) => position.symbol), ...Object.values(INDEX_KEYS)])],
    [positions]
  );
  const { quoteMap, streamConnected, isError } = useMarketQuotes(symbols);

  const cash = account ? Number(account.cashBalance) : 1000000;
  const initialCash = account ? Number(account.initialCash) : 1000000;

  const unrealizedPnl = positions.reduce((total, position: PaperPositionRow) => {
    const avgPrice = Number(position.averageEntryPrice);
    const ltp = quoteMap.get(position.symbol)?.price;
    return total + (ltp === undefined ? 0 : (ltp - avgPrice) * position.totalShares);
  }, 0);

  const positionsValue = positions.reduce((total, position: PaperPositionRow) => {
    const avgPrice = Number(position.averageEntryPrice);
    const mark = quoteMap.get(position.symbol)?.price ?? avgPrice;
    return total + mark * position.totalShares;
  }, 0);

  const equity = cash + positionsValue;
  const totalPnl = equity - initialCash;
  const filledOrders = orders.filter((o: PaperOrderRow) => o.status === "FILLED").length;
  const pendingOrders = orders.filter((o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING").length;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Paper trading dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {isError ? "Market quote service unavailable" : streamConnected ? "● Angel One Live Feed (NSE Stream Connected)" : "Connecting to market quotes"}
            {" · "}Backend authoritative state
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTradeModal({ isOpen: true, symbol: "", side: "BUY" })}
            className="flex items-center gap-1.5 rounded-md bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-1.5 text-xs font-bold transition-all shadow"
          >
            <PlusCircle className="h-4 w-4" />
            Quick Trade
          </button>
          <button
            type="button"
            onClick={() => window.confirm("Reset paper account to initial cash?") && resetAccount()}
            className="rounded border border-border bg-panel px-3 py-1.5 text-xs hover:bg-accent font-medium transition-all"
          >
            Reset
          </button>
        </div>
      </div>

      {/* Index ticker row */}
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {INDICES.map((item) => {
          const key = INDEX_KEYS[item.symbol] ?? item.symbol;
          const q = quoteMap.get(key);
          const price = q?.price ?? 0;
          const changePct = q?.changePct ?? 0;
          const isUp = changePct >= 0;
          return (
            <div key={item.symbol} className="rounded border border-border bg-panel p-2.5">
              <div className="text-[10px] text-muted-foreground">{item.symbol}</div>
              <div className="font-mono text-sm font-semibold tabular tabular-nums">
                ₹{price.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </div>
              <div className={`font-mono text-[10px] font-medium ${isUp ? "text-bull" : "text-bear"}`}>
                {isUp ? "+" : ""}{changePct.toFixed(2)}%
              </div>
            </div>
          );
        })}
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Portfolio equity"
          value={money(equity)}
          sub={`Cash: ${money(cash)}`}
          trend={totalPnl >= 0 ? "up" : "down"}
        />
        <StatCard
          icon={TrendingUp}
          label="Unrealized P&L"
          value={money(unrealizedPnl)}
          sub={`${unrealizedPnl >= 0 ? "+" : ""}${((unrealizedPnl / initialCash) * 100).toFixed(2)}% return`}
          trend={unrealizedPnl >= 0 ? "up" : "down"}
        />
        <StatCard
          icon={ReceiptText}
          label="Open positions"
          value={String(positions.length)}
          sub={`Position value ${money(positionsValue)}`}
          trend="flat"
        />
        <StatCard
          icon={Activity}
          label="Orders status"
          value={String(orders.length)}
          sub={`${filledOrders} filled · ${pendingOrders} pending`}
          trend="flat"
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-panel p-4">
        <h2 className="mb-3 font-semibold text-sm">Positions overview</h2>
        {positions.length > 0 ? (
          <div className="overflow-x-auto">
            <table className="w-full text-xs font-mono tabular-nums text-left">
              <thead>
                <tr className="border-b border-border text-[10px] text-muted-foreground uppercase">
                  <th className="py-2">Symbol</th>
                  <th className="py-2 text-right">Shares</th>
                  <th className="py-2 text-right">Avg Entry</th>
                  <th className="py-2 text-right">LTP</th>
                  <th className="py-2 text-right">Unrealized P&L</th>
                </tr>
              </thead>
              <tbody>
                {positions.map((pos: PaperPositionRow) => {
                  const avgPrice = Number(pos.averageEntryPrice);
                  const ltp = quoteMap.get(pos.symbol)?.price ?? avgPrice;
                  const pnl = (ltp - avgPrice) * pos.totalShares;
                  return (
                    <tr key={pos.id} className="border-b border-border/50">
                      <td className="py-2 font-sans font-medium">{pos.symbol}</td>
                      <td className="py-2 text-right">{pos.totalShares}</td>
                      <td className="py-2 text-right">₹{avgPrice.toFixed(2)}</td>
                      <td className="py-2 text-right">₹{ltp.toFixed(2)}</td>
                      <td className={`py-2 text-right font-bold ${pnl >= 0 ? "text-bull" : "text-bear"}`}>
                        {pnl >= 0 ? "+" : ""}₹{pnl.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="py-8 text-center text-xs text-muted-foreground">
            No active positions.
          </div>
        )}
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
