import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import {
  Bell,
  Plus,
  Trash2,
  Check,
  TrendingUp,
  TrendingDown,
  Percent,
  Volume2,
  Search,
  AlertTriangle,
  Zap,
  RotateCcw,
  Clock,
  Inbox,
  History,
  CheckCheck,
} from "lucide-react";
import { EmptyState } from "@/components/common/empty-state";
import { ContractPanel } from "@/components/common/contract-panel";
import {
  useAlerts,
  type AlertView,
  type AlertTriggerView,
  type AlertNotificationView,
  type CreatableAlertType,
  type CreateAlertInput,
} from "@/hooks/use-alerts";

export const Route = createFileRoute("/_app/alerts")({
  head: () => ({ meta: [{ title: "Alerts — MAET" }] }),
  component: AlertsPage,
});

type ActiveTab = "definitions" | "history" | "notifications";
type AlertFilter = "all" | "active" | "triggered" | "price" | "percent" | "volume" | "legacy";

function formatThreshold(type: string, threshold: number | null): string {
  if (threshold === null || Number.isNaN(threshold)) return "—";
  if (type.startsWith("PRICE_")) {
    return `₹${threshold.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (type.startsWith("PERCENT_CHANGE_")) {
    return `${threshold > 0 ? "+" : ""}${threshold.toFixed(2)}%`;
  }
  if (type === "VOLUME_ABOVE") {
    return `${threshold.toLocaleString("en-IN")} shares`;
  }
  return String(threshold);
}

function AlertTypeBadge({ type, supported }: { type: string; supported: boolean }) {
  if (!supported) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-amber-500/30 bg-amber-500/10 px-2 py-0.5 text-[10px] font-semibold text-amber-400">
        <AlertTriangle className="h-3 w-3" />
        Unsupported legacy condition
      </span>
    );
  }

  const badgeConfig: Record<string, { label: string; icon: typeof TrendingUp; className: string }> = {
    PRICE_ABOVE: { label: "Price Above", icon: TrendingUp, className: "border-bull/30 bg-bull/10 text-bull" },
    PRICE_BELOW: { label: "Price Below", icon: TrendingDown, className: "border-bear/30 bg-bear/10 text-bear" },
    PERCENT_CHANGE_ABOVE: { label: "Change Above", icon: Percent, className: "border-bull/30 bg-bull/10 text-bull" },
    PERCENT_CHANGE_BELOW: { label: "Change Below", icon: Percent, className: "border-bear/30 bg-bear/10 text-bear" },
    VOLUME_ABOVE: { label: "Volume Above", icon: Volume2, className: "border-purple-500/30 bg-purple-500/10 text-purple-400" },
  };

  const cfg = badgeConfig[type] ?? { label: type, icon: Bell, className: "border-border bg-panel text-muted-foreground" };
  const Icon = cfg.icon;

  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold ${cfg.className}`}>
      <Icon className="h-3 w-3" />
      {cfg.label}
    </span>
  );
}

