/**
 * Fee Model — per-leg transaction charges for backtests, in INR.
 *
 * - NONE: no charges.
 * - FIXED_BPS: `feeBps` of the leg notional, reported as brokerage.
 * - VOLUME_AWARE: Indian cash-equity statutory charges from the shared schedule
 *   (shared/domain/costs/indian-equity-charges.ts, the same one paper trading uses) for the
 *   configured exchange (default NSE) and product (default DELIVERY), plus `brokerage` INR per order.
 *   Charges are side-aware: stamp duty applies to BUY legs only, intraday STT to SELL legs only.
 *
 * Slippage is not a fee; the execution engines apply it to the fill price separately.
 */

import type { StrategyExecutionConfig } from "../../../shared/strategy/ast";
import { computeIndianEquityCharges, type TradeSide } from "../../../shared/domain/costs/indian-equity-charges";

export interface LegCharges {
  /** Broker commission in INR (FIXED_BPS reports its whole charge here). */
  brokerage: number;
  /** STT, exchange transaction charge, SEBI fee, stamp duty and GST, in INR. */
  taxesAndCharges: number;
  total: number;
}

const DEFAULT_FIXED_FEE_BPS = 10;

export function computeLegCharges(
  executionConfig: StrategyExecutionConfig,
  side: TradeSide,
  notionalInr: number,
): LegCharges {
  if (executionConfig.feeModel === "NONE" || notionalInr <= 0) {
    return { brokerage: 0, taxesAndCharges: 0, total: 0 };
  }

  if (executionConfig.feeModel === "FIXED_BPS") {
    const total = notionalInr * (executionConfig.feeBps ?? DEFAULT_FIXED_FEE_BPS) / 10_000;
    return { brokerage: total, taxesAndCharges: 0, total };
  }

  const charges = computeIndianEquityCharges({
    exchange: executionConfig.exchange ?? "NSE",
    product: executionConfig.product ?? "DELIVERY",
    side,
    turnoverInr: notionalInr,
    brokerageInr: executionConfig.brokerage ?? 0,
  });
  return {
    brokerage: charges.brokerage,
    taxesAndCharges: Math.round((charges.total - charges.brokerage) * 100) / 100,
    total: charges.total,
  };
}
