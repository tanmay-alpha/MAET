import { createFileRoute } from "@tanstack/react-router";
import { Clock, CheckCircle, XCircle, AlertCircle, TrendingUp, TrendingDown } from "lucide-react";
import React, { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import type { PaperOrderRow, PaperFillRow } from "../../server/modules/paper-trading/contracts";

export const Route = createFileRoute("/_app/orders")({
  head: () => ({
    meta: [{ title: "Orders — MAET" }],
  }),
  component: OrdersPage,
});

function OrderStatusBadge({ status, rejectReason }: { status: string; rejectReason?: string | null }) {
  const variants: Record<string, { icon: React.ElementType; className: string }> = {
    PENDING: { icon: Clock, className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
    TRIGGER_PENDING: { icon: Clock, className: "bg-amber-500/10 text-amber-500 border-amber-500/20" },
    TRIGGERED: { icon: Clock, className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
    FILLED: { icon: CheckCircle, className: "bg-green-500/10 text-green-500 border-green-500/20" },
    PARTIALLY_FILLED: { icon: CheckCircle, className: "bg-teal-500/10 text-teal-500 border-teal-500/20" },
    REJECTED: { icon: XCircle, className: "bg-red-500/10 text-red-500 border-red-500/20" },
    CANCELLED: { icon: AlertCircle, className: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
  };

  const variant = variants[status] || variants.PENDING;
  const Icon = variant.icon;

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${variant.className}`}>
      <Icon className="h-3 w-3" />
      <span>{status}</span>
      {rejectReason && (
        <span className="ml-1 text-xs opacity-75">({rejectReason})</span>
      )}
    </div>
  );
}

function OrdersPage() {
  const [activeTab, setActiveTab] = useState<"orders" | "fills">("orders");
  const [activeFilter, setActiveFilter] = useState("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { orders, fills, cancelOrder, isTradingAvailable } = usePaperAccount();

  const uniqueSymbols = useMemo(() => [...new Set(orders.map((o) => o.symbol))], [orders]);
  const { quoteMap } = useMarketQuotes(uniqueSymbols);

  const filteredOrders = useMemo(() => {
    let result = orders;

    if (activeFilter !== "all") {
      result = result.filter((order) => order.status === activeFilter ||
        (activeFilter === "PENDING" && (order.status === "TRIGGER_PENDING" || order.status === "TRIGGERED" || order.status === "PARTIALLY_FILLED")));
    }

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter((order) =>
        order.symbol.toLowerCase().includes(query) ||
        order.side.toLowerCase().includes(query) ||
        order.type.toLowerCase().includes(query)
      );
    }

    return result;
  }, [orders, activeFilter, searchQuery]);

  return (
    <div className="flex-1 space-y-4 p-6 bg-background">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-border pb-4">
        <div>
          <h1 className="text-xl font-bold tracking-tight">Order Execution & History</h1>
          <p className="text-xs text-muted-foreground mt-0.5">
            Backend authoritative paper trading order book and execution ledger.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <div className="flex bg-panel rounded-lg border border-border p-1">
            <button
              onClick={() => setActiveTab("orders")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${activeTab === "orders" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Orders ({orders.length})
            </button>
            <button
              onClick={() => setActiveTab("fills")}
              className={`px-3 py-1 text-xs font-semibold rounded-md transition ${activeTab === "fills" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}
            >
              Fills ({fills.length})
            </button>
          </div>
        </div>
      </div>

      {activeTab === "orders" && (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 bg-panel p-3 rounded-lg border border-border">
            <div className="flex gap-1 flex-wrap">
              {["all", "PENDING", "FILLED", "CANCELLED", "REJECTED"].map((f) => (
                <button
                  key={f}
                  onClick={() => setActiveFilter(f)}
                  className={`px-3 py-1 text-xs font-medium rounded-md transition ${activeFilter === f ? "bg-primary text-primary-foreground" : "bg-panel-elevated text-muted-foreground hover:text-foreground"}`}
                >
                  {f.toUpperCase()}
                </button>
              ))}
            </div>

            <input
              type="text"
              placeholder="Search symbol or side…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="rounded bg-panel-elevated px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-1 focus:ring-primary w-full sm:w-64"
            />
          </div>

          <div className="rounded-lg border border-border bg-panel overflow-hidden">
            <table className="w-full text-xs font-mono tabular-nums text-left">
              <thead>
                <tr className="bg-panel-elevated/40 text-[10px] uppercase text-muted-foreground border-b border-border">
                  <th className="px-4 py-2.5">Placed At</th>
                  <th className="px-4 py-2.5">Symbol</th>
                  <th className="px-4 py-2.5 text-right">Side</th>
                  <th className="px-4 py-2.5 text-right">Type</th>
                  <th className="px-4 py-2.5 text-right">Quantity</th>
                  <th className="px-4 py-2.5 text-right">Limit / Stop Price</th>
                  <th className="px-4 py-2.5 text-right">Status</th>
                  <th className="px-4 py-2.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.map((o: PaperOrderRow) => {
                  const quote = quoteMap.get(o.symbol);
                  const isBuy = o.side === "BUY";
                  const canCancel = o.status === "PENDING" || o.status === "TRIGGER_PENDING";

                  return (
                    <tr key={o.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">
                        {new Date(o.placedAt).toLocaleString("en-IN", {
                          month: "short",
                          day: "2-digit",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </td>
                      <td className="px-4 py-3 font-sans font-semibold text-foreground">
                        {o.symbol}
                        {quote && <span className="ml-2 text-[10px] text-muted-foreground font-mono">₹{quote.price.toFixed(2)}</span>}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-bold ${isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"}`}>
                          {isBuy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
                          {o.side}
                        </span>
                      </td>
                      <td className="px-4 py-3 text-right">{o.type}</td>
                      <td className="px-4 py-3 text-right">{o.qty}</td>
                      <td className="px-4 py-3 text-right">
                        {o.limitPrice ? `₹${Number(o.limitPrice).toFixed(2)}` : o.stopPrice ? `₹${Number(o.stopPrice).toFixed(2)}` : "MARKET"}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <OrderStatusBadge status={o.status} rejectReason={o.rejectReason} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        {canCancel && (
                          <button
                            onClick={() => cancelOrder(o.id)}
                            disabled={!isTradingAvailable}
                            className="rounded bg-panel-elevated hover:bg-bear hover:text-white px-2.5 py-1 text-[11px] font-medium transition disabled:opacity-50"
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
                    <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground font-sans">
                      No orders found.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {activeTab === "fills" && (
        <div className="rounded-lg border border-border bg-panel overflow-hidden">
          <table className="w-full text-xs font-mono tabular-nums text-left">
            <thead>
              <tr className="bg-panel-elevated/40 text-[10px] uppercase text-muted-foreground border-b border-border">
                <th className="px-4 py-2.5">Executed At</th>
                <th className="px-4 py-2.5">Symbol</th>
                <th className="px-4 py-2.5 text-right">Side</th>
                <th className="px-4 py-2.5 text-right">Quantity</th>
                <th className="px-4 py-2.5 text-right">Fill Price</th>
                <th className="px-4 py-2.5 text-right">Slippage</th>
                <th className="px-4 py-2.5 text-right">Fee</th>
                <th className="px-4 py-2.5 text-right">Reason</th>
              </tr>
            </thead>
            <tbody>
              {fills.map((f: PaperFillRow) => (
                <tr key={f.id} className="border-b border-border hover:bg-accent/40 transition-colors">
                  <td className="px-4 py-3 text-muted-foreground">
                    {new Date(f.executedAt).toLocaleString("en-IN", {
                      month: "short",
                      day: "2-digit",
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </td>
                  <td className="px-4 py-3 font-sans font-semibold text-foreground">{f.symbol}</td>
                  <td className="px-4 py-3 text-right">{f.side}</td>
                  <td className="px-4 py-3 text-right">{f.quantity}</td>
                  <td className="px-4 py-3 text-right">₹{Number(f.fillPrice).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">₹{Number(f.slippage).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right">₹{Number(f.fees).toFixed(2)}</td>
                  <td className="px-4 py-3 text-right text-muted-foreground">{f.executionReason}</td>
                </tr>
              ))}
              {fills.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-4 py-12 text-center text-muted-foreground font-sans">
                    No execution fills recorded.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}