/**
 * Corporate Action Adjustment Engine — MAET P2.
 *
 * Implements standard backward adjustment of historical OHLCV market data:
 * 1. RAW: Untouched actual traded exchange prices.
 * 2. SPLIT_ADJUSTED: Adjusts for stock splits, reverse splits, and bonus issues
 *    so historical chart continuity and indicators remain valid without fake crashes.
 * 3. TOTAL_RETURN_ADJUSTED: Additionally adjusts for cash dividends using standard
 *    backward dividend reinvestment factor: k = 1 - (dividend / priorClose).
 *
 * Financial Invariants:
 * - A 2:1 stock split MUST NOT produce an artificial 50% strategy drawdown or loss.
 * - Raw market data is immutable (original candle arrays are never mutated).
 * - Total traded notional (Price * Volume) is conserved under split adjustments.
 */

import type { Candle } from "@shared/types";

export type CorporateActionType =
  | "SPLIT"
  | "REVERSE_SPLIT"
  | "BONUS"
  | "DIVIDEND"
  | "RIGHTS"
  | "SYMBOL_CHANGE";

export type PriceAdjustmentSeries = "RAW" | "SPLIT_ADJUSTED" | "TOTAL_RETURN_ADJUSTED";

export interface CorporateAction {
  id?: string;
  companyId?: string;
  symbol: string;
  actionType: CorporateActionType;
  exDate: string | Date;
  recordDate?: string | Date;
  announcementDate?: string | Date;
  ratioNumerator?: number; // e.g. 2 for 2:1 split (old 1 share -> 2 new shares)
  ratioDenominator?: number; // e.g. 1
  amount?: number; // cash dividend amount per share
  currency?: string;
  source?: string;
  sourceReference?: string;
  ingestedAt?: string | Date;
}

/**
 * Normalizes an ex-date to unix millisecond timestamp at midnight UTC for clean comparison.
 */
function getExDateMs(exDate: string | Date): number {
  const d = typeof exDate === "string" ? new Date(exDate) : exDate;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate())).getTime();
}

/**
 * Adjusts historical OHLCV candles based on corporate actions.
 * Never mutates input candles; returns a new array of candles.
 */
export function adjustCandles(
  candles: Candle[],
  actions: CorporateAction[],
  series: PriceAdjustmentSeries = "SPLIT_ADJUSTED",
): Candle[] {
  if (!candles || candles.length === 0) return [];
  if (series === "RAW" || !actions || actions.length === 0) {
    return candles.map((c) => ({ ...c }));
  }

  // Filter actions relevant to the series and symbol
  const symbol = candles[0].symbol;
  const relevantActions = actions.filter((a) => {
    if (a.symbol !== symbol) return false;
    if (series === "SPLIT_ADJUSTED") {
      return a.actionType === "SPLIT" || a.actionType === "REVERSE_SPLIT" || a.actionType === "BONUS";
    }
    // TOTAL_RETURN_ADJUSTED includes splits, bonuses, and cash dividends
    return (
      a.actionType === "SPLIT" ||
      a.actionType === "REVERSE_SPLIT" ||
      a.actionType === "BONUS" ||
      a.actionType === "DIVIDEND"
    );
  });

  if (relevantActions.length === 0) {
    return candles.map((c) => ({ ...c }));
  }

  // Sort candles chronologically ascending
  const sorted = [...candles].sort((a, b) => new Date(a.ts).getTime() - new Date(b.ts).getTime());
  const adjusted = sorted.map((c) => ({ ...c }));

  // Process actions backward (or accumulate factors for each candle)
  // Each action affects all candles strictly before its exDate.
  for (const action of relevantActions) {
    const exDateMs = getExDateMs(action.exDate);

    if (action.actionType === "SPLIT" || action.actionType === "BONUS") {
      const num = action.ratioNumerator ?? 1;
      const den = action.ratioDenominator ?? 1;
      if (num <= 0 || den <= 0) continue;

      // Price factor: den / num (e.g. 2:1 split -> factor = 1/2 = 0.5)
      const priceFactor = den / num;
      // Volume factor: num / den (e.g. 2:1 split -> volume doubles = 2.0)
      const volumeFactor = num / den;

      for (let i = 0; i < adjusted.length; i++) {
        const candleTs = new Date(adjusted[i].ts).getTime();
        if (candleTs < exDateMs) {
          adjusted[i].open = Number((adjusted[i].open * priceFactor).toFixed(4));
          adjusted[i].high = Number((adjusted[i].high * priceFactor).toFixed(4));
          adjusted[i].low = Number((adjusted[i].low * priceFactor).toFixed(4));
          adjusted[i].close = Number((adjusted[i].close * priceFactor).toFixed(4));
          adjusted[i].volume = Math.round(adjusted[i].volume * volumeFactor);
        }
      }
    } else if (action.actionType === "REVERSE_SPLIT") {
      const num = action.ratioNumerator ?? 1;
      const den = action.ratioDenominator ?? 1;
      if (num <= 0 || den <= 0) continue;

      // Reverse split: e.g. 1 for 10 reverse split -> num = 1, den = 10 -> priceFactor = 10 / 1 = 10
      const priceFactor = den / num;
      const volumeFactor = num / den;

      for (let i = 0; i < adjusted.length; i++) {
        const candleTs = new Date(adjusted[i].ts).getTime();
        if (candleTs < exDateMs) {
          adjusted[i].open = Number((adjusted[i].open * priceFactor).toFixed(4));
          adjusted[i].high = Number((adjusted[i].high * priceFactor).toFixed(4));
          adjusted[i].low = Number((adjusted[i].low * priceFactor).toFixed(4));
          adjusted[i].close = Number((adjusted[i].close * priceFactor).toFixed(4));
          adjusted[i].volume = Math.round(adjusted[i].volume * volumeFactor);
        }
      }
    } else if (action.actionType === "DIVIDEND" && series === "TOTAL_RETURN_ADJUSTED") {
      const divAmount = action.amount ?? 0;
      if (divAmount <= 0) continue;

      // Find the last candle strictly before ex-date
      let priorClose = 0;
      for (let i = adjusted.length - 1; i >= 0; i--) {
        if (new Date(adjusted[i].ts).getTime() < exDateMs) {
          priorClose = adjusted[i].close;
          break;
        }
      }

      if (priorClose > divAmount) {
        // Standard dividend adjustment factor k = 1 - (divAmount / priorClose)
        const divFactor = (priorClose - divAmount) / priorClose;

        for (let i = 0; i < adjusted.length; i++) {
          const candleTs = new Date(adjusted[i].ts).getTime();
          if (candleTs < exDateMs) {
            adjusted[i].open = Number((adjusted[i].open * divFactor).toFixed(4));
            adjusted[i].high = Number((adjusted[i].high * divFactor).toFixed(4));
            adjusted[i].low = Number((adjusted[i].low * divFactor).toFixed(4));
            adjusted[i].close = Number((adjusted[i].close * divFactor).toFixed(4));
          }
        }
      }
    }
  }

  return adjusted;
}
