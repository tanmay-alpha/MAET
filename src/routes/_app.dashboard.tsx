import { createFileRoute } from "@tanstack/react-router";
import { Activity, ArrowDownRight, ArrowUpRight, ReceiptText, TrendingUp, Wallet, PlusCircle } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useSignedIn } from "@/hooks/use-signed-in";
import { paperAccountBlockedReason } from "@/lib/paper-account-status";
import { PaperAccountNotice } from "@/components/common/signed-out-notice";
import { GuestMarketDashboard } from "@/components/trading/guest-market-dashboard";
import { QuickTradeModal } from "@/components/trading/quick-trade-modal";
import { ResetAccountButton } from "@/components/trading/reset-account-button";
import type { PaperAccountRow, PaperPositionRow, PaperOrderRow } from "../../server/modules/paper-trading/contracts";
import { calculateMarkedUnrealisedPnl } from "@shared/domain/paper-trading/margin";

export const Route = createFileRoute("/_app/dashboard")({
  head: () => ({ meta: [{ title: "Dashboard — MAET" }] }),
  component: Dashboard,
});

const INDEX_KEYS = ["NIFTY50", "BANKNIFTY", "SENSEX", "NIFTYIT", "NIFTYFMCG", "INDIAVIX"];

function money(value: number): string {
  return `₹${value.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Placeholder while the account loads: no digits until the server has answered. */
function Skeleton({ className }: { className: string }) {
  return <span aria-hidden className={`inline-block animate-pulse rounded bg-accent ${className}`} />;
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
  /** null while the account is loading. */
  value: string | null;
  sub: string | null;
  trend: "up" | "down" | "flat";
}) {
  return (
    <div className="rounded-lg border border-border bg-panel p-4" aria-busy={value === null}>
      <div className="flex items-center justify-between">
        <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
        <Icon className="h-4 w-4 text-muted-foreground" />
      </div>
      <div className="mt-2 font-mono text-2xl font-semibold tabular tabular-nums">{value ?? <Skeleton className="h-7 w-32" />}</div>
      <div className={`mt-1 flex items-center gap-1 font-mono text-xs tabular tabular-nums ${trend === "up" ? "text-bull" : trend === "down" ? "text-bear" : "text-muted-foreground"}`}>
        {sub !== null && trend === "up" && <ArrowUpRight className="h-3 w-3" />}
        {sub !== null && trend === "down" && <ArrowDownRight className="h-3 w-3" />}
        {sub ?? <Skeleton className="h-3 w-24" />}
      </div>
    </div>
  );
}

/** Figures exist only for an account the server returned; there is no default balance. */
function accountFigures(account: PaperAccountRow, unrealizedPnl: number) {
  const cash = Number(account.cashBalance);
  const initialCash = Number(account.initialCash);
  const equity = cash + unrealizedPnl;
  return {
    cash,
    equity,
    totalPnl: equity - initialCash,
    unrealizedReturnPct: initialCash > 0 ? (unrealizedPnl / initialCash) * 100 : 0,
  };
}

function Dashboard() {
  const signedIn = useSignedIn();
  const { status, account, positions, orders, resetAccount, retry } = usePaperAccount();
  const [tradeModal, setTradeModal] = useState<{ isOpen: boolean; symbol: string; side: "BUY" | "SELL" }>({
    isOpen: false,
    symbol: "",
    side: "BUY",
  });

  const symbols = useMemo(
    () => [...new Set([...positions.map((position) => position.symbol), ...INDEX_KEYS])],
    [positions]
  );
  const { quoteMap, feed } = useMarketQuotes(symbols);

  if (!signedIn) return <GuestMarketDashboard />;
  // No account to show or act on: keep the public market workspace useful under the notice.
  if (status === "unauthorized" || status === "unavailable") {
    return <GuestMarketDashboard accountNotice={<PaperAccountNotice status={status} onRetry={retry} className="mt-2" />} />;
  }

  const blockedReason = paperAccountBlockedReason(status);

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

  const figures = account && accountFigures(account, unrealizedPnl);
  const filledOrders = orders.filter((o: PaperOrderRow) => o.status === "FILLED").length;
  const pendingOrders = orders.filter((o: PaperOrderRow) => o.status === "PENDING" || o.status === "TRIGGER_PENDING").length;

  return (
    <div className="h-full overflow-y-auto p-4">
      <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Paper trading dashboard</h1>
          <p className="text-xs text-muted-foreground">
            {feed.label}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            disabled={blockedReason !== null}
            title={blockedReason ?? undefined}
            onClick={() => setTradeModal({ isOpen: true, symbol: "", side: "BUY" })}
            className="flex items-center gap-1.5 rounded-md bg-primary hover:bg-primary/95 text-primary-foreground px-3.5 py-1.5 text-xs font-bold transition-all shadow disabled:cursor-not-allowed disabled:opacity-50"
          >
            <PlusCircle className="h-4 w-4" />
            Quick Trade
          </button>
          <ResetAccountButton
            accountStatus={status}
            onReset={resetAccount}
            confirmMessage="Reset paper account to initial cash?"
            className="rounded border border-border bg-panel px-3 py-1.5 text-xs hover:bg-accent font-medium transition-all"
          >
            Reset
          </ResetAccountButton>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <StatCard
          icon={Wallet}
          label="Portfolio equity"
          value={figures && money(figures.equity)}
          sub={figures && `Cash: ${money(figures.cash)}`}
          trend={!figures ? "flat" : figures.totalPnl >= 0 ? "up" : "down"}
        />
        <StatCard
          icon={TrendingUp}
          label="Unrealized P&L"
          value={figures && money(unrealizedPnl)}
          sub={figures && `${unrealizedPnl >= 0 ? "+" : ""}${figures.unrealizedReturnPct.toFixed(2)}% return`}
          trend={!figures ? "flat" : unrealizedPnl >= 0 ? "up" : "down"}
        />
        <StatCard
          icon={ReceiptText}
          label="Open positions"
          value={figures && String(positions.length)}
          sub={figures && `Position value ${money(positionsValue)}`}
          trend="flat"
        />
        <StatCard
          icon={Activity}
          label="Orders status"
          value={figures && String(orders.length)}
          sub={figures && `${filledOrders} filled · ${pendingOrders} pending`}
          trend="flat"
        />
      </div>

      <div className="mt-6 rounded-lg border border-border bg-panel p-4">
        <h2 className="mb-3 font-semibold text-sm">Positions overview</h2>
        {!figures ? (
          <div className="space-y-2" aria-busy="true">
            <span className="sr-only">Loading positions…</span>
            {[0, 1, 2].map((row) => <Skeleton key={row} className="block h-4 w-full" />)}
          </div>
        ) : positions.length > 0 ? (
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
    </div>
  );
}
