import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { CreatableAlertTypeSchema } from "../../server/modules/alerts/contracts";
import { AlertRowItem, CONDITIONS, formatThreshold, HistoryTab, NotificationsTab } from "@/components/alerts/alert-lists";
import { summarizeAlerts, type AlertTriggerView, type AlertView } from "@/hooks/use-alerts";
import { trpc } from "@/lib/trpc";

const noop = () => {};

function alert(overrides: Partial<AlertView> = {}): AlertView {
  return {
    id: "a1",
    symbol: "RELIANCE",
    exchange: "NSE",
    type: "PRICE_ABOVE",
    label: null,
    threshold: 2500,
    enabled: true,
    mode: "one_time",
    cooldownMinutes: 60,
    triggered: false,
    triggeredAt: null,
    lastTriggeredAt: null,
    triggerCount: 0,
    supported: true,
    createdAt: "2026-11-02T04:00:00.000Z",
    updatedAt: "2026-11-02T04:00:00.000Z",
    ...overrides,
  };
}

function row(item: AlertView): string {
  return renderToStaticMarkup(createElement(AlertRowItem, { alert: item, onToggle: noop, onRearm: noop, onDelete: noop }));
}

describe("alert conditions", () => {
  it("offers exactly the condition types the server can create", () => {
    expect(CONDITIONS.map((condition) => condition.type)).toEqual(CreatableAlertTypeSchema.options);
  });

  it("shows a dash for a missing threshold instead of inventing zero", () => {
    expect(formatThreshold("PRICE_ABOVE", null)).toBe("—");
    expect(formatThreshold("VOLUME_ABOVE", Number.NaN)).toBe("—");
    expect(formatThreshold("PRICE_ABOVE", 0)).toBe("₹0.00");
  });
});

describe("summarizeAlerts", () => {
  it("counts only enabled, supported alerts as active", () => {
    const { activeAlerts, triggeredAlerts, unsupportedAlerts } = summarizeAlerts([
      alert({ id: "on" }),
      alert({ id: "off", enabled: false }),
      alert({ id: "legacy", supported: false }),
      alert({ id: "fired", triggered: true, triggerCount: 1 }),
    ]);

    expect(activeAlerts.map((a) => a.id)).toEqual(["on", "fired"]);
    expect(triggeredAlerts.map((a) => a.id)).toEqual(["fired"]);
    expect(unsupportedAlerts.map((a) => a.id)).toEqual(["legacy"]);
  });
});

describe("AlertRowItem", () => {
  it("offers Re-arm only for a triggered one-time alert", () => {
    expect(row(alert({ triggered: true }))).toContain("Re-arm");
    expect(row(alert({ triggered: true, mode: "repeating" }))).not.toContain("Re-arm");
    expect(row(alert())).not.toContain("Re-arm");
  });

  it("marks a legacy condition and will not let it be enabled", () => {
    const markup = row(alert({ supported: false, enabled: false }));

    expect(markup).toContain("Unsupported legacy condition");
    expect(markup).toMatch(/<button[^>]*disabled=""[^>]*>Enable<\/button>/);
    expect(markup).not.toContain("₹2,500.00");
  });
});

describe("HistoryTab", () => {
  it("names the quote provider and leaves missing values blank", () => {
    const fired: AlertTriggerView = {
      id: "t1",
      alertId: "a1",
      symbol: "RELIANCE",
      exchange: "NSE",
      conditionType: "PRICE_ABOVE",
      observedValue: 2510,
      targetValue: null,
      message: null,
      provider: "angelone",
      providerTimestamp: null,
      triggeredAt: "2026-11-02T04:00:00.000Z",
    };
    const markup = renderToStaticMarkup(createElement(HistoryTab, { history: [fired] }));

    expect(markup).toContain("Angel One");
    expect(markup).toContain("₹2,510.00");
    expect(markup).toMatch(/Target <span[^>]*>—<\/span>/);
    expect(markup).not.toContain("tick");
  });
});

describe("NotificationsTab", () => {
  it("offers Mark read only for unread notifications", () => {
    const base = { kind: "ALERT_TRIGGERED", body: null, symbol: "RELIANCE", alertId: "a1", alertEventId: "t1", dismissedAt: null, createdAt: "2026-11-02T04:00:00.000Z" };
    const unread = renderToStaticMarkup(
      createElement(NotificationsTab, { notifications: [{ ...base, id: "n1", title: "Fired", readAt: null }], onMarkRead: noop, onDismiss: noop }),
    );
    const read = renderToStaticMarkup(
      createElement(NotificationsTab, { notifications: [{ ...base, id: "n2", title: "Fired", readAt: base.createdAt }], onMarkRead: noop, onDismiss: noop }),
    );

    expect(unread).toContain("Mark read");
    expect(read).not.toContain("Mark read");
    expect(read).toContain("Dismiss notification");
  });
});

describe("alertsEngine client", () => {
  const originalFetch = globalThis.fetch;
  let posted: { path: string; body: unknown }[] = [];

  beforeEach(() => {
    posted = [];
    globalThis.window = { localStorage: { getItem: () => null, setItem: noop, removeItem: noop } } as unknown as Window & typeof globalThis;
    globalThis.fetch = mock(async (url: string | URL | Request, init?: RequestInit) => {
      posted.push({ path: new URL(String(url), "http://localhost").pathname, body: JSON.parse(String(init?.body)) });
      return new Response(JSON.stringify({ result: { data: { success: true } } }), { status: 200 });
    }) as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("sends re-arm, mark-read and dismiss to the server procedures", async () => {
    await trpc.alertsEngine.rearmAlert.mutate({ alertId: "a1" });
    await trpc.alertsEngine.markNotificationRead.mutate({ notificationId: "n1" });
    await trpc.alertsEngine.dismissNotification.mutate({ notificationId: "n1" });

    expect(posted).toEqual([
      { path: "/api/trpc/alertsEngine.rearmAlert", body: { alertId: "a1" } },
      { path: "/api/trpc/alertsEngine.markNotificationRead", body: { notificationId: "n1" } },
      { path: "/api/trpc/alertsEngine.dismissNotification", body: { notificationId: "n1" } },
    ]);
  });
});
