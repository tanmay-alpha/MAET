import { evaluateAlert, shouldRespectCooldown, type QuoteSnapshot } from "../modules/alerts/evaluator";
import { recordAlertTriggerTransaction, loadActiveAlertsForSymbol } from "../modules/alerts/repository";
import type { AlertConfig } from "../modules/alerts/contracts";
import { getLogger } from "../infra/logger";

const logger = getLogger("alert-evaluator");

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

export class AlertEvaluatorWorker {
  private isRunning = false;

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    logger.info("AlertEvaluatorWorker started");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    logger.info("AlertEvaluatorWorker stopped");
  }

  public async processQuote(quote: QuoteSnapshot): Promise<any[]> {
    if (!this.isRunning) return [];
    if (!quote || !quote.symbol) return [];

    let activeAlerts: AlertRow[] = [];
    try {
      activeAlerts = await loadActiveAlertsForSymbol(quote.symbol);
    } catch (dbErr) {
      logger.error({ symbol: quote.symbol, err: dbErr }, "Database failure loading alerts");
      throw dbErr;
    }

    const symbolAlerts = activeAlerts.filter((a) => a.enabled);
    const nowMs = Date.now();
    const triggeredResults = [];

    for (const alert of symbolAlerts) {
      // Cooldown check for repeating alerts
      if (alert.lastTriggeredAt && alert.mode === "REPEATING") {
        const inCooldown = shouldRespectCooldown(
          alert.lastTriggeredAt.getTime(),
          alert.cooldownMinutes ?? 60,
          nowMs
        );
        if (inCooldown) continue;
      }

      // One-time alert already triggered
      if (alert.lastTriggeredAt && alert.mode === "ONE_TIME") {
        continue;
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
            isOneTime: alert.mode === "ONE_TIME",
          });

          if (result) {
            triggeredResults.push(result);
          }
        }
      } catch (err: any) {
        if (err?.message?.includes("Missing required indicator")) {
          logger.debug({ alertId: alert.id, symbol: quote.symbol }, "Deferred evaluation due to missing input");
          continue;
        }
        logger.warn({ alertId: alert.id, symbol: quote.symbol, err }, "Unexpected error evaluating alert");
      }
    }

    return triggeredResults;
  }
}

export const alertEvaluatorWorker = new AlertEvaluatorWorker();

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
      if (isCooldown && alert.mode === "REPEATING") continue;
      if (alert.mode === "ONE_TIME") continue;
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
          isOneTime: alert.mode === "ONE_TIME",
        });

        if (result) {
          triggeredResults.push(result);
        }
      }
    } catch {
      continue;
    }
  }

  return triggeredResults;
}
