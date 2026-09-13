/**
 * Chart Paper Overlay Helper
 *
 * Extracts active paper trading position, protective stop-loss,
 * take-profit levels, and unrealized P&L to render directly on
 * TradingView Lightweight Charts price scale.
 */

import type { PaperPositionRow, PaperOrderRow } from "../../../server/modules/paper-trading/contracts";
import type { PaperOverlayState } from "./lightweight-chart";

/**
 * Extracts paper overlay state for a specific symbol given the current
 * paper trading positions and open orders.
 */
export function extractPaperOverlay(
  symbol: string,
  positions: PaperPositionRow[] = [],
  orders: PaperOrderRow[] = []
): PaperOverlayState | null {
  const normSymbol = symbol.trim().toUpperCase();

  // Find active position for this symbol
  const position = positions.find(
    (p) => p.symbol.trim().toUpperCase() === normSymbol && Number(p.totalShares) > 0
  );

  // Find pending protective orders for this symbol
  const pendingOrders = orders.filter(
    (o) =>
      o.symbol.trim().toUpperCase() === normSymbol &&
      (o.status === "PENDING" || o.status === "TRIGGER_PENDING")
  );

  if (position) {
    const entryPrice = Number(position.averageEntryPrice);
    const side = (position.side === "SHORT" ? "SHORT" : "LONG") as "LONG" | "SHORT";
    const unrealizedPnL = Number(position.unrealizedPnl || 0);

    let stopLoss: number | undefined;
    let takeProfit: number | undefined;

    // Look for protective stop loss and take profit among pending orders
    for (const order of pendingOrders) {
      // Direct bracket order fields
      if (order.stopLossPrice && Number(order.stopLossPrice) > 0) {
        stopLoss = Number(order.stopLossPrice);
      }
      if (order.takeProfitPrice && Number(order.takeProfitPrice) > 0) {
        takeProfit = Number(order.takeProfitPrice);
      }

      // Or dedicated stop loss orders
      if (order.stopPrice && Number(order.stopPrice) > 0) {
        stopLoss = Number(order.stopPrice);
      }

      // Or take-profit limit orders (closing direction)
      if (order.type === "LIMIT" && order.limitPrice && Number(order.limitPrice) > 0) {
        const lim = Number(order.limitPrice);
        if (side === "LONG" && order.side === "SELL" && lim > entryPrice) {
          takeProfit = lim;
        } else if (side === "SHORT" && order.side === "BUY" && lim < entryPrice) {
          takeProfit = lim;
        }
      }
    }

    return {
      averageEntryPrice: entryPrice,
      stopLoss,
      takeProfit,
      unrealizedPnL,
      side,
    };
  }

  // If no open position, check if there are pending limit orders
  const pendingEntry = pendingOrders.find((o) => o.type === "LIMIT" && o.limitPrice);
  if (pendingEntry && pendingEntry.limitPrice) {
    return {
      averageEntryPrice: Number(pendingEntry.limitPrice),
      stopLoss: pendingEntry.stopLossPrice ? Number(pendingEntry.stopLossPrice) : undefined,
      takeProfit: pendingEntry.takeProfitPrice ? Number(pendingEntry.takeProfitPrice) : undefined,
      side: pendingEntry.side === "SELL" ? "SHORT" : "LONG",
    };
  }

  return null;
}
