import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Bell, Plus, Trash2, Check, X, TrendingUp, TrendingDown, Activity, Volume2, Filter, Search, AlertTriangle, Zap } from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";
import { useAlerts, type Alert as AlertType } from "@/hooks/use-alerts";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "Alerts — MAET" }] }),
  component: Alerts,
});

type AlertFilter = "all" | "active" | "triggered" | "price" | "volume" | "indicator";

function AlertBadge({ type }: { type: AlertType["type"] }) {
  const config = {
    price_above: { icon: TrendingUp, label: "Price Above", className: "bg-bull/10 text-bull border-bull/20" },
    price_below: { icon: TrendingDown, label: "Price Below", className: "bg-bear/10 text-bear border-bear/20" },
    volume_spike: { icon: Volume2, label: "Volume", className: "bg-purple-500/10 text-purple-500 border-purple-500/20" },
    indicator: { icon: Activity, label: "Indicator", className: "bg-blue-500/10 text-blue-500 border-blue-500/20" },
  };

  const cfg = config[type];
  const Icon = cfg.icon;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function CreateAlertForm({ onClose }: { onClose: () => void }) {
  const { createAlert } = useAlerts();
  const [symbol, setSymbol] = useState("");
  const [alertType, setAlertType] = useState<AlertType["type"]>("price_above");
  const [value, setValue] = useState("");
  const [repeat, setRepeat] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const result = createAlert({
      symbol,
      type: alertType,
      condition: alertType === "price_below" ? "below" : "above",
      value: parseFloat(value),
      repeat,
    });

    if (result.ok) {
      onClose();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Symbol</label>
        <input
          type="text"
          value={symbol}
          onChange={(e) => setSymbol(e.target.value.toUpperCase())}
          placeholder="RELIANCE"
          className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        />
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Alert Type</label>
        <div className="grid grid-cols-2 gap-2">
          {[
            { value: "price_above", label: "Price Above", icon: TrendingUp },
            { value: "price_below", label: "Price Below", icon: TrendingDown },
            { value: "volume_spike", label: "Volume Spike", icon: Volume2 },
            { value: "indicator", label: "Indicator", icon: Activity },
          ].map((opt) => (
            <button
              key={opt.value}
              type="button"
              onClick={() => setAlertType(opt.value as AlertType["type"])}
              className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-sm transition-colors ${
                alertType === opt.value
                  ? "border-primary bg-primary/10 text-primary"
                  : "border-border hover:bg-accent/50"
              }`}
            >
              <opt.icon className="h-4 w-4" />
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-sm font-medium mb-1">Trigger Value</label>
        <input
          type="number"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={alertType.includes("price") ? "2500" : "1000000"}
          className="w-full rounded-lg border border-border bg-panel px-3 py-2 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-primary/20"
          required
        />
      </div>

      <div className="flex items-center justify-between">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={repeat}
            onChange={(e) => setRepeat(e.target.checked)}
            className="h-4 w-4 rounded border-border"
          />
          <span className="text-sm text-muted-foreground">Repeat after trigger</span>
        </label>
      </div>

      <div className="flex gap-2 pt-2">
        <button
          type="submit"
          className="flex-1 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90"
        >
          Create Alert
        </button>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg border border-border bg-panel px-4 py-2 text-sm hover:bg-accent"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}

function AlertItem({ alert, onDelete, onToggle, onReset }: {
  alert: AlertType;
  onDelete: (id: string) => void;
  onToggle: (id: string) => void;
  onReset: (id: string) => void;
}) {
  return (
    <div className={`flex items-center justify-between px-5 py-4 hover:bg-accent/50 transition-colors ${
      alert.triggered ? "bg-primary/5" : ""
    }`}>
      <div className="flex items-center gap-4">
        <div className={`h-2.5 w-2.5 rounded-full ${
          alert.triggered ? "bg-primary animate-pulse" : "bg-muted-foreground"
        }`} />
        <div>
          <div className="flex items-center gap-2">
            <span className="font-semibold font-mono">{alert.symbol}</span>
            <AlertBadge type={alert.type} />
          </div>
          <div className="text-sm text-muted-foreground mt-0.5">
            {alert.type === "price_above" && `Price above ₹${alert.value.toLocaleString("en-IN")}`}
            {alert.type === "price_below" && `Price below ₹${alert.value.toLocaleString("en-IN")}`}
            {alert.type === "volume_spike" && `Volume ≥ ${(alert.value / 1000).toFixed(0)}K`}
            {alert.type === "indicator" && `Indicator value ≥ ${alert.value.toFixed(2)}`}
          </div>
          <div className="text-xs text-muted-foreground mt-1">
            {new Date(alert.createdAt).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}
          </div>
        </div>
      </div>

      <div className="flex items-center gap-2">
        {alert.triggered && (
          <span className="text-xs font-medium text-primary bg-primary/10 px-2 py-1 rounded">
            Triggered
          </span>
        )}
        <button
          type="button"
          onClick={() => onToggle(alert.id)}
          className={`rounded p-1.5 transition-colors ${
            alert.enabled
              ? "text-bull hover:bg-bull/10"
              : "text-muted-foreground hover:bg-accent"
          }`}
          title={alert.enabled ? "Disable" : "Enable"}
        >
          <Zap className="h-4 w-4" fill={alert.enabled ? "currentColor" : "none"} />
        </button>
        {alert.triggered && (
          <button
            type="button"
            onClick={() => onReset(alert.id)}
            className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
            title="Reset alert"
          >
            <Check className="h-4 w-4" />
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(alert.id)}
          className="rounded p-1.5 text-muted-foreground hover:bg-accent hover:text-foreground"
          title="Delete alert"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function Alerts() {
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const { alerts, activeAlerts, triggeredAlerts, deleteAlert, toggleAlert, resetAlert, clearAllAlerts } = useAlerts();

  const filteredAlerts = useMemo(() => {
    let result = alerts;

    if (filter === "active") result = activeAlerts;
    else if (filter === "triggered") result = triggeredAlerts;
    else if (filter === "price") result = alerts.filter(a => a.type.startsWith("price"));
    else if (filter === "volume") result = alerts.filter(a => a.type === "volume_spike");
    else if (filter === "indicator") result = alerts.filter(a => a.type === "indicator");

    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      result = result.filter(a => a.symbol.toLowerCase().includes(query));
    }

    return result;
  }, [alerts, activeAlerts, triggeredAlerts, filter, searchQuery]);

  const stats = useMemo(() => ({
    total: alerts.length,
    active: alerts.filter(a => !a.triggered).length,
    triggered: alerts.filter(a => a.triggered).length,
  }), [alerts]);

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-50 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-xl font-semibold">Alerts</h1>
                <p className="text-xs text-muted-foreground">
                  {stats.total} alert{stats.total !== 1 ? "s" : ""} · {stats.triggered} triggered
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowCreateForm(!showCreateForm)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-sm font-medium text-primary-foreground hover:opacity-90"
            >
              <Plus className="h-3.5 w-3.5" />
              {showCreateForm ? "Cancel" : "New Alert"}
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6 flex-1">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4 mb-6">
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold">{stats.total}</div>
            <div className="text-sm text-muted-foreground">Total</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-bull">{stats.active}</div>
            <div className="text-sm text-muted-foreground">Active</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold text-primary">{stats.triggered}</div>
            <div className="text-sm text-muted-foreground">Triggered</div>
          </div>
        </div>

        {/* Create Alert Form */}
        {showCreateForm && (
          <div className="mb-6 rounded-lg border border-border bg-panel p-6">
            <h3 className="font-semibold mb-4">Create New Alert</h3>
            <CreateAlertForm onClose={() => setShowCreateForm(false)} />
          </div>
        )}

        {/* Search and Filter */}
        {alerts.length > 0 && (
          <div className="border-b border-border pb-4 mb-4 flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="w-full pl-10 pr-4 py-2 rounded-lg border border-border bg-panel text-sm focus:outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div className="flex gap-1">
              {(["all", "active", "triggered", "price", "volume", "indicator"] as AlertFilter[]).map((f) => (
                <button
                  key={f}
                  type="button"
                  onClick={() => setFilter(f)}
                  className={`px-3 py-1.5 text-sm rounded-md transition-colors capitalize ${
                    filter === f
                      ? "bg-primary text-primary-foreground"
                      : "text-muted-foreground hover:bg-accent/50"
                  }`}
                >
                  {f}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Alerts List */}
        {alerts.length === 0 ? (
          <div className="flex items-center justify-center h-64">
            <EmptyState
              title="No alerts"
              description="Create price alerts to get notified when symbols hit your target levels."
              action={{ label: "Create first alert", onClick: () => setShowCreateForm(true) }}
            />
          </div>
        ) : filteredAlerts.length > 0 ? (
          <div className="rounded-lg border border-border bg-panel divide-y divide-border">
            {filteredAlerts.map((alert) => (
              <AlertItem
                key={alert.id}
                alert={alert}
                onDelete={deleteAlert}
                onToggle={toggleAlert}
                onReset={resetAlert}
              />
            ))}
          </div>
        ) : (
          <div className="text-center py-12 text-muted-foreground">
            No alerts match your filter
          </div>
        )}

        {alerts.length > 0 && (
          <div className="mt-4 flex justify-end">
            <button
              type="button"
              onClick={() => {
                if (window.confirm("Delete all alerts?")) {
                  clearAllAlerts();
                }
              }}
              className="text-sm text-muted-foreground hover:text-foreground"
            >
              Clear all alerts
            </button>
          </div>
        )}

        {/* Bottom panel */}
        <div className="border-t border-border bg-panel/50 mt-6 p-3 text-center text-xs text-muted-foreground">
          <ContractPanel message="Alerts are checked against live market quotes and stored locally in your browser" />
        </div>
      </div>
    </div>
  );
}
