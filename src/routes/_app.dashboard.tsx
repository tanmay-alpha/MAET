import { createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowDownRight, ArrowUpRight, ReceiptText, TrendingUp, Wallet, PlusCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { quoteFeedLabel } from "@/lib/quote-status";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useSignedIn } from "@/hooks/use-signed-in";
import { PaperAccountGate } from "@/components/trading/paper-account-gate";
import { QuickTradeModal } from "@/components/trading/quick-trade-modal";
import { ResetAccountButton } from "@/components/trading/reset-account-button";
import type { PaperPositionRow, PaperOrderRow } from "../../server/modules/paper-trading/contracts";
import { calculateMarkedUnrealisedPnl } from "@shared/domain/paper-trading/margin";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — MAET" }] }),
  component: Dashboard,
});

const INDEX_KEYS = ["NIFTY50", "BANKNIFTY", "SENSEX", "NIFTYIT", "NIFTYFMCG", "INDIAVIX"];

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
  const signedIn = useSignedIn();
  const { account, positions, orders, resetAccount } = usePaperAccount();
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; side: "BUY" | "SELL" }>({
    isOpen: false,
    symbol: "",
    side: "BUY",
  });

  const symbols = useMemo(
    () => [...new Set([...positions.map((position) => position.symbol), ...INDEX_KEYS])],
    [positions]
  );
  const { quoteMap, isError, delayed, marketPhase } = useMarketQuotes(symbols);

  const cash = account ? Number(account.cashBalance) : 1000000;
  const initialCash = account ? Number(account.initialCash) : 1000000;

  const unrealizedPnl = positions.reduce((total, position: PaperPositionRow) => {
    const avgPrice = Number(position.averageEntryPrice);
    const ltp = quoteMap.get(position.symbol)?.price ?? avgPrice;
    const isShort = position.side === "SHORT" || position.totalShares < 0;
    const signedQty = isShort ? -Math.abs(position.totalShares) : Math.abs(position.totalShares);
    return total + calculateMarkedUnrealisedPnl({ quantity: signedQty, averagePrice: avgPrice }, ltp);
  }, 0);

  const positionsValue = positions.reduce((total, position: PaperPositionRow) => {
    const avgPrice = Number(position.averageEntryPrice);
    const mark = quoteMap.get(position.symbol)?.price ?? avgPrice;
    return total + mark * Math.abs(position.totalShares);
  }, 0);

  const equity = cash + unrealizedPnl;
  const totalPnl = equity - initialCash;
  const filledOrders = orders.filter((o: PaperOrderRow) => o.status === "FILLED").length;
  const pendingOrders = orders.filter((o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING").length;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Paper trading dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {quoteFeedLabel({ isError, delayed, marketPhase })}
            {signedIn && " · Backend authoritative state"}
          </p>
        </div>
        {signedIn && <div className="flex gap-2">
          <button
            type="button"
            onClick={() => setTradeModal({ isOpen: true, symbol: "", side: "BUY" })}
            className="flex items-center gap-1.5 rounded-md bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-1.5 text-xs font-bold transition-all shadow"
          >
            <PlusCircle className="h-4 w-4" />
            Quick Trade
          </button>
          <ResetAccountButton
            onReset={resetAccount}
            confirmMessage="Reset paper account to initial cash?"
            className="rounded border border-border bg-panel px-3 py-1.5 text-xs hover:bg-accent font-medium transition-all"
          >
            Reset
          </ResetAccountButton>
        </div>}
      </div>


      <PaperAccountGate signedIn={signedIn}>
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
                  <th className="py-2">Side</th>
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
                  const isShort = pos.side === "SHORT" || pos.totalShares < 0;
                  const signedQty = isShort ? -Math.abs(pos.totalShares) : Math.abs(pos.totalShares);
                  const pnl = calculateMarkedUnrealisedPnl(
                    { quantity: signedQty, averagePrice: avgPrice },
                    ltp
                  );
                  return (
                    <tr key={pos.id} className="border-b border-border/50">
                      <td className="py-2 font-sans font-medium">{pos.symbol}</td>
                      <td className="py-2">
                        <span
                          className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            isShort ? "bg-bear/20 text-bear" : "bg-bull/20 text-bull"
                          }`}
                        >
                          {isShort ? "SHORT" : "LONG"}
                        </span>
                      </td>
                      <td className="py-2 text-right">{Math.abs(pos.totalShares)}</td>
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
      </PaperAccountGate>
    </div>
  );
}
