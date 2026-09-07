/**
 * Alert evaluator — pure function that takes a quote and an alert config
 * and returns whether the alert should fire. All math is deterministic.
 */

import type { AlertConfig, AlertEvaluation } from "./contracts";

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  previousClose?: number;
  changePct?: number;
  volume?: number;
  averageVolume20d?: number;
  quoteTimestamp: number;
  source: string;
}

export class QuoteMissingDataError extends Error {
  constructor(missingField: string) {
    super(`Quote is missing required data: ${missingField}`);
    this.name = "QuoteMissingDataError";
  }
}

export class AlertUnsupportedTypeError extends Error {
  constructor(alertType: string) {
    super(`Unsupported alert type for active evaluation: ${alertType}`);
    this.name = "AlertUnsupportedTypeError";
  }
}

export function evaluateAlert(quote: QuoteSnapshot, config: AlertConfig): AlertEvaluation {
  const base = {
    quoteSource: quote.source,
    quoteTimestamp: quote.quoteTimestamp,
  };

  switch (config.type) {
    case "PRICE_ABOVE": {
      if (config.threshold === undefined || !Number.isFinite(config.threshold)) {
        throw new QuoteMissingDataError("threshold");
      }
      if (quote.price === undefined || !Number.isFinite(quote.price) || quote.price <= 0) {
        throw new QuoteMissingDataError("price");
      }
      return {
        ...base,
        triggered: quote.price > config.threshold,
        reason: `Price ${quote.price} > ${config.threshold}`,
        currentValue: quote.price,
        threshold: config.threshold,
      };
    }
    case "PRICE_BELOW": {
      if (config.threshold === undefined || !Number.isFinite(config.threshold)) {
        throw new QuoteMissingDataError("threshold");
      }
      if (quote.price === undefined || !Number.isFinite(quote.price) || quote.price <= 0) {
        throw new QuoteMissingDataError("price");
      }
      return {
        ...base,
        triggered: quote.price < config.threshold,
        reason: `Price ${quote.price} < ${config.threshold}`,
        currentValue: quote.price,
        threshold: config.threshold,
      };
    }
    case "PERCENT_CHANGE_ABOVE": {
      if (config.threshold === undefined || !Number.isFinite(config.threshold)) {
        throw new QuoteMissingDataError("threshold");
      }
      let change: number;
      if (quote.changePct !== undefined && Number.isFinite(quote.changePct)) {
        change = quote.changePct;
      } else if (
        quote.previousClose !== undefined &&
        Number.isFinite(quote.previousClose) &&
        quote.previousClose > 0 &&
        quote.price !== undefined &&
        Number.isFinite(quote.price)
      ) {
        change = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
      } else {
        throw new QuoteMissingDataError("previousClose");
      }
      return {
        ...base,
        triggered: change > config.threshold,
        reason: `Change ${change.toFixed(2)}% > ${config.threshold}%`,
        currentValue: change,
        threshold: config.threshold,
      };
    }
    case "PERCENT_CHANGE_BELOW": {
      if (config.threshold === undefined || !Number.isFinite(config.threshold)) {
        throw new QuoteMissingDataError("threshold");
      }
      let change: number;
      if (quote.changePct !== undefined && Number.isFinite(quote.changePct)) {
        change = quote.changePct;
      } else if (
        quote.previousClose !== undefined &&
        Number.isFinite(quote.previousClose) &&
        quote.previousClose > 0 &&
        quote.price !== undefined &&
        Number.isFinite(quote.price)
      ) {
        change = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
      } else {
        throw new QuoteMissingDataError("previousClose");
      }
      return {
        ...base,
        triggered: change < config.threshold,
        reason: `Change ${change.toFixed(2)}% < ${config.threshold}%`,
        currentValue: change,
        threshold: config.threshold,
      };
    }
    case "VOLUME_ABOVE": {
      if (config.threshold === undefined || !Number.isFinite(config.threshold)) {
        throw new QuoteMissingDataError("threshold");
      }
      if (quote.volume === undefined || !Number.isFinite(quote.volume)) {
        throw new QuoteMissingDataError("volume");
      }
      return {
        ...base,
        triggered: quote.volume > config.threshold,
        reason: `Volume ${quote.volume} > ${config.threshold}`,
        currentValue: quote.volume,
        threshold: config.threshold,
      };
    }
    default: {
      throw new AlertUnsupportedTypeError(config.type);
    }
  }
}

export function shouldRespectCooldown(lastTriggeredAt: number, cooldownMinutes: number, nowMs: number): boolean {
  return nowMs - lastTriggeredAt < cooldownMinutes * 60 * 1000;
}