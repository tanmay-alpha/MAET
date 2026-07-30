/**
 * Alert evaluator — pure function that takes a quote and an alert config
 * and returns whether the alert should fire. All math is deterministic.
 */

import type { AlertConfig, AlertEvaluation } from "./contracts";

export interface QuoteSnapshot {
  symbol: string;
  price: number;
  previousClose: number;
  volume: number;
  averageVolume20d?: number;
  rsi?: number;
  macd?: number;
  macdSignal?: number;
  sma20?: number;
  sma50?: number;
  sma200?: number;
  quoteTimestamp: number;
  source: string;
}

export class QuoteMissingDataError extends Error {
  constructor(missingField: string) {
    super(`Quote is missing required data: ${missingField}`);
    this.name = "QuoteMissingDataError";
  }
}

export function evaluateAlert(quote: QuoteSnapshot, config: AlertConfig): AlertEvaluation {
  const base = {
    quoteSource: quote.source,
    quoteTimestamp: quote.quoteTimestamp,
  };

  switch (config.type) {
    case "PRICE_ABOVE": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      return {
        ...base,
        triggered: quote.price > config.threshold,
        reason: `Price ${quote.price} > ${config.threshold}`,
        currentValue: quote.price,
        threshold: config.threshold,
      };
    }
    case "PRICE_BELOW": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      return {
        ...base,
        triggered: quote.price < config.threshold,
        reason: `Price ${quote.price} < ${config.threshold}`,
        currentValue: quote.price,
        threshold: config.threshold,
      };
    }
    case "PERCENT_CHANGE_ABOVE": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      if (quote.previousClose === 0) throw new QuoteMissingDataError("previousClose");
      const change = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
      return {
        ...base,
        triggered: change > config.threshold,
        reason: `Change ${change.toFixed(2)}% > ${config.threshold}%`,
        currentValue: change,
        threshold: config.threshold,
      };
    }
    case "PERCENT_CHANGE_BELOW": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      if (quote.previousClose === 0) throw new QuoteMissingDataError("previousClose");
      const change = ((quote.price - quote.previousClose) / quote.previousClose) * 100;
      return {
        ...base,
        triggered: change < config.threshold,
        reason: `Change ${change.toFixed(2)}% < ${config.threshold}%`,
        currentValue: change,
        threshold: config.threshold,
      };
    }
    case "VOLUME_ABOVE": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      return {
        ...base,
        triggered: quote.volume > config.threshold,
        reason: `Volume ${quote.volume} > ${config.threshold}`,
        currentValue: quote.volume,
        threshold: config.threshold,
      };
    }
    case "RELATIVE_VOLUME_ABOVE": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      if (quote.averageVolume20d === undefined || quote.averageVolume20d === 0) {
        throw new QuoteMissingDataError("averageVolume20d");
      }
      const rvol = quote.volume / quote.averageVolume20d;
      return {
        ...base,
        triggered: rvol > config.threshold,
        reason: `RVol ${rvol.toFixed(2)} > ${config.threshold}`,
        currentValue: rvol,
        threshold: config.threshold,
      };
    }
    case "RSI_ABOVE": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      if (quote.rsi === undefined) throw new QuoteMissingDataError("rsi");
      return {
        ...base,
        triggered: quote.rsi > config.threshold,
        reason: `RSI ${quote.rsi.toFixed(2)} > ${config.threshold}`,
        currentValue: quote.rsi,
        threshold: config.threshold,
        indicatorValue: quote.rsi,
      };
    }
    case "RSI_BELOW": {
      if (config.threshold === undefined) throw new QuoteMissingDataError("threshold");
      if (quote.rsi === undefined) throw new QuoteMissingDataError("rsi");
      return {
        ...base,
        triggered: quote.rsi < config.threshold,
        reason: `RSI ${quote.rsi.toFixed(2)} < ${config.threshold}`,
        currentValue: quote.rsi,
        threshold: config.threshold,
        indicatorValue: quote.rsi,
      };
    }
    case "MACD_CROSS_ABOVE": {
      if (quote.macd === undefined || quote.macdSignal === undefined) {
        throw new QuoteMissingDataError("macd");
      }
      return {
        ...base,
        triggered: quote.macd > quote.macdSignal,
        reason: `MACD ${quote.macd.toFixed(4)} crossed above signal ${quote.macdSignal.toFixed(4)}`,
        currentValue: quote.macd,
        threshold: quote.macdSignal,
      };
    }
    case "MACD_CROSS_BELOW": {
      if (quote.macd === undefined || quote.macdSignal === undefined) {
        throw new QuoteMissingDataError("macd");
      }
      return {
        ...base,
        triggered: quote.macd < quote.macdSignal,
        reason: `MACD ${quote.macd.toFixed(4)} crossed below signal ${quote.macdSignal.toFixed(4)}`,
        currentValue: quote.macd,
        threshold: quote.macdSignal,
      };
    }
    case "PRICE_CROSS_SMA": {
      const period = config.smaPeriod ?? config.period ?? 50;
      const sma = period === 20 ? quote.sma20 : period === 50 ? quote.sma50 : period === 200 ? quote.sma200 : undefined;
      if (sma === undefined) throw new QuoteMissingDataError(`sma${period}`);
      return {
        ...base,
        triggered: quote.price > sma,
        reason: `Price ${quote.price} above SMA(${period}) ${sma.toFixed(2)}`,
        currentValue: quote.price,
        threshold: sma,
        indicatorValue: sma,
      };
    }
    case "SCREENER_MATCH": {
      // Screener match is evaluated separately by the screener engine.
      // The alert layer simply requires a screenerId.
      if (!config.screenerId) throw new QuoteMissingDataError("screenerId");
      return {
        ...base,
        triggered: false, // Determined by screener result
        reason: `Screener ${config.screenerId} result pending`,
        currentValue: 0,
        threshold: 0,
      };
    }
    default: {
      const exhaustive: never = config.type;
      throw new Error(`Unknown alert type: ${String(exhaustive)}`);
    }
  }
}

export function shouldRespectCooldown(lastTriggeredAt: number, cooldownMinutes: number, nowMs: number): boolean {
  return nowMs - lastTriggeredAt < cooldownMinutes * 60 * 1000;
}