/**
 * Fee Model — approximates Indian equity transaction costs.
 *
 * IMPORTANT: These are configurable approximations for paper trading simulation.
 * They are NOT guaranteed tax advice and NOT legally accurate.
 * Actual statutory charges depend on trade size, exchange, instrument, and regulation changes.
 *
 * Default values reflect NSE equity delivery orders circa 2024-2025 (approximate).
 */

import type { StrategyExecutionConfig, FeeModelType } from "../../../shared/strategy/ast";

export interface FeeResult {
  /** Total fees as fraction of trade value (0.001 = 0.1%) */
  totalFeeRate: number;
  /** Breakdown in bps */
  breakdown: {
    brokerage: number;
    stt: number;
    exchangeCharges: number;
    gst: number;
    sebiCharges: number;
    stampDuty: number;
    slippage: number;
  };
}

/** Default NSE equity delivery fee approximation in basis points */
const DEFAULTS_DELIVERY = {
  brokerage: 0,      // zero brokerage (many brokers)
  stt: 10,           // 0.1% of trade value (both legs)
  exchangeCharges: 3, // approx 0.00345% NSE
  gst: 18,           // 18% of (brokerage + exchange charges)
  sebiCharges: 0.1,  // 0.0001%
  stampDuty: 3,      // 0.015% on buy side
  slippage: 5,       // default slippage in bps
};

export function computeFeeRate(
  executionConfig: StrategyExecutionConfig,
  tradeValueInr: number,
): FeeResult {
  const model: FeeModelType = executionConfig.feeModel;

  if (model === "NONE") {
    return {
      totalFeeRate: 0,
      breakdown: { brokerage: 0, stt: 0, exchangeCharges: 0, gst: 0, sebiCharges: 0, stampDuty: 0, slippage: 0 },
    };
  }

  if (model === "FIXED_BPS") {
    const feeBps = executionConfig.feeBps ?? 10;
    const slippage = executionConfig.slippageBps ?? 5;
    const totalBps = feeBps + slippage;
    return {
      totalFeeRate: totalBps / 10000,
      breakdown: {
        brokerage: feeBps,
        stt: 0, exchangeCharges: 0, gst: 0, sebiCharges: 0, stampDuty: 0,
        slippage,
      },
    };
  }

  // VOLUME_AWARE: approximate Indian statutory charges
  // All values in bps (per 10,000 of trade value)
  const brokerage = executionConfig.brokerage != null
    ? (executionConfig.brokerage / Math.max(tradeValueInr, 1)) * 10000
    : DEFAULTS_DELIVERY.brokerage;

  const sttBps = executionConfig.stt ?? DEFAULTS_DELIVERY.stt;
  const excBps = executionConfig.exchangeCharges ?? DEFAULTS_DELIVERY.exchangeCharges;
  const gstBps = executionConfig.gst ?? DEFAULTS_DELIVERY.gst;
  const sebiBps = executionConfig.sebiCharges ?? DEFAULTS_DELIVERY.sebiCharges;
  const stampBps = executionConfig.stampDuty ?? DEFAULTS_DELIVERY.stampDuty;
  const slippageBps = executionConfig.slippageBps ?? DEFAULTS_DELIVERY.slippage;

  // GST applies to brokerage + exchange charges
  const gstActual = ((brokerage + excBps) * gstBps) / 10000;

  const totalBps = brokerage + sttBps + excBps + gstActual + sebiBps + stampBps + slippageBps;

  return {
    totalFeeRate: totalBps / 10000,
    breakdown: {
      brokerage,
      stt: sttBps,
      exchangeCharges: excBps,
      gst: gstActual,
      sebiCharges: sebiBps,
      stampDuty: stampBps,
      slippage: slippageBps,
    },
  };
}

/** Shorthand: compute round-trip fee rate (entry + exit) */
export function computeRoundTripFeeRate(
  executionConfig: StrategyExecutionConfig,
  tradeValueInr: number,
): number {
  return computeFeeRate(executionConfig, tradeValueInr).totalFeeRate * 2;
}
