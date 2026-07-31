import { evaluateAlert, shouldRespectCooldown, type QuoteSnapshot } from "../modules/alerts/evaluator";
import { recordAlertTriggerTransaction } from "../modules/alerts/repository";
import type { AlertConfig } from "../modules/alerts/contracts";

export interface AlertRow {
  id: string;
  userId: string;
  symbol: string;
  type: string;
  condition: string;
  target: string;
  label?: string | null;
  enabled: boolean;
  mode: string;
  cooldownMinutes: number;
  lastTriggeredAt?: Date | null;
  triggerCount: number;
  config: AlertConfig;
}

export async function processQuoteAlerts(quote: QuoteSnapshot, activeAlerts: AlertRow[]) {
  const symbolAlerts = activeAlerts.filter(a => a.symbol === quote.symbol && a.enabled);
  const nowMs = Date.now();
  const triggeredResults = [];

  for (const alert of symbolAlerts) {
    if (alert.lastTriggeredAt) {
      const isCooldown = shouldRespectCooldown(
        alert.lastTriggeredAt.getTime(),
        alert.cooldownMinutes ?? 60,
        nowMs
      );
      if (isCooldown && alert.mode !== "REPEATING") continue;
    }

    try {
      const evaluation = evaluateAlert(quote, alert.config);
      if (evaluation.triggered) {
        const timestampBucket = Math.floor(nowMs / (60 * 1000));
        const fingerprint = `${alert.id}-${timestampBucket}`;

        const result = await recordAlertTriggerTransaction({
          alertId: alert.id,
          userId: alert.userId,
          symbol: quote.symbol,
          exchange: "NSE",
          observedValue: evaluation.currentValue,
          targetValue: evaluation.threshold,
          conditionType: alert.config.type,
          message: evaluation.reason,
          provider: quote.source,
          fingerprint,
        });

        if (result) {
          triggeredResults.push(result);
        }
      }
    } catch {
      // Missing data fields or unexpected errors fail gracefully
      continue;
    }
  }

  return triggeredResults;
}
