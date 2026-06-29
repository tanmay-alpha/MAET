import { createFileRoute, useLocation } from "@tanstack/react-router";
import { ArrowLeft, Activity, Clock, CheckCircle, XCircle, AlertCircle, Filter, Download, Search, Calendar, TrendingUp, TrendingDown } from "lucide-react";
import { useMemo, useState } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";
import { usePaperAccount } from "@/hooks/use-paper-account";
import { ContractPanel } from "@/components/common/contract-panel";
import { Loadable } from "@/components/trading/skeleton";
import type { PaperOrder } from "@/hooks/use-paper-account";

export const Route = createFileRoute("/_app/orders")({
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

function OrderRow({ order, quoteMap }: { order: PaperOrder; quoteMap: Map<string, { price: number; changePct?: number }> }) {
  const quote = quoteMap.get(order.symbol);
  const ltp = quote?.price;
  const changePct = quote?.changePct || 0;

  const isBuy = order.side === "BUY";
  const pnl = order.fillPrice
    ? order.side === "SELL"
      ? (order.fillPrice - (order.triggerPrice || order.fillPrice)) * order.qty
      : 0
    : 0;

  return (
    <tr className="border-t border-border hover:bg-accent/50 transition-colors">
      <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
        {new Date(order.placedAt).toLocaleString("en-IN", {
          day: "2-digit",
          month: "short",
          hour: "2-digit",
          minute: "2-digit",
        })}
      </td>
      <td className="px-4 py-3">
        <div>
          <div className="font-medium flex items-center gap-2">
            {order.symbol}
            {ltp && (
              <span className="text-xs text-muted-foreground font-mono">₹{ltp.toFixed(2)}</span>
            )}
          </div>
          {order.type === "LIMIT" && order.triggerPrice && (
            <div className="text-[10px] text-muted-foreground mt-0.5">
              Trigger: ₹{order.triggerPrice.toFixed(2)}
            </div>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-center">
        <span className={`inline-flex items-center gap-1 rounded px-2 py-0.5 text-[10px] font-semibold ${
          isBuy ? "bg-bull/15 text-bull" : "bg-bear/15 text-bear"
        }`}>
          {isBuy ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          {order.side}
        </span>
      </td>
      <td className="px-4 py-3 text-right font-mono text-sm">
        {order.qty.toLocaleString()}
      </td>
      <td className="px-4 py-3 text-right">
        <div className="flex flex-col items-end">
          <span className="font-mono text-sm">
            {order.fillPrice
              ? `₹${order.fillPrice.toFixed(2)}`
              : order.triggerPrice
                ? `@ ₹${order.triggerPrice.toFixed(2)}`
                : "—"}
          </span>
          {order.status === "filled" && order.fillPrice && (
            <span className={`text-[10px] ${order.side === "BUY" ? "text-bear" : "text-bull"}`}>
              {order.side === "SELL" && order.triggerPrice
                ? `${((order.fillPrice - order.triggerPrice) * order.qty).toFixed(2)}`
                : order.side === "BUY" && order.triggerPrice
                  ? `${((order.triggerPrice - order.fillPrice) * order.qty).toFixed(2)}`
                  : ""}
            </span>
          )}
        </div>
      </td>
      <td className="px-4 py-3 text-right">
        <OrderStatusBadge status={order.status} rejectReason={order.rejectReason} />
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
    { key: "all", label: "All" },
    { key: "pending", label: "Pending" },
    { key: "filled", label: "Filled" },
    { key: "rejected", label: "Rejected" },
  ];

  return (
    <div className="flex gap-1">
      {filters.map((filter) => (
        <button
          key={filter.key}
          type="button"
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
  const [searchQuery, setSearchQuery] = useState("");
  const { account } = usePaperAccount();

  const uniqueSymbols = useMemo(() => [...new Set(account.orders.map(o => o.symbol))], [account.orders]);
  const { quoteMap, streamConnected, isError } = useMarketQuotes(uniqueSymbols);

  const filteredOrders = useMemo(() => {
    let result = account.orders;

    // Apply status filter
    if (activeFilter !== "all") {
      result = result.filter(order => order.status === activeFilter);
    }

    // Apply search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(order =>
        order.symbol.toLowerCase().includes(query) ||
        order.side.toLowerCase().includes(query) ||
        order.type.toLowerCase().includes(query)
      );
    }

    return result;
  }, [account.orders, activeFilter, searchQuery]);

  const pendingCount = account.orders.filter(order => order.status === "pending").length;
  const filledCount = account.orders.filter(order => order.status === "filled").length;
  const rejectedCount = account.orders.filter(order => order.status === "rejected").length;
  const cancelledCount = 0;

  const totalVolume = useMemo(() => {
    return account.orders
      .filter(o => o.status === "filled")
      .reduce((sum, o) => sum + o.qty, 0);
  }, [account.orders]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => window.history.back()}
                className="rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent"
              >
                <ArrowLeft className="h-4 w-4" />
                Back
              </button>
              <div>
                <h1 className="text-xl font-semibold">Orders</h1>
                <p className="text-xs text-muted-foreground">Paper trading order history</p>
              </div>
              <span className="text-sm text-muted-foreground">
                {pendingCount > 0 && `${pendingCount} pending`}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">
                {isError
                  ? "Quotes unavailable"
                  : streamConnected
                  ? "Live quotes"
                  : "Connecting..."}
              </span>
              <button
                type="button"
                className="flex items-center gap-2 rounded-lg border border-border bg-panel px-3 py-2 text-sm hover:bg-accent"
                onClick={() => {
                  const csv = account.orders.map(o =>
                    [
                      new Date(o.placedAt).toISOString(),
                      o.symbol,
                      o.side,
                      o.type,
                      o.qty.toString(),
                      o.fillPrice?.toString() || "",
                      o.status,
                      o.rejectReason || ""
                    ].join(",")
                  ).join("\n");
                  const header = "Time,Symbol,Side,Type,Qty,FillPrice,Status,RejectReason\n";
                  const blob = new Blob([header + csv], { type: "text/csv" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `maet-orders-${new Date().toISOString().split("T")[0]}.csv`;
                  a.click();
                }}
              >
                <Download className="h-4 w-4" />
                Export
              </button>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6">
        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4 mb-6">
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-foreground">{account.orders.length}</div>
            <div className="text-sm text-muted-foreground">Total Orders</div>
          </div>
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
            <div className="text-2xl font-bold text-primary">{(totalVolume / 1000).toFixed(1)}K</div>
            <div className="text-sm text-muted-foreground">Total Volume</div>
          </div>
        </div>

        {/* Search and Filter */}
        <div className="border-b border-border pb-4 mb-4 flex flex-col sm:flex-row gap-3 justify-between">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search by symbol, side, or type..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-panel text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
            />
          </div>
          <FilterButtons activeFilter={activeFilter} onFilter={setActiveFilter} />
        </div>

        {/* Orders Table */}
        <div className="rounded-lg border border-border bg-panel">
          <div className="border-b border-border px-6 py-3">
            <div className="text-sm font-medium">Order History</div>
            <div className="text-xs text-muted-foreground">
              Showing {filteredOrders.length} of {account.orders.length} orders
            </div>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full">
              <thead className="bg-panel-elevated">
                <tr className="text-[10px] uppercase tracking-wider text-muted-foreground">
                  <th className="px-4 py-3 text-left font-medium">Time</th>
                  <th className="px-4 py-3 text-left font-medium">Symbol</th>
                  <th className="px-4 py-3 text-center font-medium">Side</th>
                  <th className="px-4 py-3 text-right font-medium">Quantity</th>
                  <th className="px-4 py-3 text-right font-medium">Price</th>
                  <th className="px-4 py-3 text-right font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="text-sm">
                {filteredOrders.length > 0 ? (
                  filteredOrders.map((order) => (
                    <OrderRow key={order.id} order={order} quoteMap={quoteMap} />
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
            Paper Trading — All orders are simulated in the browser. No broker requests are made.
          </div>
        </div>
      </div>
    </div>
  );
}