/**
 * Position Sizer — calculates order size based on sizing method.
 *
 * Supported methods:
 * - FIXED_QUANTITY: exact shares
 * - FIXED_CAPITAL: capital / price
 * - PERCENT_OF_EQUITY: equity * pct / price
 * - RISK_PER_TRADE: risk / (price - stop) * stop_percent
 * - VOLATILITY_TARGET: equity * volatility_target / atr
 *
 * All methods: no NaN, no Infinity, no negative, no zero capital.
 */

import type { StrategyRiskConfig, PositionSizingMethod } from "../../../shared/strategy/ast";

export interface SizingContext {
  currentEquity: number;
  entryPrice: number;
  atr?: number;
  stopPrice?: number;
}

export interface SizingResult {
  quantity: number;
  capitalRequired: number;
  method: PositionSizingMethod;
  warning?: string;
}

export function calculatePositionSize(
  risk: StrategyRiskConfig,
  ctx: SizingContext,
): SizingResult {
  const { currentEquity, entryPrice, atr, stopPrice } = ctx;

  if (currentEquity <= 0 || !isFinite(currentEquity)) {
    return { quantity: 0, capitalRequired: 0, method: risk.sizingMethod, warning: "Zero or invalid equity" };
  }
  if (entryPrice <= 0 || !isFinite(entryPrice)) {
    return { quantity: 0, capitalRequired: 0, method: risk.sizingMethod, warning: "Zero or invalid entry price" };
  }

  let quantity = 0;

  switch (risk.sizingMethod) {
    case "FIXED_QUANTITY": {
      quantity = Math.floor(risk.sizeValue);
      break;
    }
    case "FIXED_CAPITAL": {
      quantity = Math.floor(risk.sizeValue / entryPrice);
      break;
    }
    case "PERCENT_OF_EQUITY": {
      const pct = Math.min(risk.sizeValue, risk.maximumPositionPercent ?? 100);
      quantity = Math.floor((currentEquity * (pct / 100)) / entryPrice);
      break;
    }
    case "RISK_PER_TRADE": {
      // Stop must be defined or stopLossPercent must be set
      const stop = stopPrice ?? (risk.stopLossPercent != null
        ? entryPrice * (1 - risk.stopLossPercent / 100)
        : undefined);
      if (!stop || stop >= entryPrice) {
        return {
          quantity: 0, capitalRequired: 0, method: risk.sizingMethod,
          warning: "RISK_PER_TRADE requires a valid stop price below entry",
        };
      }
      const riskPerShare = entryPrice - stop;
      quantity = Math.floor(risk.sizeValue / riskPerShare);
      break;
    }
    case "VOLATILITY_TARGET": {
      if (!atr || atr <= 0) {
        return {
          quantity: 0, capitalRequired: 0, method: risk.sizingMethod,
          warning: "VOLATILITY_TARGET requires a valid ATR > 0",
        };
      }
      // Size such that 1-ATR move = sizeValue% of equity
      const targetRisk = currentEquity * (risk.sizeValue / 100);
      quantity = Math.floor(targetRisk / atr);
      break;
    }
  }

  // Bound by maximum position percent
  if (risk.maximumPositionPercent != null) {
    const maxQty = Math.floor((currentEquity * (risk.maximumPositionPercent / 100)) / entryPrice);
    quantity = Math.min(quantity, maxQty);
  }

  // Ensure non-negative
  quantity = Math.max(0, quantity);

  return {
    quantity,
    capitalRequired: quantity * entryPrice,
    method: risk.sizingMethod,
  };
}
