import { db } from "../../data/drizzle/client";
import { alerts, alertEvents, userNotifications } from "../../db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import type { AlertDefinitionInput, AlertConfig } from "./contracts";

export async function createAlert(userId: string, input: AlertDefinitionInput) {
  const [result] = await db
    .insert(alerts)
    .values({
      userId,
      symbol: input.symbol.toUpperCase(),
      exchange: "NSE",
      type: input.config.type,
      condition: input.config.type,
      target: String(input.config.threshold ?? 0),
      label: input.label,
      enabled: input.enabled,
      mode: input.config.mode === "repeating" ? "REPEATING" : "ONE_TIME",
      cooldownMinutes: input.config.cooldownMinutes ?? 60,
      config: input.config,
    })
    .returning();
  return result;
}

export async function listUserAlerts(userId: string) {
  return await db.select().from(alerts).where(eq(alerts.userId, userId)).orderBy(desc(alerts.createdAt));
}

export async function loadActiveAlertsForSymbol(symbol: string) {
  const rows = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.symbol, symbol.toUpperCase()), eq(alerts.enabled, true)));
  return rows.map((r) => ({
    id: r.id,
    userId: r.userId,
    symbol: r.symbol,
    type: r.type,
    condition: r.condition,
    target: r.target,
    label: r.label,
    enabled: r.enabled,
    mode: r.mode ?? "ONE_TIME",
    cooldownMinutes: r.cooldownMinutes ?? 60,
    lastTriggeredAt: r.lastTriggeredAt,
    triggerCount: r.triggerCount ?? 0,
    config: (r.config as AlertConfig) ?? { type: r.type, threshold: Number(r.target) },
  }));
}

export async function toggleAlert(alertId: string, userId: string, enabled: boolean) {
  const [result] = await db
    .update(alerts)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
    .returning();
  return result;
}

export async function deleteAlert(alertId: string, userId: string) {
  await db.delete(alerts).where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
  return { success: true };
}

export async function listTriggerHistory(userId: string, limit = 20) {
  const rows = await db
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.userId, userId))
    .orderBy(desc(alertEvents.triggeredAt))
    .limit(limit);
  return { items: rows };
}

export async function listUserNotifications(userId: string, limit = 20) {
  const rows = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(limit);
  return { items: rows };
}

export async function markNotificationRead(notificationId: string, userId: string) {
  await db
    .update(userNotifications)
    .set({ readAt: new Date() })
    .where(and(eq(userNotifications.id, notificationId), eq(userNotifications.userId, userId)));
  return { success: true };
}

export async function dismissNotification(notificationId: string, userId: string) {
  await db
    .update(userNotifications)
    .set({ dismissedAt: new Date() })
    .where(and(eq(userNotifications.id, notificationId), eq(userNotifications.userId, userId)));
  return { success: true };
}

export async function recordAlertTriggerTransaction(params: {
  alertId: string;
  userId: string;
  symbol: string;
  exchange?: string;
  observedValue: number;
  targetValue: number;
  conditionType: string;
  message: string;
  provider: string;
  fingerprint: string;
  isOneTime?: boolean;
}) {
  return await db.transaction(async (tx) => {
    // 1. Insert alert event
    const eventId = crypto.randomUUID();
    const [eventRow] = await tx
      .insert(alertEvents)
      .values({
        id: eventId,
        alertId: params.alertId,
        userId: params.userId,
        symbol: params.symbol,
        exchange: params.exchange ?? "NSE",
        observedValue: String(params.observedValue),
        targetValue: String(params.targetValue),
        conditionType: params.conditionType,
        message: params.message,
        provider: params.provider,
        fingerprint: params.fingerprint,
      })
      .onConflictDoNothing()
      .returning();

    if (!eventRow) return null; // Deduplicated

    // 2. Update alert definition state (and disable if one-time)
    await tx
      .update(alerts)
      .set({
        enabled: params.isOneTime ? false : true,
        triggered: true,
        triggeredAt: new Date(),
        lastTriggeredAt: new Date(),
        triggerCount: sql`${alerts.triggerCount} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(alerts.id, params.alertId));

    // 3. Create user notification
    const [notificationRow] = await tx
      .insert(userNotifications)
      .values({
        userId: params.userId,
        kind: "alert_triggered",
        title: `Alert Triggered: ${params.symbol}`,
        body: params.message,
        symbol: params.symbol,
        alertId: params.alertId,
        alertEventId: eventRow.id,
        payload: {
          observedValue: params.observedValue,
          targetValue: params.targetValue,
          conditionType: params.conditionType,
        },
      })
      .returning();

    return { event: eventRow, notification: notificationRow };
  });
}
