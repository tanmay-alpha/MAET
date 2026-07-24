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

function calculateMarkedUnrealisedPnl(
  position: PaperPosition,
  quotePrice: number
): number {
  return position.quantity > 0
    ? position.quantity * (quotePrice - position.averagePrice)
    : Math.abs(position.quantity) *
        (position.averagePrice - quotePrice);
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

export function calculateProjectedMarginAfterFill(input: {
  account: PaperAccount;
  symbol: string;
  quote: ExecutionQuote;
  reconciliation: PositionReconciliationResult;
  fillPrice: number;
  fees: number;
  projectedPositions: PaperPosition[];
  leverage?: number;
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
    totalMarkedUnrealisedPnlBefore += isSameSymbol(
      position.symbol,
      input.symbol
    )
      ? calculateMarkedUnrealisedPnl(position, input.quote.price)
      : position.unrealisedPnl;
  }

  const equityBefore =
    input.account.cash + totalMarkedUnrealisedPnlBefore;
  const projectedCash =
    input.account.cash +
    input.reconciliation.realisedPnl -
    input.fees;

  let projectedTotalUnrealisedPnl = 0;
  for (const position of input.projectedPositions) {
    projectedTotalUnrealisedPnl += isSameSymbol(
      position.symbol,
      input.symbol
    )
      ? calculateMarkedUnrealisedPnl(position, input.quote.price)
      : position.unrealisedPnl;
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
