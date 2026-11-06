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
  /**
   * SPLIT / REVERSE_SPLIT: new shares per `ratioDenominator` old shares (2:1 split -> 2 / 1).
   * BONUS: bonus shares issued per `ratioDenominator` shares held, as NSE quotes it
   * (1:1 bonus -> 1 / 1, i.e. holdings double).
   */
  ratioNumerator?: number;
  ratioDenominator?: number;
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

  // Apply actions oldest first so the result never depends on the order they were supplied in.
  // Each action scales every candle strictly before its ex-date.
  const ordered = [...relevantActions].sort((a, b) => getExDateMs(a.exDate) - getExDateMs(b.exDate));
  for (const action of ordered) {
    const exDateMs = getExDateMs(action.exDate);
    const factors = adjustmentFactors(action, sorted, exDateMs, series);
    if (!factors) continue;

    for (let i = 0; i < adjusted.length; i++) {
      if (new Date(adjusted[i].ts).getTime() >= exDateMs) break;
      adjusted[i].open = Number((adjusted[i].open * factors.price).toFixed(4));
      adjusted[i].high = Number((adjusted[i].high * factors.price).toFixed(4));
      adjusted[i].low = Number((adjusted[i].low * factors.price).toFixed(4));
      adjusted[i].close = Number((adjusted[i].close * factors.price).toFixed(4));
      adjusted[i].volume = Math.round(adjusted[i].volume * factors.volume);
    }
  }

  return adjusted;
}

/**
 * Price and volume multipliers for candles before an action's ex-date, or null if the action
 * does not adjust this series. `rawSorted` are the unadjusted candles in ascending order.
 */
function adjustmentFactors(
  action: CorporateAction,
  rawSorted: Candle[],
  exDateMs: number,
  series: PriceAdjustmentSeries,
): { price: number; volume: number } | null {
  if (action.actionType === "DIVIDEND") {
    const divAmount = action.amount ?? 0;
    if (series !== "TOTAL_RETURN_ADJUSTED" || divAmount <= 0) return null;
    // k = 1 - dividend / close before the ex-date. Both are in the share units of that date, so
    // the close is read from the raw series, not from one already rescaled by later splits.
    const prior = rawSorted.filter((c) => new Date(c.ts).getTime() < exDateMs).at(-1);
    if (!prior || prior.close <= divAmount) return null;
    return { price: (prior.close - divAmount) / prior.close, volume: 1 };
  }

  const num = action.ratioNumerator ?? 1;
  const den = action.ratioDenominator ?? 1;
  if (num <= 0 || den <= 0) return null;

  if (action.actionType === "BONUS") {
    // num bonus shares per den held: den shares become num + den.
    return { price: den / (num + den), volume: (num + den) / den };
  }
  if (action.actionType === "SPLIT" || action.actionType === "REVERSE_SPLIT") {
    // den shares become num (2:1 split -> x0.5 price; 1:10 reverse split -> x10 price).
    return { price: den / num, volume: num / den };
  }
  return null;
}
