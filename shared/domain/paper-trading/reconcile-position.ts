export interface PositionReconciliationInput {
  existingQuantity: number;
  existingAveragePrice: number;
  side: "BUY" | "SELL";
  fillQuantity: number;
  fillPrice: number;
}

export interface PositionReconciliationResult {
  previousQuantity: number;
  signedFillQuantity: number;
  resultingQuantity: number;

  closedQuantity: number;
  openedQuantity: number;

  resultingAveragePrice: number;
  realisedPnl: number;

  action:
    | "OPEN"
    | "INCREASE"
    | "REDUCE"
    | "CLOSE"
    | "REVERSE";
}

export function reconcilePosition(
  input: PositionReconciliationInput
): PositionReconciliationResult {
  const { existingQuantity, existingAveragePrice, side, fillQuantity, fillPrice } = input;

  if (!Number.isFinite(existingQuantity) || !Number.isFinite(existingAveragePrice)) {
    throw new Error("Invalid position input: existing quantity and average price must be finite numbers");
  }
  if (!Number.isFinite(fillQuantity) || fillQuantity <= 0) {
    throw new Error("Invalid fill input: fill quantity must be a positive finite number");
  }
  if (!Number.isFinite(fillPrice) || fillPrice <= 0) {
    throw new Error("Invalid fill input: fill price must be a positive finite number");
  }

  const signedFillQuantity = side === "BUY" ? fillQuantity : -fillQuantity;
  const resultingQuantity = existingQuantity + signedFillQuantity;

  if (existingQuantity === 0) {
    return {
      previousQuantity: existingQuantity,
      signedFillQuantity,
      resultingQuantity,
      closedQuantity: 0,
      openedQuantity: Math.abs(signedFillQuantity),
      resultingAveragePrice: fillPrice,
      realisedPnl: 0,
      action: "OPEN",
    };
  }

  const existingDirection = Math.sign(existingQuantity);
  const fillDirection = Math.sign(signedFillQuantity);

  if (existingDirection === fillDirection) {
    const totalAbsQty = Math.abs(resultingQuantity);
    const WeightedAvg =
      (Math.abs(existingQuantity) * existingAveragePrice + Math.abs(signedFillQuantity) * fillPrice) / totalAbsQty;

    return {
      previousQuantity: existingQuantity,
      signedFillQuantity,
      resultingQuantity,
      closedQuantity: 0,
      openedQuantity: Math.abs(signedFillQuantity),
      resultingAveragePrice: WeightedAvg,
      realisedPnl: 0,
      action: "INCREASE",
    };
  }

  // Opposite signs
  const oldAbs = Math.abs(existingQuantity);
  const fillAbs = Math.abs(signedFillQuantity);

  if (fillAbs < oldAbs) {
    const closedQuantity = fillAbs;
    const realisedPnl = closedQuantity * (fillPrice - existingAveragePrice) * existingDirection;

    return {
      previousQuantity: existingQuantity,
      signedFillQuantity,
      resultingQuantity,
      closedQuantity,
      openedQuantity: 0,
      resultingAveragePrice: existingAveragePrice,
      realisedPnl,
      action: "REDUCE",
    };
  } else if (fillAbs === oldAbs) {
    const closedQuantity = oldAbs;
    const realisedPnl = closedQuantity * (fillPrice - existingAveragePrice) * existingDirection;

    return {
      previousQuantity: existingQuantity,
      signedFillQuantity,
      resultingQuantity: 0,
      closedQuantity,
      openedQuantity: 0,
      resultingAveragePrice: 0,
      realisedPnl,
      action: "CLOSE",
    };
  } else {
    // fillAbs > oldAbs => REVERSE
    const closedQuantity = oldAbs;
    const openedQuantity = fillAbs - oldAbs;
    const realisedPnl = closedQuantity * (fillPrice - existingAveragePrice) * existingDirection;

    return {
      previousQuantity: existingQuantity,
      signedFillQuantity,
      resultingQuantity,
      closedQuantity,
      openedQuantity,
      resultingAveragePrice: fillPrice,
      realisedPnl,
      action: "REVERSE",
    };
  }
}
