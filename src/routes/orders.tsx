import { createFileRoute, useLocation } from "@tanstack/react-router";
import { ArrowLeft, Activity, Clock, CheckCircle, XCircle, AlertCircle, Filter, Download } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { ContractPanel } from "@/components/trading/contract-panel";
import { Loadable } from "@/components/trading/skeleton";
import type { PaperOrder } from "@/hooks/use-paper-account";

export const Route = createFileRoute("/orders")({
  head: () => ({
    meta: [{ title: "Orders — MAET" }]
  }),
  component: OrdersPage,
});

function OrderStatusBadge({ status, rejectReason }: { status: string; rejectReason?: string }) {
  const variants = {
    pending: { icon: Clock, className: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20" },
    placed: { icon: Clock, className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
    filled: { icon: CheckCircle, className: "bg-green-500/10 text-green-500 border-green-500/20" },
    rejected: { icon: XCircle, className: "bg-red-500/10 text-red-500 border-red-500/20" },
    cancelled: { icon: AlertCircle, className: "bg-gray-500/10 text-gray-500 border-gray-500/20" },
  };

  const variant = variants[status as keyof typeof variants] || variants.pending;
  const Icon = variant.icon;

  return (
    <div className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-semibold ${variant.className}`}>
      <Icon className="h-3 w-3" />
      <span>{status.charAt(0).toUpperCase() + status.slice(1)}</span>
      {rejectReason && (
        <span className="ml-1 text-xs opacity-75">({rejectReason})</span>
      )}
    </div>
  );
}

function OrderRow({ order }: { order: PaperOrder }) {
  return (
    <tr className="border-t border-border hover:bg-accent/50 transition-colors">
      <td className="px-4 py-2.5 font-mono text-xs text-muted-foreground">
        {new Date(order.placedAt).toLocaleString("en-IN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          second: "2-digit",
        })}
      </td>
      <td className="px-4 py-2.5">
        <div className="flex items-center gap-2">
          <span className="font-medium">{order.symbol}</span>
          {order.triggerPrice && (
            <span className="text-xs text-muted-foreground">
              @ {order.triggerPrice.toFixed(2)}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-2.5 text-center">
        <span className={`rounded px-1.5 py-0.5 text-[10px] font-semibold ${
          order.side === "BUY"
            ? "bg-bull/20 text-bull"
            : "bg-bear/20 text-bear"
        }`}>
          {order.side}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right font-mono tabular">
        {order.qty.toLocaleString()}
      </td>
      <td className="px-4 py-2.5 text-right">
        <div className="flex flex-col items-end gap-1">
          <span className="font-mono tabular">
            {order.fillPrice ? order.fillPrice.toFixed(2) : order.triggerPrice ? order.triggerPrice.toFixed(2) : "—"}
          </span>
          <span className="text-xs text-muted-foreground font-mono">
            {order.status === "filled" && order.fillPrice && `${((order.fillPrice - order.triggerPrice!) * (order.side === "BUY" ? -1 : 1)).toFixed(2)}`}
          </span>
        </div>
      </td>
      <td className="px-4 py-2.5 text-right">
        <OrderStatus
          status={order.status}
          rejectReason={order.rejectReason}
        />
      </td>
    </tr>
  );
}

function OrderStatus({ status, rejectReason }: { status: string; rejectReason?: string }) {
  const variants = {
    pending: { icon: Clock, className: "text-yellow-500" },
    placed: { icon: Clock, className: "text-blue-500" },
    filled: { icon: CheckCircle, className: "text-green-500" },
    rejected: { icon: XCircle, className: "text-red-500" },
    cancelled: { icon: AlertCircle, className: "text-gray-500" },
  };

  const variant = variants[status as keyof typeof variants] || variants.pending;
  const Icon = variant.icon;

  return (
    <div className="flex items-center justify-end gap-2">
      <Icon className={`h-4 w-4 ${variant.className}`} />
      <OrderStatusBadge status={status} rejectReason={rejectReason} />
    </div>
  );
}

function FilterButtons({ activeFilter, onFilter }: { activeFilter: string; onFilter: (filter: string) => void }) {
  const filters = [
    { key: "all", label: "All Orders", count: 0 },
    { key: "pending", label: "Pending", count: 0 },
    { key: "filled", label: "Filled", count: 0 },
    { key: "rejected", label: "Rejected", count: 0 },
    { key: "cancelled", label: "Cancelled", count: 0 },
  ];

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-1">
        {filters.map((filter) => (
          <button
            key={filter.key}
            onClick={() => onFilter(filter.key)}
            className={`px-3 py-1.5 text-sm rounded-md transition-colors ${
              activeFilter === filter.key
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/50"
            }`}
          >
            {filter.label}
          </button>
        ))}
      </div>
      <div className="ml-auto text-sm text-muted-foreground">
        Showing: {filters.find(f => f.key === activeFilter)?.label}
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="h-64 flex flex-col items-center justify-center text-center">
      <div className="text-6xl mb-4">📋</div>
      <h3 className="text-lg font-semibold mb-2">No orders yet</h3>
      <p className="text-sm text-muted-foreground max-w-md">
        Place your first paper trading order in the terminal. All orders are simulated and no broker request is made.
      </p>
    </div>
  );
}

function OrdersPage() {
  const [activeFilter, setActiveFilter] = useState("all");
  const { account } = usePaperAccount();

  const { quoteMap, streamConnected, isError } = useMarketQuotes(
    account.orders.map(order => order.symbol)
  );

  const filteredOrders = useMemo(() => {
    if (activeFilter === "all") return account.orders;
    return account.orders.filter(order => order.status === activeFilter);
  }, [account.orders, activeFilter]);

  const pendingCount = account.orders.filter(order => order.status === "pending").length;
  const filledCount = account.orders.filter(order => order.status === "filled").length;
  const rejectedCount = account.orders.filter(order => order.status === "rejected").length;
  const cancelledCount = 0; // Not implemented in paper trading

  // Add mock data if empty for demonstration
  const hasOrders = account.orders.length > 0;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                onClick={() => window.history.back()}
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <h1 className="text-xl font-semibold">Paper Trading Orders</h1>
              <span className="text-sm text-muted-foreground">
                ({pendingCount} pending, {filledCount} filled)
              </span>
            </div>
            <button className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent">
              <Download className="h-4 w-4" />
              Export CSV
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-bull">{pendingCount}</div>
            <div className="text-sm text-muted-foreground">Pending</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-green-600">{filledCount}</div>
            <div className="text-sm text-muted-foreground">Filled</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-red-500">{rejectedCount}</div>
            <div className="text-sm text-muted-foreground">Rejected</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-gray-500">{cancelledCount}</div>
            <div className="text-sm text-muted-foreground">Cancelled</div>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="border-b border-border pb-4 mb-4">
          <FilterButtons activeFilter={activeFilter} onFilter={setActiveFilter} />
        </div>

        {/* Orders Table */}
        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-6 py-3">
            <div className="text-sm font-medium">Order History</div>
            <div className="text-xs text-muted-foreground">
              {isError
                ? "Market quotes unavailable"
                : streamConnected
                ? "Real-time quotes connected"
                : "Connecting to market data"}
              {" · All prices use Yahoo delayed data"}
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead className="text-[10px] uppercase tracking-wider text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 text-left">Time</th>
                  <th className="px-4 py-3 text-left">Symbol</th>
                  <th className="px-4 py-3 text-center">Side</th>
                  <th className="px-4 py-3 text-right">Qty</th>
                  <th className="px-4 py-3 text-right">Fill/Trigger</th>
                  <th className="px-4 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody>
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => (
                    <OrderRow key={order.id} order={order} />
                  ))
                ) : (
                  <tr>
                    <td colSpan={6} className="px-4 py-16 text-center">
                      <EmptyState />
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        {/* Info Box */}
        <div className="mt-6 rounded-lg border border-dashed border-border bg-panel/30 p-4 text-center">
          <div className="text-sm text-muted-foreground">
            💡 Paper Trading Education: All orders shown here are browser-only simulations.
            No broker request is sent, and no real money is risked. This is a research tool for understanding
            market mechanics and order flow.
          </div>
        </div>
      </div>
    </div>
  );
}