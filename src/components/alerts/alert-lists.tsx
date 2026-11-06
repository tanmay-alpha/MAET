import type { ReactNode } from "react";
import { Trash2 } from "lucide-react";
import { sourceName } from "@/lib/quote-source";
import type { AlertNotificationView, AlertTriggerView, AlertView, CreatableAlertType } from "@/hooks/use-alerts";

export const CONDITIONS: { type: CreatableAlertType; label: string }[] = [
  { type: "PRICE_ABOVE", label: "Price above" },
  { type: "PRICE_BELOW", label: "Price below" },
  { type: "PERCENT_CHANGE_ABOVE", label: "Change % above" },
  { type: "PERCENT_CHANGE_BELOW", label: "Change % below" },
  { type: "VOLUME_ABOVE", label: "Volume above" },
];

const CONDITION_LABEL: Record<string, string> = Object.fromEntries(CONDITIONS.map((c) => [c.type, c.label]));

export function formatThreshold(type: string, threshold: number | null): string {
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

export function AlertRowItem({
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

export function EmptyLine({ children }: { children: ReactNode }) {
  return <p className="rounded border border-border bg-panel px-3 py-4 text-xs text-muted-foreground">{children}</p>;
}

export function HistoryTab({ history }: { history: AlertTriggerView[] }) {
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

export function NotificationsTab({
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
