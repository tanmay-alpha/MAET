/**
 * Alerts Hook
 * Price, volume, and indicator alerts with localStorage persistence
 */

import { useSyncExternalStore, useCallback, useEffect, useMemo } from "react";
import { useMarketQuotes } from "@/hooks/use-market-quotes";

export type AlertType = "price_above" | "price_below" | "volume_spike" | "indicator";

export type IndicatorType = "rsi" | "macd" | "sma_cross" | "bollinger";

export type AlertCondition = "above" | "below" | "crosses_above" | "crosses_below";

export interface Alert {
  id: string;
  symbol: string;
  type: AlertType;
  condition: AlertCondition;
  value: number;
  indicator?: IndicatorType;
  indicatorValue?: number;
  triggered: boolean;
  triggeredAt?: string;
  createdAt: string;
  enabled: boolean;
  repeat: boolean; // Whether to re-trigger after being satisfied again
}

const STORAGE_KEY = "maet.alerts.v1";

const EMPTY_ALERTS: Alert[] = [];

let alerts: Alert[] = [];
let loaded = false;
const listeners = new Set<() => void>();

function loadAlerts(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return;
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      alerts = parsed;
    }
  } catch {
    alerts = [];
  }
}

function getSnapshot(): Alert[] {
  loadAlerts();
  return alerts;
}

function subscribe(listener: () => void): () => void {
  loadAlerts();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: Alert[]): void {
  alerts = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

// Create a new alert
export function createAlert(input: {
  symbol: string;
  type: AlertType;
  condition: AlertCondition;
  value: number;
  indicator?: IndicatorType;
  repeat?: boolean;
}): { ok: boolean; alert?: Alert; message: string } {
  loadAlerts();
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { ok: false, message: "Symbol is required" };
  if (!input.value || input.value <= 0) return { ok: false, message: "Alert value must be positive" };

  const alert: Alert = {
    id: crypto.randomUUID(),
    symbol,
    type: input.type,
    condition: input.condition,
    value: input.value,
    indicator: input.indicator,
    triggered: false,
    createdAt: new Date().toISOString(),
    enabled: true,
    repeat: input.repeat ?? false,
  };

  commit([alert, ...alerts].slice(0, 100)); // Max 100 alerts
  return { ok: true, alert, message: `Alert created for ${symbol}` };
}

// Delete an alert
export function deleteAlert(id: string): void {
  loadAlerts();
  commit(alerts.filter((a) => a.id !== id));
}

// Toggle alert enabled state
export function toggleAlert(id: string): void {
  loadAlerts();
  commit(
    alerts.map((a) =>
      a.id === id ? { ...a, enabled: !a.enabled } : a
    )
  );
}

// Reset triggered state
export function resetAlert(id: string): void {
  loadAlerts();
  commit(
    alerts.map((a) =>
      a.id === id ? { ...a, triggered: false, triggeredAt: undefined } : a
    )
  );
}

// Clear all alerts
export function clearAllAlerts(): void {
  commit([]);
}

// Check alerts against current quotes
export function checkAlerts(quotes: Map<string, { price: number; volume?: number }>): Alert[] {
  loadAlerts();
  let changed = false;
  const now = new Date().toISOString();

  const next = alerts.map((alert) => {
    if (!alert.enabled || alert.triggered && !alert.repeat) return alert;

    const quote = quotes.get(alert.symbol);
    if (!quote) return alert;

    let triggered = false;

    if (alert.type === "price_above" || alert.type === "price_below") {
      if (alert.condition === "above" && quote.price >= alert.value) {
        triggered = true;
      } else if (alert.condition === "below" && quote.price <= alert.value) {
        triggered = true;
      }
    } else if (alert.type === "volume_spike" && quote.volume) {
      // Volume spike: alert.value is the multiple of average
      if (quote.volume >= alert.value) {
        triggered = true;
      }
    } else if (alert.type === "indicator" && alert.indicatorValue !== undefined) {
      if (alert.condition === "above" && alert.indicatorValue >= alert.value) {
        triggered = true;
      } else if (alert.condition === "below" && alert.indicatorValue <= alert.value) {
        triggered = true;
      }
    }

    if (triggered && !alert.triggered) {
      changed = true;
      return { ...alert, triggered: true, triggeredAt: now };
    } else if (!triggered && alert.repeat && alert.triggered) {
      // Reset for repeat triggers
      changed = true;
      return { ...alert, triggered: false, triggeredAt: undefined };
    }

    return alert;
  });

  if (changed) {
    commit(next);
  }

  return next;
}

export function useAlerts() {
  const storedAlerts = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ALERTS);

  // Get unique symbols from alerts
  const alertSymbols = useMemo(
    () => [...new Set(storedAlerts.map((a) => a.symbol))],
    [storedAlerts]
  );

  const { quoteMap } = useMarketQuotes(alertSymbols);

  // Convert quote map for checkAlerts
  const quotesForCheck = useMemo(() => {
    const result = new Map<string, { price: number; volume?: number }>();
    quoteMap.forEach((quote, symbol) => {
      result.set(symbol, { price: quote.price, volume: quote.volume });
    });
    return result;
  }, [quoteMap]);

  // Check alerts and get updated list
  const alerts = useMemo(() => {
    return checkAlerts(quotesForCheck);
  }, [quotesForCheck, storedAlerts]);

  // Get triggered alerts for notifications
  const triggeredAlerts = useMemo(
    () => alerts.filter((a) => a.triggered && a.enabled),
    [alerts]
  );

  // Active alerts (not triggered or repeating)
  const activeAlerts = useMemo(
    () => alerts.filter((a) => !a.triggered || a.repeat),
    [alerts]
  );

  return {
    alerts,
    activeAlerts,
    triggeredAlerts,
    createAlert,
    deleteAlert,
    toggleAlert,
    resetAlert,
    clearAllAlerts,
  };
}
