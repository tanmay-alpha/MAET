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
  /**
   * The fill opens nothing and lowers allocated margin: a partial or full close. Such a fill
   * can only shrink exposure, so callers never refuse it for lack of margin.
   */
  reducesExposure: boolean;
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
 * Freshest known price per position, keyed like `PaperPosition.symbol`. Callers supply the
 * newest real mark they have (a live quote, else the position's last stored mark); a position
 * without an entry here keeps its stored unrealised P&L.
 */
export type PositionMarks = Readonly<Record<string, number>>;

function markedUnrealisedPnl(position: PaperPosition, symbol: string, quotePrice: number, marks: PositionMarks | undefined): number {
  if (isSameSymbol(position.symbol, symbol)) {
    return calculateMarkedUnrealisedPnl(position, quotePrice);
  }
  const mark = marks?.[position.symbol];
  return mark !== undefined && Number.isFinite(mark) && mark > 0
    ? calculateMarkedUnrealisedPnl(position, mark)
    : position.unrealisedPnl;
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
  /** Freshest marks for the account's other positions; the filled symbol uses `quote`. */
  marks?: PositionMarks;
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
    totalMarkedUnrealisedPnlBefore += markedUnrealisedPnl(position, input.symbol, input.quote.price, input.marks);
  }

  const equityBefore =
    input.account.cash + totalMarkedUnrealisedPnlBefore;
  const projectedCash =
    input.account.cash +
    input.reconciliation.realisedPnl -
    input.fees;

  let projectedTotalUnrealisedPnl = 0;
  for (const position of input.projectedPositions) {
    projectedTotalUnrealisedPnl += markedUnrealisedPnl(position, input.symbol, input.quote.price, input.marks);
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
    reducesExposure:
      input.reconciliation.openedQuantity === 0 &&
      allocatedMarginAfter < allocatedMarginBefore,
  };
}
