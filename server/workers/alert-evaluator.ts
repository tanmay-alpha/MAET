import {
  evaluateAlert,
  shouldRespectCooldown,
  QuoteMissingDataError,
  AlertUnsupportedTypeError,
  type QuoteSnapshot,
} from "../modules/alerts/evaluator";
import { recordAlertTriggerTransaction, loadActiveAlertsForSymbol } from "../modules/alerts/repository";
import type { AlertConfig } from "../modules/alerts/contracts";
import { getLogger } from "../infra/logger";
import { DatabaseGate } from "../infra/database-gate";

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

export type AlertEvaluatorDeps = {
  loadAlerts?: (symbol: string) => Promise<AlertRow[]>;
  evaluate?: (quote: QuoteSnapshot, alerts: AlertRow[]) => Promise<unknown[]>;
  log?: Pick<typeof logger, "info" | "warn" | "error">;
};

export class AlertEvaluatorWorker {
  private isRunning = false;
  private readonly loadAlerts: (symbol: string) => Promise<AlertRow[]>;
  private readonly evaluate: (quote: QuoteSnapshot, alerts: AlertRow[]) => Promise<unknown[]>;
  private readonly log: Pick<typeof logger, "info" | "warn" | "error">;
  private readonly database: DatabaseGate;

  constructor(deps: AlertEvaluatorDeps = {}) {
    this.loadAlerts = deps.loadAlerts ?? (loadActiveAlertsForSymbol as (symbol: string) => Promise<AlertRow[]>);
    this.evaluate = deps.evaluate ?? processQuoteAlerts;
    this.log = deps.log ?? logger;
    this.database = new DatabaseGate("alert-evaluator", this.log);
  }

  public async start(): Promise<void> {
    if (this.isRunning) return;
    this.isRunning = true;
    this.log.info("AlertEvaluatorWorker started");
  }

  public async stop(): Promise<void> {
    this.isRunning = false;
    this.log.info("AlertEvaluatorWorker stopped");
  }

  public async processQuote(quote: QuoteSnapshot): Promise<unknown[]> {
    if (!this.isRunning) return [];
    if (!quote || !quote.symbol) return [];

    try {
      // Skipped quietly while the database circuit is open; alerts are evaluated
      // again on the first tick after it closes.
      const triggered = await this.database.run(async () => this.evaluate(quote, await this.loadAlerts(quote.symbol)));
      return triggered ?? [];
    } catch (err) {
      this.log.error({ symbol: quote.symbol, err }, "Alert evaluation failed");
      return [];
    }
  }
}

export const alertEvaluatorWorker = new AlertEvaluatorWorker();

export async function processQuoteAlerts(quote: QuoteSnapshot, activeAlerts: AlertRow[]) {
  const symbolAlerts = activeAlerts.filter((a) => a.symbol === quote.symbol && a.enabled);
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
          providerTimestamp: new Date(quote.quoteTimestamp),
          fingerprint,
          isOneTime: alert.mode === "ONE_TIME",
        });

        if (result) {
          triggeredResults.push(result);
        }
      }
    } catch (err: any) {
      if (err instanceof QuoteMissingDataError) {
        logger.debug({ alertId: alert.id, symbol: quote.symbol, missing: err.message }, "Deferred evaluation due to missing input");
        continue;
      }
      if (err instanceof AlertUnsupportedTypeError) {
        logger.debug({ alertId: alert.id, symbol: quote.symbol, type: alert.config.type }, "Skipped unsupported alert type");
        continue;
      }
      logger.warn({ alertId: alert.id, symbol: quote.symbol, err }, "Unexpected error evaluating alert");
    }
  }

  return triggeredResults;
}
