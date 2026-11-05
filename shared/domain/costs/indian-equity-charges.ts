/**
 * Statutory charges for Indian cash-equity trades (NSE / BSE).
 *
 * Single source of truth for paper trading and backtesting so both engines
 * charge the same costs for the same trade.
 *
 * Schedule effective 2024-10-01:
 * - NSE transaction charge 0.00297% of turnover (NSE circular FA/64232, 2024-09-27).
 * - BSE transaction charge 0.00375% of turnover (BSE equity-cash groups A/B and similar).
 * - STT: delivery 0.1% on buy and sell; intraday 0.025% on sell only.
 * - SEBI turnover fee: ₹10 per crore (0.0001%) on both sides.
 * - Stamp duty: delivery 0.015% on buy only; intraday 0.003% on buy only.
 * - GST: 18% on (brokerage + exchange transaction charge + SEBI fee).
 *
 * Brokerage is broker-specific and therefore an explicit input (default ₹0).
 * Components are rounded to paise; contract notes may round STT to the rupee.
 */

export type EquityExchange = "NSE" | "BSE";
export type EquityProduct = "DELIVERY" | "INTRADAY";
export type TradeSide = "BUY" | "SELL";

export const INDIAN_EQUITY_CHARGE_SCHEDULE = {
  effectiveFrom: "2024-10-01",
  exchangeTxnRate: { NSE: 0.0000297, BSE: 0.0000375 },
  sttRate: {
    DELIVERY: { BUY: 0.001, SELL: 0.001 },
    INTRADAY: { BUY: 0, SELL: 0.00025 },
  },
  sebiFeeRate: 0.000001,
  stampDutyRate: {
    DELIVERY: { BUY: 0.00015, SELL: 0 },
    INTRADAY: { BUY: 0.00003, SELL: 0 },
  },
  gstRate: 0.18,
} as const;

export interface EquityChargeInput {
  exchange: EquityExchange;
  product: EquityProduct;
  side: TradeSide;
  /** price × quantity in INR; must be finite and non-negative */
  turnoverInr: number;
  /** broker commission in INR for this leg; defaults to 0 */
  brokerageInr?: number;
}

export interface EquityChargeBreakdown {
  brokerage: number;
  stt: number;
  exchangeTxn: number;
  sebiFee: number;
  stampDuty: number;
  gst: number;
  total: number;
}

const toPaise = (value: number): number => Math.round(value * 100) / 100;

export function computeIndianEquityCharges(input: EquityChargeInput): EquityChargeBreakdown {
  const turnover = input.turnoverInr;
  const brokerageInput = input.brokerageInr ?? 0;
  if (!Number.isFinite(turnover) || turnover < 0) {
    throw new RangeError(`turnoverInr must be a finite non-negative number, received ${turnover}`);
  }
  if (!Number.isFinite(brokerageInput) || brokerageInput < 0) {
    throw new RangeError(`brokerageInr must be a finite non-negative number, received ${brokerageInput}`);
  }

  const schedule = INDIAN_EQUITY_CHARGE_SCHEDULE;
  const brokerage = toPaise(brokerageInput);
  const stt = toPaise(turnover * schedule.sttRate[input.product][input.side]);
  const exchangeTxn = toPaise(turnover * schedule.exchangeTxnRate[input.exchange]);
  const sebiFee = toPaise(turnover * schedule.sebiFeeRate);
  const stampDuty = toPaise(turnover * schedule.stampDutyRate[input.product][input.side]);
  const gst = toPaise((brokerage + exchangeTxn + sebiFee) * schedule.gstRate);
  const total = toPaise(brokerage + stt + exchangeTxn + sebiFee + stampDuty + gst);

  return { brokerage, stt, exchangeTxn, sebiFee, stampDuty, gst, total };
}
