import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { useSignedIn } from "@/hooks/use-signed-in";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { PaperOrderStatus } from "@/components/trading/paper-order-status";
import { isWorkingOrderStatus } from "@shared/domain/paper-trading/order-status";
import type { PaperOrderRow, PaperFillRow } from "../../server/modules/paper-trading/contracts";

export const Route = createFileRoute("/_app/orders")({
  head: () => ({
    meta: [{ title: "Orders — MAET" }],
  }),
  component: OrdersPage,
});

const ORDER_TYPE: Record<string, string> = {
  MARKET: "Market",
  LIMIT: "Limit",
  STOP_LOSS_LIMIT: "SL limit",
  STOP_LOSS_MARKET: "SL market",
};

const FILTERS = [
  { id: "all", label: "All" },
  { id: "open", label: "Open" },
  { id: "FILLED", label: "Filled" },
  { id: "CANCELLED", label: "Cancelled" },
  { id: "REJECTED", label: "Rejected" },
] as const;

type OrderFilter = (typeof FILTERS)[number]["id"];

function rupees(value: number | string | null | undefined): string {
  if (value === null || value === undefined) return "—";
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "—";
  return `₹${amount.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function timestamp(value: string | Date): string {
  return new Date(value).toLocaleString("en-IN", { month: "short", day: "2-digit", hour: "2-digit", minute: "2-digit" });
}

/** Limit and trigger prices as the order was placed; market orders have neither. */
function orderPrice(order: PaperOrderRow): string {
  const limit = order.limitPrice ? rupees(order.limitPrice) : null;
  const trigger = order.stopPrice ? `trig ${rupees(order.stopPrice)}` : null;
  return [limit, trigger].filter(Boolean).join(" · ") || "Market";
}

const TH = "px-3 py-2 font-medium";

function OrdersPage() {
  const signedIn = useSignedIn();
  const [activeTab, setActiveTab] = useState<"orders" | "fills">("orders");
  const [activeFilter, setActiveFilter] = useState<OrderFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { orders, fills, cancelOrder, isTradingAvailable, isLoading, connectionState } = usePaperAccount();

  const uniqueSymbols = useMemo(() => [...new Set(orders.map((o) => o.symbol))], [orders]);
  const { quoteMap } = useMarketQuotes(uniqueSymbols);

  const filteredOrders = useMemo(() => {
    let result = orders;
    if (activeFilter === "open") {
      result = result.filter((order) => isWorkingOrderStatus(order.status));
    } else if (activeFilter !== "all") {
      result = result.filter((order) => order.status === activeFilter);
    }

    const query = searchQuery.trim().toLowerCase();
    if (query) {
      result = result.filter(
        (order) =>
          order.symbol.toLowerCase().includes(query) ||
          order.side.toLowerCase().includes(query) ||
          order.type.toLowerCase().includes(query),
      );
    }

    return result;
  }, [orders, activeFilter, searchQuery]);

  const unavailable = signedIn && connectionState === "disconnected";
  const ready = signedIn && !unavailable && !isLoading;

  const tabClass = (active: boolean) =>
    `px-3 py-1 text-xs font-medium transition-colors ${active ? "bg-accent text-foreground" : "text-muted-foreground hover:text-foreground"}`;

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Orders</h1>
        {ready && (
          <div className="ml-auto flex overflow-hidden rounded border border-border" role="group" aria-label="Order book view">
            <button type="button" aria-pressed={activeTab === "orders"} onClick={() => setActiveTab("orders")} className={tabClass(activeTab === "orders")}>
              Orders <span className="font-mono tabular-nums">{orders.length}</span>
            </button>
            <button type="button" aria-pressed={activeTab === "fills"} onClick={() => setActiveTab("fills")} className={`border-l border-border ${tabClass(activeTab === "fills")}`}>
              Fills <span className="font-mono tabular-nums">{fills.length}</span>
            </button>
          </div>
        )}
      </header>

      <div className="space-y-3 p-4 sm:p-5">
        {!signedIn ? (
          <SignedOutNotice feature="Paper orders and fills" />
        ) : unavailable ? (
          <p role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            The paper account could not be loaded, so orders and fills are unavailable right now.
          </p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground">Loading paper account…</p>
        ) : activeTab === "orders" ? (
          <>
            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex flex-wrap gap-1">
                {FILTERS.map((filter) => (
                  <button
                    key={filter.id}
                    type="button"
                    aria-pressed={activeFilter === filter.id}
                    onClick={() => setActiveFilter(filter.id)}
                    className={`shrink-0 rounded border px-2.5 py-1 text-xs transition-colors ${
                      activeFilter === filter.id
                        ? "border-primary bg-primary/10 text-primary"
                        : "border-border text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    {filter.label}
                  </button>
                ))}
              </div>
              <input
                type="search"
                aria-label="Search orders"
                placeholder="Symbol, side or type"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full rounded border border-border bg-panel px-3 py-1.5 text-xs text-foreground focus:border-primary/60 focus:outline-none sm:w-64"
              />
            </div>

            <div className="overflow-x-auto rounded border border-border bg-panel">
              <table className="w-full min-w-[52rem] text-left font-mono text-xs tabular-nums">
                <thead>
                  <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                    <th className={TH}>Placed</th>
                    <th className={TH}>Symbol</th>
                    <th className={TH}>Side</th>
                    <th className={TH}>Type</th>
                    <th className={`${TH} text-right`}>Filled / qty</th>
                    <th className={`${TH} text-right`}>Remaining</th>
                    <th className={`${TH} text-right`}>Price</th>
                    <th className={`${TH} text-right`}>Avg fill</th>
                    <th className={TH}>Status</th>
                    <th className={TH}><span className="sr-only">Actions</span></th>
                  </tr>
                </thead>
                <tbody>
                  {filteredOrders.map((o: PaperOrderRow) => {
                    const quote = quoteMap.get(o.symbol);
                    const working = isWorkingOrderStatus(o.status);

                    return (
                      <tr key={o.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                        <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{timestamp(o.placedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2">
                          <span className="font-sans font-semibold text-foreground">{o.symbol}</span>
                          {quote && (
                            <span className="ml-2 text-[10px] text-muted-foreground" title="Last traded price">
                              {rupees(quote.price)}
                            </span>
                          )}
                        </td>
                        <td className={`px-3 py-2 font-semibold ${o.side === "BUY" ? "text-bull" : "text-bear"}`}>{o.side}</td>
                        <td className="whitespace-nowrap px-3 py-2 font-sans text-muted-foreground">{ORDER_TYPE[o.type] ?? o.type}</td>
                        <td className="px-3 py-2 text-right">
                          {o.filledQty}/{o.qty}
                        </td>
                        <td className="px-3 py-2 text-right">{working ? o.qty - o.filledQty : "—"}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{orderPrice(o)}</td>
                        <td className="whitespace-nowrap px-3 py-2 text-right">{o.filledQty > 0 ? rupees(o.averageFillPrice) : "—"}</td>
                        <td className="px-3 py-2">
                          <PaperOrderStatus status={o.status} rejectReason={o.rejectReason} />
                        </td>
                        <td className="px-3 py-1.5 text-right">
                          {working && (
                            <button
                              type="button"
                              onClick={() => cancelOrder(o.id)}
                              disabled={!isTradingAvailable}
                              className="rounded border border-border px-2 py-0.5 font-sans text-[11px] text-muted-foreground transition-colors hover:border-bear/50 hover:text-bear disabled:opacity-40"
                            >
                              Cancel
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                  {filteredOrders.length === 0 && (
                    <tr>
                      <td colSpan={10} className="px-3 py-6 text-center font-sans text-muted-foreground">
                        {orders.length === 0 ? "No paper orders yet. Place one from the terminal." : "No orders match this filter."}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </>
        ) : (
          <div className="overflow-x-auto rounded border border-border bg-panel">
            <table className="w-full min-w-[42rem] text-left font-mono text-xs tabular-nums">
              <thead>
                <tr className="border-b border-border text-[10px] uppercase tracking-wide text-muted-foreground">
                  <th className={TH}>Executed</th>
                  <th className={TH}>Symbol</th>
                  <th className={TH}>Side</th>
                  <th className={`${TH} text-right`}>Qty</th>
                  <th className={`${TH} text-right`}>Fill price</th>
                  <th className={`${TH} text-right`}>Slippage</th>
                  <th className={`${TH} text-right`}>Charges</th>
                  <th className={TH}>Reason</th>
                </tr>
              </thead>
              <tbody>
                {fills.map((f: PaperFillRow) => (
                  <tr key={f.id} className="border-b border-border/60 last:border-0 hover:bg-accent/30">
                    <td className="whitespace-nowrap px-3 py-2 text-muted-foreground">{timestamp(f.executedAt)}</td>
                    <td className="px-3 py-2 font-sans font-semibold text-foreground">{f.symbol}</td>
                    <td className={`px-3 py-2 font-semibold ${f.side === "BUY" ? "text-bull" : "text-bear"}`}>{f.side}</td>
                    <td className="px-3 py-2 text-right">{f.quantity}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{rupees(f.fillPrice)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{rupees(f.slippage)}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-right">{rupees(f.fees)}</td>
                    <td className="px-3 py-2 font-sans text-muted-foreground">{f.executionReason}</td>
                  </tr>
                ))}
                {fills.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-6 text-center font-sans text-muted-foreground">
                      No fills yet.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
