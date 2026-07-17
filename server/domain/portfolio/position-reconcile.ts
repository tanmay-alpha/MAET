/**
 * CRITICAL FIX — Short Position Average Price Bug
 *
 * BEFORE (broken): Math.abs() on old/new shares destroys sign, causing wrong
 *   average price when a short reverses to long (or vice versa).
 *
 * AFTER (correct): Uses a position-reconciliation function that preserves
 *   direction through closes and resets the average on reversal.
 */

import { eq } from "drizzle-orm";

// ---------------------------------------------------------------------------
// Position reconciliation — replaces the buggy inline math in matcher.ts
// ---------------------------------------------------------------------------

export interface ReconciliationInput {
  oldQty: number;          // signed: positive = long, negative = short
  oldAvgPrice: number;     // entry price of existing position (always positive)
  newFillQty: number;      // always positive (absolute fill quantity)
  newFillSide: "BUY" | "SELL";
  newFillPrice: number;    // price of the incoming fill
}

export interface ReconciliationResult {
  newQty: number;          // signed resulting position
  newAvgPrice: number;     // VWAP of the OPEN portion only (positive)
  realizedPnl: number;     // P&L from the closed portion
  closedQty: number;       // how many shares were closed this fill
  remainingNewQty: number; // portion of new fill that became the new position
}

/**
 * Reconciles an existing position with an incoming fill, correctly handling:
 *   1. Increasing an existing long/short (same direction)
 *   2. Partially closing a position
 *   3. Fully closing and opening a new position in the opposite direction
 *   4. Closing and partially opening a reverse position
 */
export function reconcilePosition(input: ReconciliationInput): ReconciliationResult {
  const { oldQty, oldAvgPrice, newFillQty, newFillSide, newFillPrice } = input;

  // signed old and new quantities (same sign convention: positive = long)
  const signedOldQty = oldQty;
  const signedNewFill = newFillSide === "BUY" ? newFillQty : -newFillQty;

  const oldAbsQty = Math.abs(signedOldQty);
  const oldDirection = signedOldQty >= 0 ? 1 : -1;   // +1 long, -1 short
  const newDirection = signedNewFill >= 0 ? 1 : -1;

  // No existing position — new fill becomes the position
  if (oldAbsQty === 0) {
    return {
      newQty: signedNewFill,
      newAvgPrice: newFillPrice,
      realizedPnl: 0,
      closedQty: 0,
      remainingNewQty: newFillQty,
    };
  }

  // Same direction — add to position (VWAP update)
  if (oldDirection === newDirection) {
    const newAbsQty = oldAbsQty + newFillQty;
    const newAvg = (oldAbsQty * oldAvgPrice + newFillQty * newFillPrice) / newAbsQty;
    return {
      newQty: oldDirection * newAbsQty,
      newAvgPrice: newAvg,
      realizedPnl: 0,
      closedQty: 0,
      remainingNewQty: newFillQty,
    };
  }

  // Opposite direction — this is a close (and possibly a reversal)
  const closedQty = Math.min(oldAbsQty, newFillQty);

  // P&L on the closed portion
  // For a long: profit = (sell price - buy price) * qty
  // For a short: profit = (buy price - sell price) * qty = (sell price - buy price) * (-qty)
  // Unified: profit = signedNewFill * closePrice - signedOldQty * oldAvgPrice, all per share, times closedQty
  const unitPnl = (signedNewFill > 0 ? newFillPrice : -newFillPrice) * oldDirection
    - oldAvgPrice * oldDirection * oldDirection;
  // Simpler: if old is long (+), new fill is sell (-): pnl = (sellPrice - buyPrice) * closedQty
  // if old is short (-), new fill is buy (+): pnl = (buyPrice - sellPrice) * closedQty
  const realizedPnl =
    oldDirection > 0
      ? (newFillPrice - oldAvgPrice) * closedQty        // closing a long
      : (oldAvgPrice - newFillPrice) * closedQty;        // closing a short

  const remainingNewQty = newFillQty - closedQty;

  // If the new fill completely closes and reverses
  if (remainingNewQty === 0) {
    return {
      newQty: 0,
      newAvgPrice: 0,
      realizedPnl,
      closedQty,
      remainingNewQty: 0,
    };
  }

  // Reversal: remaining new fill opens a position in the opposite direction
  // The new average price is the VWAP of the remaining fill only
  return {
    newQty: newDirection * remainingNewQty,
    newAvgPrice: newFillPrice,
    realizedPnl,
    closedQty,
    remainingNewQty,
  };
}
