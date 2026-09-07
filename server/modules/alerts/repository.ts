import { db } from "../../data/drizzle/client";
import { alerts, alertEvents, userNotifications } from "../../db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import {
  type CreateAlertInput,
  type AlertConfig,
  type AlertView,
  type AlertTriggerView,
  type AlertNotificationView,
  isSupportedAlertType,
  CreatableAlertTypeSchema,
} from "./contracts";

export function mapRowToAlertView(r: typeof alerts.$inferSelect): AlertView {
  const supported = isSupportedAlertType(r.type);
  let threshold: number | null = null;
  if (r.target !== null && r.target !== undefined && !Number.isNaN(Number(r.target))) {
    threshold = Number(r.target);
  } else if (r.config && typeof (r.config as any).threshold === "number") {
    threshold = (r.config as any).threshold;
  }

  return {
    id: r.id,
    symbol: r.symbol,
    exchange: r.exchange,
    type: r.type,
    label: r.label ?? null,
    threshold,
    enabled: r.enabled,
    mode: r.mode === "REPEATING" ? "repeating" : "one_time",
    cooldownMinutes: r.cooldownMinutes ?? 60,
    triggered: r.triggered,
    triggeredAt: r.triggeredAt ? r.triggeredAt.toISOString() : null,
    lastTriggeredAt: r.lastTriggeredAt ? r.lastTriggeredAt.toISOString() : null,
    triggerCount: r.triggerCount ?? 0,
    supported,
    createdAt: r.createdAt.toISOString(),
    updatedAt: r.updatedAt.toISOString(),
  };
}

export async function createAlert(userId: string, input: CreateAlertInput): Promise<AlertView> {
  const [result] = await db
    .insert(alerts)
    .values({
      userId,
      symbol: input.symbol,
      exchange: "NSE",
      type: input.config.type,
      condition: input.config.type,
      target: String(input.config.threshold),
      label: input.label,
      enabled: input.enabled,
      mode: input.config.mode === "repeating" ? "REPEATING" : "ONE_TIME",
      cooldownMinutes: input.config.cooldownMinutes ?? 60,
      config: input.config,
    })
    .returning();
  return mapRowToAlertView(result);
}

export async function listUserAlerts(userId: string): Promise<AlertView[]> {
  const rows = await db
    .select()
    .from(alerts)
    .where(eq(alerts.userId, userId))
    .orderBy(desc(alerts.createdAt));
  return rows.map(mapRowToAlertView);
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

export async function listActiveAlertSymbols(): Promise<string[]> {
  const supportedTypes = CreatableAlertTypeSchema.options;
  const rows = await db
    .select({ symbol: alerts.symbol })
    .from(alerts)
    .where(and(eq(alerts.enabled, true), inArray(alerts.type, supportedTypes)))
    .groupBy(alerts.symbol)
    .orderBy(alerts.symbol);
  return rows.map((r) => r.symbol.toUpperCase());
}

export async function toggleAlert(
  alertId: string,
  userId: string,
  enabled: boolean
): Promise<AlertView | null> {
  const [existing] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
  if (!existing) return null;

  if (enabled && !isSupportedAlertType(existing.type)) {
    throw new Error(`Cannot enable unsupported legacy alert type: ${existing.type}`);
  }

  const [result] = await db
    .update(alerts)
    .set({ enabled, updatedAt: new Date() })
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
    .returning();
  return result ? mapRowToAlertView(result) : null;
}

export async function rearmAlert(alertId: string, userId: string): Promise<AlertView | null> {
  const [existing] = await db
    .select()
    .from(alerts)
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
  if (!existing) return null;

  if (!isSupportedAlertType(existing.type)) {
    throw new Error(`Cannot rearm unsupported legacy alert type: ${existing.type}`);
  }

  const [result] = await db
    .update(alerts)
    .set({
      enabled: true,
      triggered: false,
      triggeredAt: null,
      lastTriggeredAt: null,
      updatedAt: new Date(),
    })
    .where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)))
    .returning();
  return result ? mapRowToAlertView(result) : null;
}

export async function deleteAlert(alertId: string, userId: string): Promise<{ success: boolean }> {
  await db.delete(alerts).where(and(eq(alerts.id, alertId), eq(alerts.userId, userId)));
  return { success: true };
}

export async function listTriggerHistory(
  userId: string,
  limit = 20
): Promise<{ items: AlertTriggerView[] }> {
  const rows = await db
    .select()
    .from(alertEvents)
    .where(eq(alertEvents.userId, userId))
    .orderBy(desc(alertEvents.triggeredAt))
    .limit(limit);

  return {
    items: rows.map((r) => ({
      id: r.id,
      alertId: r.alertId,
      symbol: r.symbol,
      exchange: r.exchange,
      conditionType: r.conditionType,
      observedValue: r.observedValue !== null ? Number(r.observedValue) : null,
      targetValue: Number(r.targetValue),
      message: r.message,
      provider: r.provider,
      providerTimestamp: r.providerTimestamp ? r.providerTimestamp.toISOString() : null,
      triggeredAt: r.triggeredAt.toISOString(),
    })),
  };
}

export async function listUserNotifications(
  userId: string,
  limit = 20
): Promise<{ items: AlertNotificationView[] }> {
  const rows = await db
    .select()
    .from(userNotifications)
    .where(eq(userNotifications.userId, userId))
    .orderBy(desc(userNotifications.createdAt))
    .limit(limit);

  return {
    items: rows.map((r) => ({
      id: r.id,
      kind: r.kind,
      title: r.title,
      body: r.body,
      symbol: r.symbol,
      alertId: r.alertId,
      alertEventId: r.alertEventId,
      readAt: r.readAt ? r.readAt.toISOString() : null,
      dismissedAt: r.dismissedAt ? r.dismissedAt.toISOString() : null,
      createdAt: r.createdAt.toISOString(),
    })),
  };
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
  providerTimestamp?: Date | null;
  fingerprint: string;
  isOneTime?: boolean;
}) {
  return await db.transaction(async (tx) => {
    // 1. Insert alert event with deduplication via unique (alertId, fingerprint)
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
        providerTimestamp: params.providerTimestamp ?? null,
        fingerprint: params.fingerprint,
      })
      .onConflictDoNothing()
      .returning();

    if (!eventRow) return null; // Deduplicated

    // 2. Update alert definition state (and disable if one-time), tenant-safe with userId
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
      .where(and(eq(alerts.id, params.alertId), eq(alerts.userId, params.userId)));

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
