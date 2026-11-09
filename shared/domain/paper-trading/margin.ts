import type { ExecutionQuote } from "../../types/market";
import type { PositionReconciliationResult } from "./reconcile-position";
import type { PaperAccount, PaperPosition } from "./types";

const DEFAULT_PAPER_LEVERAGE = 5;
const MAINTENANCE_MARGIN_RATIO = 0.8;

export interface ProjectedMarginResult {
  equityBefore: number;
  equityAfter: number;
  allocatedMarginBefore: number;
  allocatedMarginAfter: number;
  maintenanceMarginAfter: number;
  freeMarginAfter: number;
  sufficient: boolean;
}

function isSameSymbol(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

export function calculateMarkedUnrealisedPnl(
  position: { quantity: number; averagePrice: number },
  quotePrice: number
): number {
  return position.quantity > 0
    ? position.quantity * (quotePrice - position.averagePrice)
    : Math.abs(position.quantity) *
        (position.averagePrice - quotePrice);
}

export function getPositionCloseSide(position: {
  side?: "LONG" | "SHORT" | string | null;
  totalShares?: number;
  quantity?: number;
}): "BUY" | "SELL" {
  if (position.side === "SHORT") return "BUY";
  if (position.quantity !== undefined && position.quantity < 0) return "BUY";
  if (position.totalShares !== undefined && position.totalShares < 0) return "BUY";
  return "SELL";
}

export function calculateAccountMargins(
  positions: PaperPosition[],
  leverage: number = DEFAULT_PAPER_LEVERAGE
): { allocatedMargin: number; maintenanceMargin: number } {
  if (!Number.isFinite(leverage) || leverage <= 0) {
    throw new Error("Leverage must be a positive finite number");
  }

  let totalMargin = 0;
  for (const position of positions) {
    totalMargin +=
      (Math.abs(position.quantity) * position.averagePrice) / leverage;
  }

  return {
    allocatedMargin: totalMargin,
    maintenanceMargin: totalMargin * MAINTENANCE_MARGIN_RATIO,
  };
}

/**
 * Unrealised P&L a margin decision may count for one position. The traded symbol is
 * marked at the fill quote and any other position at its current mark. A position with no
 * current mark keeps the loss it showed at its last known price but gets no credit for a
 * gain: that price can be arbitrarily old, so it may hide a loss taken since and must never
 * add buying power.
 */
export function marginUnrealisedPnl(
  position: PaperPosition,
  tradedSymbol: string,
  quotePrice: number,
  marks: ReadonlyMap<string, number> | undefined
): number {
  if (isSameSymbol(position.symbol, tradedSymbol)) {
    return calculateMarkedUnrealisedPnl(position, quotePrice);
  }
  const mark = marks?.get(position.symbol);
  if (mark !== undefined && Number.isFinite(mark) && mark > 0) {
    return calculateMarkedUnrealisedPnl(position, mark);
  }
  return Math.min(0, position.unrealisedPnl);
}

export function calculateProjectedMarginAfterFill(input: {
  account: PaperAccount;
  symbol: string;
  quote: ExecutionQuote;
  reconciliation: PositionReconciliationResult;
  fillPrice: number;
  fees: number;
  projectedPositions: PaperPosition[];
  leverage?: number;
  /** Current mark price per position symbol other than the traded one (see marginUnrealisedPnl). */
  marks?: ReadonlyMap<string, number>;
}): ProjectedMarginResult {
  const leverage = input.leverage ?? DEFAULT_PAPER_LEVERAGE;
  if (!Number.isFinite(input.fillPrice) || input.fillPrice <= 0) {
    throw new Error("Fill price must be a positive finite number");
  }
  if (!Number.isFinite(input.fees) || input.fees < 0) {
    throw new Error("Fees must be a non-negative finite number");
  }

  const { allocatedMargin: allocatedMarginBefore } =
    calculateAccountMargins(input.account.positions, leverage);

  let totalMarkedUnrealisedPnlBefore = 0;
  for (const position of input.account.positions) {
    totalMarkedUnrealisedPnlBefore += marginUnrealisedPnl(
      position,
      input.symbol,
      input.quote.price,
      input.marks
    );
  }

  const equityBefore =
    input.account.cash + totalMarkedUnrealisedPnlBefore;
  const projectedCash =
    input.account.cash +
    input.reconciliation.realisedPnl -
    input.fees;

  let projectedTotalUnrealisedPnl = 0;
  for (const position of input.projectedPositions) {
    projectedTotalUnrealisedPnl += marginUnrealisedPnl(
      position,
      input.symbol,
      input.quote.price,
      input.marks
    );
  }

  const equityAfter =
    projectedCash + projectedTotalUnrealisedPnl;
  const {
    allocatedMargin: allocatedMarginAfter,
    maintenanceMargin: maintenanceMarginAfter,
  } = calculateAccountMargins(input.projectedPositions, leverage);
  const freeMarginAfter = equityAfter - allocatedMarginAfter;

  return {
    equityBefore,
    equityAfter,
    allocatedMarginBefore,
    allocatedMarginAfter,
    maintenanceMarginAfter,
    freeMarginAfter,
    sufficient:
      allocatedMarginAfter <= equityAfter &&
      freeMarginAfter >= 0,
  };
}