function CreateAlertModal({ onClose }: { onClose: () => void }) {
  const { createAlert } = useAlerts();
  const [symbol, setSymbol] = useState("");
  const [alertType, setAlertType] = useState<CreatableAlertType>("PRICE_ABOVE");
  const [threshold, setThreshold] = useState("");
  const [mode, setMode] = useState<"one_time" | "repeating">("one_time");
  const [cooldownMinutes, setCooldownMinutes] = useState("60");
  const [label, setLabel] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setFormError(null);

    const parsedThreshold = Number(threshold);
    if (!Number.isFinite(parsedThreshold)) {
      setFormError("Please enter a valid numeric threshold");
      return;
    }

    if (alertType === "PRICE_ABOVE" || alertType === "PRICE_BELOW") {
      if (parsedThreshold <= 0) {
        setFormError("Price threshold must be a positive number");
        return;
      }
    }

    if (alertType === "VOLUME_ABOVE") {
      if (!Number.isInteger(parsedThreshold) || parsedThreshold <= 0) {
        setFormError("Volume threshold must be a positive whole integer of shares");
        return;
      }
    }

    const parsedCooldown = mode === "repeating" ? parseInt(cooldownMinutes, 10) : 60;
    if (mode === "repeating" && (Number.isNaN(parsedCooldown) || parsedCooldown < 1 || parsedCooldown > 10080)) {
      setFormError("Cooldown must be between 1 and 10,080 minutes (1 week)");
      return;
    }

    setIsSubmitting(true);
    const input: CreateAlertInput = {
      symbol: symbol.trim().toUpperCase(),
      label: label.trim() || undefined,
      config: {
        type: alertType,
        threshold: parsedThreshold,
        mode,
        cooldownMinutes: parsedCooldown,
      } as CreateAlertInput["config"],
      enabled: true,
    };

    const res = await createAlert(input);
    setIsSubmitting(false);

    if (res.ok) {
      onClose();
    } else {
      setFormError(res.error ?? res.message ?? "Failed to create alert");
    }
  };

  return (
    <div className="rounded-lg border border-border bg-panel p-6 shadow-xl mb-6">
      <div className="flex items-center justify-between pb-4 border-b border-border">
        <div>
          <h3 className="text-base font-semibold">Create Price & Market Alert</h3>
          <p className="text-xs text-muted-foreground mt-0.5">
            Monitored continuously server-side against live market ticks.
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground text-sm"
        >
          Cancel
        </button>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4 pt-4">
        {formError && (
          <div className="rounded-md border border-bear/30 bg-bear/10 p-3 text-xs text-bear">
            {formError}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Symbol (NSE)
            </label>
            <input
              type="text"
              value={symbol}
              onChange={(e) => setSymbol(e.target.value.toUpperCase())}
              placeholder="e.g. RELIANCE, TCS"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono uppercase focus:outline-none focus:ring-1 focus:ring-primary"
              required
              maxLength={20}
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Label (Optional)
            </label>
            <input
              type="text"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Breakout Target"
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              maxLength={100}
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-2">
            Condition Type
          </label>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
            {(
              [
                { type: "PRICE_ABOVE", label: "Price Above", icon: TrendingUp },
                { type: "PRICE_BELOW", label: "Price Below", icon: TrendingDown },
                { type: "PERCENT_CHANGE_ABOVE", label: "Change Above", icon: Percent },
                { type: "PERCENT_CHANGE_BELOW", label: "Change Below", icon: Percent },
                { type: "VOLUME_ABOVE", label: "Volume Above", icon: Volume2 },
              ] as const
            ).map((item) => {
              const Icon = item.icon;
              const isSelected = alertType === item.type;
              return (
                <button
                  key={item.type}
                  type="button"
                  onClick={() => setAlertType(item.type)}
                  className={`flex flex-col items-center gap-1.5 rounded-lg border p-2.5 text-xs font-medium transition-colors ${
                    isSelected
                      ? "border-primary bg-primary/10 text-primary"
                      : "border-border bg-background text-muted-foreground hover:bg-accent/40"
                  }`}
                >
                  <Icon className="h-4 w-4" />
                  <span>{item.label}</span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              {alertType.startsWith("PRICE_")
                ? "Target Price (₹)"
                : alertType.startsWith("PERCENT_CHANGE_")
                ? "Target Change (%)"
                : "Target Volume (Shares)"}
            </label>
            <input
              type="number"
              value={threshold}
              onChange={(e) => setThreshold(e.target.value)}
              step={alertType.startsWith("PRICE_") ? "0.05" : alertType.startsWith("PERCENT_CHANGE_") ? "0.1" : "1"}
              placeholder={
                alertType.startsWith("PRICE_")
                  ? "2500.00"
                  : alertType.startsWith("PERCENT_CHANGE_")
                  ? "3.5"
                  : "1000000"
              }
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm font-mono focus:outline-none focus:ring-1 focus:ring-primary"
              required
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">
              Trigger Behavior
            </label>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value as "one_time" | "repeating")}
              className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
            >
              <option value="one_time">One-time (auto-disables on trigger)</option>
              <option value="repeating">Repeating (cooldown after trigger)</option>
            </select>
          </div>
        </div>

        {mode === "repeating" && (
          <div className="rounded-md border border-border bg-background/50 p-3">
            <div className="flex items-center justify-between">
              <div>
                <label className="block text-xs font-medium text-foreground">
                  Cooldown Period (Minutes)
                </label>
                <p className="text-[11px] text-muted-foreground mt-0.5">
                  Repeating alerts can trigger again after the cooldown while the condition remains true.
                </p>
              </div>
              <input
                type="number"
                min="1"
                max="10080"
                value={cooldownMinutes}
                onChange={(e) => setCooldownMinutes(e.target.value)}
                className="w-24 rounded-md border border-border bg-background px-2 py-1 text-sm font-mono text-right"
              />
            </div>
          </div>
        )}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-border px-4 py-2 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={isSubmitting}
            className="rounded-md bg-primary px-4 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
          >
            {isSubmitting ? "Creating..." : "Save Alert"}
          </button>
        </div>
      </form>
    </div>
  );
}

function AlertRowItem({
  alert,
  onToggle,
  onRearm,
  onDelete,
}: {
  alert: AlertView;
  onToggle: (id: string) => void;
  onRearm: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const isTriggered = alert.triggered || alert.triggerCount > 0;

  return (
    <div className="flex flex-col sm:flex-row sm:items-center justify-between p-4 gap-3 border-b border-border hover:bg-accent/20 transition-colors">
      <div className="flex items-start sm:items-center gap-3">
        <div
          className={`h-2.5 w-2.5 rounded-full mt-1 sm:mt-0 shrink-0 ${
            alert.enabled ? (isTriggered ? "bg-primary animate-pulse" : "bg-bull") : "bg-muted-foreground/40"
          }`}
          title={alert.enabled ? "Active" : "Disabled"}
        />
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold font-mono text-sm tracking-tight">{alert.symbol}</span>
            <span className="text-[11px] font-mono text-muted-foreground border border-border px-1.5 py-0.2 rounded">
              {alert.exchange}
            </span>
            <AlertTypeBadge type={alert.type} supported={alert.supported} />
            {alert.label && (
              <span className="text-xs text-muted-foreground italic">"{alert.label}"</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground mt-1 flex flex-wrap items-center gap-x-3 gap-y-1">
            <span>
              Target:{" "}
              <strong className="font-mono text-foreground">
                {formatThreshold(alert.type, alert.threshold)}
              </strong>
            </span>
            <span>·</span>
            <span>
              {alert.mode === "repeating" ? `Repeating (${alert.cooldownMinutes}m cooldown)` : "One-time"}
            </span>
            <span>·</span>
            <span>
              Triggered: {alert.triggerCount > 0 ? `${alert.triggerCount} time(s)` : "—"}
            </span>
            <span>·</span>
            <span>
              Last:{" "}
              {alert.lastTriggeredAt
                ? new Date(alert.lastTriggeredAt).toLocaleString("en-IN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })
                : "—"}
            </span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 self-end sm:self-auto shrink-0">
        {/* Rearm action for one-time triggered supported alerts */}
        {alert.supported && alert.mode === "one_time" && alert.triggered && (
          <button
            type="button"
            onClick={() => onRearm(alert.id)}
            className="inline-flex items-center gap-1 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1 text-xs font-medium text-primary hover:bg-primary/20"
            title="Re-arm this alert to monitor condition again"
          >
            <RotateCcw className="h-3 w-3" />
            Re-arm
          </button>
        )}

        {/* Toggle enable / disable */}
        {alert.supported ? (
          <button
            type="button"
            onClick={() => onToggle(alert.id)}
            className={`rounded-md p-1.5 transition-colors ${
              alert.enabled ? "text-bull hover:bg-bull/10" : "text-muted-foreground hover:bg-accent"
            }`}
            title={alert.enabled ? "Disable alert" : "Enable alert"}
          >
            <Zap className="h-4 w-4" fill={alert.enabled ? "currentColor" : "none"} />
          </button>
        ) : (
          <button
            type="button"
            onClick={() => alert.enabled && onToggle(alert.id)}
            disabled={!alert.enabled}
            className="rounded-md p-1.5 text-muted-foreground/50 cursor-not-allowed"
            title="Cannot enable unsupported legacy condition"
          >
            <Zap className="h-4 w-4" />
          </button>
        )}

        {/* Delete */}
        <button
          type="button"
          onClick={() => onDelete(alert.id)}
          className="rounded-md p-1.5 text-muted-foreground hover:bg-bear/10 hover:text-bear"
          title="Delete alert"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      </div>
    </div>
  );
}

function HistoryTab({ history }: { history: AlertTriggerView[] }) {
  if (history.length === 0) {
    return (
      <EmptyState
        title="No trigger events recorded"
        description="Trigger events will appear here whenever your active alerts fire against market ticks."
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-panel">
      {history.map((item) => (
        <div key={item.id} className="p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold font-mono text-sm">{item.symbol}</span>
              <span className="text-[11px] font-mono text-muted-foreground border border-border px-1.5 py-0.2 rounded">
                {item.exchange}
              </span>
              <span className="text-xs font-semibold px-2 py-0.5 rounded-full border border-primary/30 bg-primary/10 text-primary">
                {item.conditionType}
              </span>
              <span className="text-xs text-muted-foreground font-mono">[{item.provider}]</span>
            </div>
            <div className="text-xs text-foreground mt-1">{item.message ?? "Alert triggered"}</div>
            <div className="text-xs text-muted-foreground mt-1 flex flex-wrap gap-x-3">
              <span>Observed: <strong className="font-mono text-foreground">{item.observedValue !== null ? item.observedValue : "—"}</strong></span>
              <span>Target: <strong className="font-mono text-foreground">{item.targetValue !== null ? item.targetValue : "—"}</strong></span>
            </div>
          </div>
          <div className="text-right text-xs text-muted-foreground shrink-0">
            <div>
              Triggered:{" "}
              <strong className="font-mono text-foreground">
                {new Date(item.triggeredAt).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
              </strong>
            </div>
            {item.providerTimestamp && (
              <div className="text-[11px]">
                Market tick:{" "}
                <span className="font-mono">
                  {new Date(item.providerTimestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </span>
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

function NotificationsTab({
  notifications,
  onMarkRead,
  onDismiss,
}: {
  notifications: AlertNotificationView[];
  onMarkRead: (id: string) => void;
  onDismiss: (id: string) => void;
}) {
  if (notifications.length === 0) {
    return (
      <EmptyState
        title="No active notifications"
        description="In-app alerts and notifications will appear here when triggered."
      />
    );
  }

  return (
    <div className="divide-y divide-border rounded-lg border border-border bg-panel">
      {notifications.map((item) => {
        const isUnread = !item.readAt;
        return (
          <div
            key={item.id}
            className={`p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 ${
              isUnread ? "bg-primary/5" : ""
            }`}
          >
            <div className="flex items-start gap-3">
              <div
                className={`h-2 w-2 rounded-full mt-1.5 shrink-0 ${
                  isUnread ? "bg-primary animate-pulse" : "bg-muted-foreground/30"
                }`}
              />
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-semibold text-sm">{item.title}</span>
                  {item.symbol && (
                    <span className="font-mono text-xs border border-border px-1.5 rounded text-muted-foreground">
                      {item.symbol}
                    </span>
                  )}
                  {isUnread && (
                    <span className="text-[10px] uppercase font-bold text-primary bg-primary/10 px-1.5 py-0.5 rounded">
                      New
                    </span>
                  )}
                </div>
                {item.body && <div className="text-xs text-muted-foreground mt-0.5">{item.body}</div>}
                <div className="text-[11px] text-muted-foreground mt-1">
                  {new Date(item.createdAt).toLocaleString("en-IN", {
                    month: "short",
                    day: "numeric",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
              </div>
            </div>

            <div className="flex items-center gap-2 self-end sm:self-auto shrink-0">
              {isUnread && (
                <button
                  type="button"
                  onClick={() => onMarkRead(item.id)}
                  className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2.5 py-1 text-xs font-medium text-muted-foreground hover:text-foreground hover:bg-accent/40"
                  title="Mark as read"
                >
                  <Check className="h-3.5 w-3.5" />
                  Mark Read
                </button>
              )}
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                className="rounded-md border border-border bg-background p-1 text-muted-foreground hover:text-bear hover:bg-bear/10"
                title="Dismiss notification"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

function AlertsPage() {
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [activeTab, setActiveTab] = useState<ActiveTab>("definitions");
  const [filter, setFilter] = useState<AlertFilter>("all");
  const [searchQuery, setSearchQuery] = useState("");

  const {
    alerts,
    activeAlerts,
    triggeredAlerts,
    unsupportedAlerts,
    triggerHistory,
    notifications,
    isLoading,
    toggleAlert,
    rearmAlert,
    deleteAlert,
    markNotificationRead,
    dismissNotification,
  } = useAlerts();

  const filteredAlerts = useMemo(() => {
    let result = alerts;
    if (filter === "active") result = activeAlerts;
    else if (filter === "triggered") result = triggeredAlerts;
    else if (filter === "price") result = alerts.filter((a) => a.type.startsWith("PRICE_"));
    else if (filter === "percent") result = alerts.filter((a) => a.type.startsWith("PERCENT_CHANGE_"));
    else if (filter === "volume") result = alerts.filter((a) => a.type === "VOLUME_ABOVE");
    else if (filter === "legacy") result = unsupportedAlerts;

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = result.filter(
        (a) => a.symbol.toLowerCase().includes(q) || (a.label && a.label.toLowerCase().includes(q))
      );
    }
    return result;
  }, [alerts, activeAlerts, triggeredAlerts, unsupportedAlerts, filter, searchQuery]);

  const stats = useMemo(
    () => ({
      total: alerts.length,
      active: activeAlerts.length,
      triggered: triggeredAlerts.length,
      unsupported: unsupportedAlerts.length,
    }),
    [alerts, activeAlerts, triggeredAlerts, unsupportedAlerts]
  );

  const unreadNotificationCount = useMemo(
    () => notifications.filter((n) => !n.readAt).length,
    [notifications]
  );

  return (
    <div className="flex h-full flex-col">
      {/* Header */}
      <div className="sticky top-0 z-40 border-b border-border/60 bg-background/70 backdrop-blur-xl">
        <div className="mx-auto max-w-7xl px-6 py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <Bell className="h-5 w-5 text-primary" />
              <div>
                <h1 className="text-xl font-semibold tracking-tight">Alerts</h1>
                <p className="text-xs text-muted-foreground">
                  {stats.total} total · {stats.active} active · {stats.triggered} triggered
                </p>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setShowCreateModal(true)}
              className="flex items-center gap-1.5 rounded-md bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 transition-opacity"
            >
              <Plus className="h-3.5 w-3.5" />
              New Alert
            </button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 py-6 flex-1 w-full">
        {/* Stat Cards */}
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mb-6">
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold font-mono">{stats.total}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Total Definitions</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold font-mono text-bull">{stats.active}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Active Monitoring</div>
          </div>
          <div className="rounded-lg border border-border bg-panel p-4">
            <div className="text-2xl font-bold font-mono text-primary">{stats.triggered}</div>
            <div className="text-xs text-muted-foreground mt-0.5">Triggered Alerts</div>
          </div>
          {stats.unsupported > 0 ? (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4">
              <div className="text-2xl font-bold font-mono text-amber-400">{stats.unsupported}</div>
              <div className="text-xs text-amber-400/80 mt-0.5">Unsupported Legacy</div>
            </div>
          ) : (
            <div className="rounded-lg border border-border bg-panel p-4">
              <div className="text-2xl font-bold font-mono text-muted-foreground">
                {unreadNotificationCount}
              </div>
              <div className="text-xs text-muted-foreground mt-0.5">Unread Notifications</div>
            </div>
          )}
        </div>

        {/* Modal / Form */}
        {showCreateModal && <CreateAlertModal onClose={() => setShowCreateModal(false)} />}

        {/* Navigation Tabs */}
        <div className="flex items-center gap-2 border-b border-border pb-3 mb-6">
          <button
            type="button"
            onClick={() => setActiveTab("definitions")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "definitions"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/40"
            }`}
          >
            <Bell className="h-3.5 w-3.5" />
            Alert Definitions ({stats.total})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("history")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "history"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/40"
            }`}
          >
            <History className="h-3.5 w-3.5" />
            Trigger History ({triggerHistory.length})
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("notifications")}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
              activeTab === "notifications"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-accent/40"
            }`}
          >
            <Inbox className="h-3.5 w-3.5" />
            Notifications ({notifications.length})
            {unreadNotificationCount > 0 && (
              <span className="ml-1 rounded-full bg-primary/20 px-1.5 py-0.2 text-[10px] font-bold text-primary">
                {unreadNotificationCount}
              </span>
            )}
          </button>
        </div>

        {/* Tab Content */}
        {activeTab === "definitions" && (
          <div>
            {/* Search and Filters */}
            {alerts.length > 0 && (
              <div className="flex flex-col sm:flex-row gap-3 items-center justify-between mb-4">
                <div className="relative w-full sm:max-w-xs">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
                  <input
                    type="text"
                    placeholder="Search by symbol or label..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-3 py-1.5 rounded-md border border-border bg-panel text-xs focus:outline-none focus:ring-1 focus:ring-primary"
                  />
                </div>

                <div className="flex flex-wrap gap-1 w-full sm:w-auto">
                  {(
                    [
                      { id: "all", label: "All" },
                      { id: "active", label: "Active" },
                      { id: "triggered", label: "Triggered" },
                      { id: "price", label: "Price" },
                      { id: "percent", label: "Change %" },
                      { id: "volume", label: "Volume" },
                      ...(stats.unsupported > 0 ? [{ id: "legacy", label: "Legacy" }] : []),
                    ] as const
                  ).map((f) => (
                    <button
                      key={f.id}
                      type="button"
                      onClick={() => setFilter(f.id as AlertFilter)}
                      className={`px-2.5 py-1 text-xs rounded-md transition-colors ${
                        filter === f.id
                          ? "bg-accent text-foreground font-semibold"
                          : "text-muted-foreground hover:bg-accent/40"
                      }`}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {/* Alert List */}
            {isLoading ? (
              <div className="text-center py-12 text-xs text-muted-foreground">Loading alerts...</div>
            ) : alerts.length === 0 ? (
              <EmptyState
                title="No alert definitions"
                description="Create price, percentage change, or volume alerts to monitor symbols continuously on the server."
                action={{ label: "Create First Alert", onClick: () => setShowCreateModal(true) }}
              />
            ) : filteredAlerts.length > 0 ? (
              <div className="rounded-lg border border-border bg-panel divide-y divide-border">
                {filteredAlerts.map((alert) => (
                  <AlertRowItem
                    key={alert.id}
                    alert={alert}
                    onToggle={toggleAlert}
                    onRearm={rearmAlert}
                    onDelete={deleteAlert}
                  />
                ))}
              </div>
            ) : (
              <div className="text-center py-12 text-xs text-muted-foreground">
                No alerts match the selected filter.
              </div>
            )}
          </div>
        )}

        {activeTab === "history" && <HistoryTab history={triggerHistory} />}

        {activeTab === "notifications" && (
          <NotificationsTab
            notifications={notifications}
            onMarkRead={markNotificationRead}
            onDismiss={dismissNotification}
          />
        )}

        {/* Truthful Contract Panel */}
        <div className="mt-8">
          <ContractPanel message="Alerts are stored in your account and evaluated server-side against verified market ticks. Delivery is currently in-app." />
        </div>
      </div>
    </div>
  );
}
