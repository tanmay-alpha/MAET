/**
 * Alert service — handles persistence, deduplication, and outbox emission.
 */

import { z } from "zod";
import { evaluateAlert, type QuoteSnapshot } from "./evaluator";
import type { AlertConfig } from "./contracts";

export interface AlertRecord {
  id: string;
  userId: string;
  symbol: string;
  config: AlertConfig;
  enabled: boolean;
  lastTriggeredAt: number | null;
  triggerCount: number;
  createdAt: number;
}

export interface AlertTriggerEvent {
  alertId: string;
  userId: string;
  symbol: string;
  type: AlertConfig["type"];
  reason: string;
  currentValue: number;
  threshold: number;
  triggeredAt: number;
  quoteSource: string;
  quoteTimestamp: number;
  outboxId: string;
}

export class AlertDuplicateError extends Error {
  constructor(alertId: string) {
    super(`Alert ${alertId} already triggered within cooldown window`);
    this.name = "AlertDuplicateError";
  }
}

export interface AlertStore {
  getByUser(userId: string): Promise<AlertRecord[]>;
  getById(id: string): Promise<AlertRecord | null>;
  triggerEvent(event: AlertTriggerEvent): Promise<void>;
  markTriggered(id: string, ts: number): Promise<void>;
}

export class AlertService {
  constructor(private store: AlertStore) {}

  async evaluateAndTrigger(quote: QuoteSnapshot, alert: AlertRecord, now: number = Date.now()): Promise<AlertTriggerEvent | null> {
    if (!alert.enabled) return null;

    // Cooldown check
    if (alert.lastTriggeredAt && alert.config.cooldownMinutes > 0) {
      const elapsed = now - alert.lastTriggeredAt;
      if (elapsed < alert.config.cooldownMinutes * 60 * 1000) return null;
    }

    let evaluation;
    try {
      evaluation = evaluateAlert(quote, alert.config);
    } catch (err) {
      // Missing data — silently skip; do not trigger
      return null;
    }

    if (!evaluation.triggered) return null;

    const event: AlertTriggerEvent = {
      alertId: alert.id,
      userId: alert.userId,
      symbol: alert.symbol,
      type: alert.config.type,
      reason: evaluation.reason,
      currentValue: evaluation.currentValue,
      threshold: evaluation.threshold,
      triggeredAt: now,
      quoteSource: evaluation.quoteSource,
      quoteTimestamp: evaluation.quoteTimestamp,
      outboxId: `evt-${now}-${Math.random().toString(36).slice(2, 9)}`,
    };

    await this.store.triggerEvent(event);
    await this.store.markTriggered(alert.id, now);

    return event;
  }

  async listAlerts(userId: string): Promise<AlertRecord[]> {
    return this.store.getByUser(userId);
  }
}