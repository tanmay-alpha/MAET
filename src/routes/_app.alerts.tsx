import { createFileRoute } from "@tanstack/react-router";
import { useState, useMemo } from "react";
import { Plus, Trash2, Search } from "lucide-react";
import { SignedOutNotice } from "@/components/common/signed-out-notice";
import { useSignedIn } from "@/hooks/use-signed-in";
import { sourceName } from "@/lib/quote-source";
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

const CONDITIONS: { type: CreatableAlertType; label: string }[] = [
  { type: "PRICE_ABOVE", label: "Price above" },
  { type: "PRICE_BELOW", label: "Price below" },
  { type: "PERCENT_CHANGE_ABOVE", label: "Change % above" },
  { type: "PERCENT_CHANGE_BELOW", label: "Change % below" },
  { type: "VOLUME_ABOVE", label: "Volume above" },
];

const CONDITION_LABEL: Record<string, string> = Object.fromEntries(CONDITIONS.map((c) => [c.type, c.label]));

const INPUT = "w-full rounded border border-border bg-background px-2.5 py-1.5 text-sm focus:border-primary/60 focus:outline-none";

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

function shortTime(value: string): string {
  return new Date(value).toLocaleString("en-IN", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function CreateAlertForm({ onClose }: { onClose: () => void }) {
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
      setFormError("Enter a numeric threshold.");
      return;
    }

    if ((alertType === "PRICE_ABOVE" || alertType === "PRICE_BELOW") && parsedThreshold <= 0) {
      setFormError("Price threshold must be above zero.");
      return;
    }

    if (alertType === "VOLUME_ABOVE" && (!Number.isInteger(parsedThreshold) || parsedThreshold <= 0)) {
      setFormError("Volume threshold must be a whole number of shares above zero.");
      return;
    }

    const parsedCooldown = mode === "repeating" ? parseInt(cooldownMinutes, 10) : 60;
    if (mode === "repeating" && (Number.isNaN(parsedCooldown) || parsedCooldown < 1 || parsedCooldown > 10080)) {
      setFormError("Cooldown must be between 1 and 10,080 minutes (one week).");
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

  const thresholdLabel = alertType.startsWith("PRICE_") ? "Price (₹)" : alertType.startsWith("PERCENT_CHANGE_") ? "Change vs previous close (%)" : "Volume (shares)";

  return (
    <form onSubmit={handleSubmit} aria-labelledby="new-alert-title" className="space-y-3 rounded border border-border bg-panel p-3 sm:p-4">
      <h2 id="new-alert-title" className="text-sm font-semibold">
        New alert
      </h2>

      {formError && (
        <p role="alert" className="rounded border border-bear/30 bg-bear/10 px-3 py-2 text-xs text-bear">
          {formError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">NSE symbol</span>
          <input
            type="text"
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            placeholder="RELIANCE"
            className={`${INPUT} font-mono uppercase`}
            required
            maxLength={20}
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">Label (optional)</span>
          <input type="text" value={label} onChange={(e) => setLabel(e.target.value)} className={INPUT} maxLength={100} />
        </label>
      </div>

      <fieldset className="space-y-1 text-xs">
        <legend className="mb-1 text-muted-foreground">Condition</legend>
        <div className="flex flex-wrap gap-1">
          {CONDITIONS.map((item) => (
            <button
              key={item.type}
              type="button"
              aria-pressed={alertType === item.type}
              onClick={() => setAlertType(item.type)}
              className={`rounded border px-2.5 py-1 transition-colors ${
                alertType === item.type ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </fieldset>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">{thresholdLabel}</span>
          <input
            type="number"
            value={threshold}
            onChange={(e) => setThreshold(e.target.value)}
            step={alertType.startsWith("PRICE_") ? "0.05" : alertType.startsWith("PERCENT_CHANGE_") ? "0.1" : "1"}
            className={`${INPUT} font-mono`}
            required
          />
        </label>
        <label className="block space-y-1 text-xs">
          <span className="text-muted-foreground">When it triggers</span>
          <select value={mode} onChange={(e) => setMode(e.target.value as "one_time" | "repeating")} className={INPUT}>
            <option value="one_time">Fire once, then disable</option>
            <option value="repeating">Repeat after a cooldown</option>
          </select>
        </label>
        {mode === "repeating" && (
          <label className="block space-y-1 text-xs">
            <span className="text-muted-foreground">Cooldown (minutes)</span>
            <input
              type="number"
              min="1"
              max="10080"
              value={cooldownMinutes}
              onChange={(e) => setCooldownMinutes(e.target.value)}
              className={`${INPUT} font-mono`}
            />
          </label>
        )}
      </div>

      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <button type="button" onClick={onClose} className="rounded border border-border px-3 py-1.5 text-xs text-muted-foreground hover:text-foreground">
          Cancel
        </button>
        <button
          type="submit"
          disabled={isSubmitting}
          className="rounded bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {isSubmitting ? "Saving…" : "Save alert"}
        </button>
      </div>
    </form>
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
  const state = !alert.enabled ? "Disabled" : alert.triggered ? "Triggered" : "Watching";
  const stateClass = !alert.enabled ? "text-muted-foreground" : alert.triggered ? "text-primary" : "text-bull";
  const smallButton = "rounded border border-border px-2 py-0.5 text-[11px] transition-colors";

  return (
    <li className="flex flex-col gap-2 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span className="font-mono text-sm font-semibold">{alert.symbol}</span>
          <span className="text-[10px] text-muted-foreground">{alert.exchange}</span>
          {alert.supported ? (
            <span>
              {CONDITION_LABEL[alert.type] ?? alert.type}{" "}
              <span className="font-mono tabular-nums">{formatThreshold(alert.type, alert.threshold)}</span>
            </span>
          ) : (
            <span className="text-amber-400">Unsupported legacy condition</span>
          )}
          <span className={`text-[11px] ${stateClass}`}>{state}</span>
          {alert.label && <span className="truncate text-muted-foreground">{alert.label}</span>}
        </div>
        <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
          <span>{alert.mode === "repeating" ? `Repeats, ${alert.cooldownMinutes} min cooldown` : "Fires once"}</span>
          <span>
            Fired <span className="font-mono tabular-nums">{alert.triggerCount}</span>×
          </span>
          {alert.lastTriggeredAt && <span>Last {shortTime(alert.lastTriggeredAt)}</span>}
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-1.5">
        {alert.supported && alert.mode === "one_time" && alert.triggered && (
          <button
            type="button"
            onClick={() => onRearm(alert.id)}
            className={`${smallButton} border-primary/40 text-primary hover:bg-primary/10`}
            title="Watch the condition again"
          >
            Re-arm
          </button>
        )}

        {alert.supported ? (
          <button type="button" onClick={() => onToggle(alert.id)} className={`${smallButton} text-muted-foreground hover:text-foreground`}>
            {alert.enabled ? "Disable" : "Enable"}
          </button>
        ) : (
          <button
            type="button"
            onClick={() => alert.enabled && onToggle(alert.id)}
            disabled={!alert.enabled}
            className={`${smallButton} text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40`}
            title="Cannot enable unsupported legacy condition"
          >
            {alert.enabled ? "Disable" : "Enable"}
          </button>
        )}

        <button
          type="button"
          onClick={() => onDelete(alert.id)}
          className="rounded p-1 text-muted-foreground hover:text-bear"
          aria-label={`Delete ${alert.symbol} alert`}
          title="Delete alert"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function EmptyLine({ children }: { children: React.ReactNode }) {
  return <p className="rounded border border-border bg-panel px-3 py-4 text-xs text-muted-foreground">{children}</p>;
}

function HistoryTab({ history }: { history: AlertTriggerView[] }) {
  if (history.length === 0) return <EmptyLine>No alert has fired yet.</EmptyLine>;

  return (
    <ul className="divide-y divide-border rounded border border-border bg-panel">
      {history.map((item) => (
        <li key={item.id} className="flex flex-col gap-1 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0 space-y-0.5">
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-mono text-sm font-semibold">{item.symbol}</span>
              <span className="text-[10px] text-muted-foreground">{item.exchange}</span>
              <span>{CONDITION_LABEL[item.conditionType] ?? item.conditionType}</span>
            </div>
            {item.message && <p className="text-muted-foreground">{item.message}</p>}
            <div className="flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
              <span>
                Observed <span className="font-mono tabular-nums text-foreground">{formatThreshold(item.conditionType, item.observedValue)}</span>
              </span>
              <span>
                Target <span className="font-mono tabular-nums text-foreground">{formatThreshold(item.conditionType, item.targetValue)}</span>
              </span>
            </div>
          </div>
          <div className="shrink-0 text-[11px] text-muted-foreground sm:text-right">
            <div className="font-mono tabular-nums text-foreground">{shortTime(item.triggeredAt)}</div>
            <div>
              {sourceName(item.provider)}
              {item.providerTimestamp && (
                <>
                  {" "}
                  tick{" "}
                  <span className="font-mono tabular-nums">
                    {new Date(item.providerTimestamp).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                  </span>
                </>
              )}
            </div>
          </div>
        </li>
      ))}
    </ul>
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
  if (notifications.length === 0) return <EmptyLine>No notifications.</EmptyLine>;

  return (
    <ul className="divide-y divide-border rounded border border-border bg-panel">
      {notifications.map((item) => {
        const isUnread = !item.readAt;
        return (
          <li key={item.id} className="flex flex-col gap-2 px-3 py-2.5 text-xs sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <div className="flex flex-wrap items-baseline gap-x-2">
                <span className={isUnread ? "font-semibold" : "text-muted-foreground"}>{item.title}</span>
                {item.symbol && <span className="font-mono text-[11px] text-muted-foreground">{item.symbol}</span>}
                {isUnread && <span className="text-[10px] font-semibold uppercase text-primary">New</span>}
              </div>
              {item.body && <p className="text-muted-foreground">{item.body}</p>}
              <div className="font-mono text-[11px] tabular-nums text-muted-foreground">{shortTime(item.createdAt)}</div>
            </div>

            <div className="flex shrink-0 items-center gap-1.5">
              {isUnread && (
                <button
                  type="button"
                  onClick={() => onMarkRead(item.id)}
                  className="rounded border border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:text-foreground"
                >
                  Mark read
                </button>
              )}
              <button
                type="button"
                onClick={() => onDismiss(item.id)}
                className="rounded p-1 text-muted-foreground hover:text-bear"
                aria-label="Dismiss notification"
                title="Dismiss notification"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function AlertsPage() {
  const signedIn = useSignedIn();
  const [showCreateForm, setShowCreateForm] = useState(false);
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
    isError,
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

    const q = searchQuery.trim().toLowerCase();
    if (q) {
      result = result.filter((a) => a.symbol.toLowerCase().includes(q) || (a.label && a.label.toLowerCase().includes(q)));
    }
    return result;
  }, [alerts, activeAlerts, triggeredAlerts, unsupportedAlerts, filter, searchQuery]);

  const unreadNotificationCount = useMemo(() => notifications.filter((n) => !n.readAt).length, [notifications]);

  const ready = signedIn && !isError && !isLoading;
  const tabs: { id: ActiveTab; label: string; count: number }[] = [
    { id: "definitions", label: "Alerts", count: alerts.length },
    { id: "history", label: "Trigger history", count: triggerHistory.length },
    { id: "notifications", label: "Notifications", count: notifications.length },
  ];
  const filters: { id: AlertFilter; label: string }[] = [
    { id: "all", label: "All" },
    { id: "active", label: "Active" },
    { id: "triggered", label: "Triggered" },
    { id: "price", label: "Price" },
    { id: "percent", label: "Change %" },
    { id: "volume", label: "Volume" },
    ...(unsupportedAlerts.length > 0 ? [{ id: "legacy" as const, label: `Legacy ${unsupportedAlerts.length}` }] : []),
  ];

  return (
    <div className="h-full overflow-y-auto bg-background">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border px-4 py-3 sm:px-5">
        <h1 className="text-lg font-semibold tracking-tight sm:text-xl">Alerts</h1>
        {ready && (
          <span className="font-mono text-xs tabular-nums text-muted-foreground">
            {activeAlerts.length} active · {triggeredAlerts.length} triggered
            {unreadNotificationCount > 0 && ` · ${unreadNotificationCount} unread`}
          </span>
        )}
        {ready && !showCreateForm && (
          <button
            type="button"
            onClick={() => setShowCreateForm(true)}
            className="ml-auto inline-flex items-center gap-1 rounded bg-primary px-2.5 py-1.5 text-xs font-medium text-primary-foreground hover:opacity-90"
          >
            <Plus className="h-3.5 w-3.5" />
            New alert
          </button>
        )}
      </header>

      <div className="mx-auto w-full max-w-5xl space-y-3 p-4 sm:p-5">
        {!signedIn ? (
          <SignedOutNotice feature="Price alerts" />
        ) : isError ? (
          <p role="status" className="rounded border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-400">
            Alerts could not be loaded right now.
          </p>
        ) : isLoading ? (
          <p className="text-xs text-muted-foreground">Loading alerts…</p>
        ) : (
          <>
            {showCreateForm && <CreateAlertForm onClose={() => setShowCreateForm(false)} />}

            <div className="flex overflow-x-auto border-b border-border" role="tablist" aria-label="Alert views">
              {tabs.map((tab) => (
                <button
                  key={tab.id}
                  type="button"
                  role="tab"
                  aria-selected={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className={`shrink-0 whitespace-nowrap border-b-2 px-3 py-1.5 text-xs transition-colors ${
                    activeTab === tab.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {tab.label} <span className="font-mono tabular-nums">{tab.count}</span>
                </button>
              ))}
            </div>

            {activeTab === "definitions" &&
              (alerts.length === 0 ? (
                <EmptyLine>
                  No alerts yet.{" "}
                  {!showCreateForm && (
                    <button type="button" onClick={() => setShowCreateForm(true)} className="text-primary hover:underline">
                      Create one
                    </button>
                  )}
                </EmptyLine>
              ) : (
                <>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <label className="relative block w-full sm:max-w-xs">
                      <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <input
                        type="search"
                        aria-label="Search alerts"
                        placeholder="Symbol or label"
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full rounded border border-border bg-panel py-1.5 pl-8 pr-3 text-xs focus:border-primary/60 focus:outline-none"
                      />
                    </label>
                    <div className="flex flex-wrap gap-1">
                      {filters.map((f) => (
                        <button
                          key={f.id}
                          type="button"
                          aria-pressed={filter === f.id}
                          onClick={() => setFilter(f.id)}
                          className={`shrink-0 rounded border px-2.5 py-1 text-xs transition-colors ${
                            filter === f.id ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:text-foreground"
                          }`}
                        >
                          {f.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {filteredAlerts.length > 0 ? (
                    <ul className="divide-y divide-border rounded border border-border bg-panel">
                      {filteredAlerts.map((alert) => (
                        <AlertRowItem key={alert.id} alert={alert} onToggle={toggleAlert} onRearm={rearmAlert} onDelete={deleteAlert} />
                      ))}
                    </ul>
                  ) : (
                    <EmptyLine>No alerts match this filter.</EmptyLine>
                  )}
                </>
              ))}

            {activeTab === "history" && <HistoryTab history={triggerHistory} />}

            {activeTab === "notifications" && (
              <NotificationsTab notifications={notifications} onMarkRead={markNotificationRead} onDismiss={dismissNotification} />
            )}

            <p className="text-[11px] text-muted-foreground">Checked on the server against each quote tick. Notifications are in-app only.</p>
          </>
        )}
      </div>
    </div>
  );
}
