import type { PositionReconciliationResult } from "./reconcile-position";
import type { PaperPosition } from "./types";

export function calculateIncrementalMarginFromReconciliation(
  reconciliation: PositionReconciliationResult,
  fillPrice: number,
  leverage: number = 5
): number {
  if (reconciliation.openedQuantity <= 0) {
    return 0;
  }
  return (reconciliation.openedQuantity * fillPrice) / leverage;
}

export function calculateAccountMargins(
  positions: PaperPosition[],
  leverage: number = 5
): { allocatedMargin: number; maintenanceMargin: number } {
  let totalMargin = 0;
  for (const pos of positions) {
    totalMargin += (Math.abs(pos.quantity) * pos.averagePrice) / leverage;
  }
  return {
    allocatedMargin: totalMargin,
    maintenanceMargin: totalMargin * 0.8,
  };
}
