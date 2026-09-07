import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { CreatableAlertTypeSchema, isSupportedAlertType } from "../../server/modules/alerts/contracts";

describe("Alerts Route & UX Integrity Suite (Checkpoint 3)", () => {
  const alertsRoutePath = resolve(import.meta.dir, "_app.alerts.tsx");
  const alertsHookPath = resolve(import.meta.dir, "../hooks/use-alerts.ts");
  const trpcClientPath = resolve(import.meta.dir, "../lib/trpc.ts");

  const alertsRouteContent = readFileSync(alertsRoutePath, "utf-8");
  const alertsHookContent = readFileSync(alertsHookPath, "utf-8");
  const trpcClientContent = readFileSync(trpcClientPath, "utf-8");

  it("1. Canonical alertsEngine API is used across frontend hook and client", () => {
    expect(alertsHookContent).toContain('queryKey: ["alertsEngine", "listAlerts"]');
    expect(alertsHookContent).toContain("trpc.alertsEngine.listAlerts.query");
    expect(alertsHookContent).toContain("trpc.alertsEngine.createAlert.mutate");
    expect(trpcClientContent).toContain("alertsEngine:");
  });

  it("2. No trpc.alerts stub namespace is referenced anywhere in alerts code", () => {
    expect(alertsRouteContent).not.toContain("trpc.alerts.");
    expect(alertsHookContent).not.toContain("trpc.alerts.");
    expect(trpcClientContent).not.toContain("alerts: {");
  });

  it("3. No volume_spike -> VOLUME_SPIKE transformation exists", () => {
    expect(alertsRouteContent).not.toContain("volume_spike");
    expect(alertsHookContent).not.toContain("volume_spike");
    expect(alertsHookContent).not.toContain("input.type.toUpperCase()");
  });

  it("4. No generic INDICATOR alert creation exists", () => {
    expect(alertsRouteContent).not.toContain('"indicator"');
    expect(alertsHookContent).not.toContain('"indicator"');
    expect(alertsRouteContent).not.toContain("INDICATOR");
  });

  it("5. Only the five production-supported creation types are exposed", () => {
    const supported = CreatableAlertTypeSchema.options;
    expect(supported).toEqual([
      "PRICE_ABOVE",
      "PRICE_BELOW",
      "PERCENT_CHANGE_ABOVE",
      "PERCENT_CHANGE_BELOW",
      "VOLUME_ABOVE",
    ]);

    for (const t of supported) {
      expect(alertsRouteContent).toContain(t);
    }
  });

  it("6. No target ?? 0 fabrication exists in hook or UI", () => {
    expect(alertsHookContent).not.toContain("target ?? 0");
    expect(alertsRouteContent).not.toContain("target ?? 0");
    expect(alertsHookContent).not.toContain("threshold ?? 0");
  });

  it("7. No fabricated createdAt new Date() fallback exists", () => {
    expect(alertsHookContent).not.toContain("new Date().toISOString()");
  });

  it("8. Rearm uses real server procedure alertsEngine.rearmAlert", () => {
    expect(alertsHookContent).toContain("trpc.alertsEngine.rearmAlert.mutate");
    expect(trpcClientContent).toContain("rearmAlert:");
    expect(alertsRouteContent).toContain("onRearm");
    expect(alertsRouteContent).toContain("Re-arm");
  });

  it("9. Trigger history tab and view are rendered with provider provenance", () => {
    expect(alertsRouteContent).toContain("HistoryTab");
    expect(alertsRouteContent).toContain("Trigger History");
    expect(alertsRouteContent).toContain("item.provider");
    expect(alertsRouteContent).toContain("item.providerTimestamp");
  });

  it("10. In-app notifications tab and view are rendered", () => {
    expect(alertsRouteContent).toContain("NotificationsTab");
    expect(alertsRouteContent).toContain("Notifications (");
    expect(alertsRouteContent).toContain("markNotificationRead");
    expect(alertsRouteContent).toContain("dismissNotification");
  });

  it("11. Mark read procedure exists and is wired", () => {
    expect(alertsHookContent).toContain("markNotificationReadMutation");
    expect(trpcClientContent).toContain("markNotificationRead:");
  });

  it("12. Dismiss notification procedure exists and is wired", () => {
    expect(alertsHookContent).toContain("dismissNotificationMutation");
    expect(trpcClientContent).toContain("dismissNotification:");
  });

  it("13. No browser-local storage claim is made to the user", () => {
    expect(alertsRouteContent).not.toContain("stored locally in your browser");
    expect(alertsRouteContent).toContain(
      "Alerts are stored in your account and evaluated server-side against verified market ticks. Delivery is currently in-app."
    );
  });

  it("14. No false delivery claims (email, SMS, push, webhook) are made", () => {
    expect(alertsRouteContent).not.toContain("emailSent");
    expect(alertsRouteContent).not.toContain("pushSent");
    expect(alertsRouteContent).not.toContain("smsSent");
    expect(alertsRouteContent).not.toContain("webhook");
  });

  it("15. Active statistics strictly require enabled = true and supported = true", () => {
    expect(alertsHookContent).toContain("alerts.filter((a) => a.enabled && a.supported)");
  });

  it("16. Unsupported legacy condition badge and state are visible", () => {
    expect(alertsRouteContent).toContain("Unsupported legacy condition");
    expect(alertsRouteContent).toContain("Cannot enable unsupported legacy condition");
  });

  it("17. Missing and unavailable threshold values display '—'", () => {
    expect(alertsRouteContent).toContain('return "—";');
  });

  it("18. Clear all alerts loop has been removed", () => {
    expect(alertsRouteContent).not.toContain("clearAllAlerts");
    expect(alertsHookContent).not.toContain("clearAllAlerts");
    expect(alertsRouteContent).not.toContain("Clear all alerts");
  });
});
