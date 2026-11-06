import {
  evaluateExecutionQuote,
  parseExecutionQuote,
  type ExecutionQuote,
} from "../../types/market";
import {
  computeIndianEquityCharges,
  type EquityChargeBreakdown,
  type EquityExchange,
} from "../costs/indian-equity-charges";
import {
  calculateProjectedMarginAfterFill,
  type PositionMarks,
} from "./margin";
import {
  reconcilePosition,
  type PositionReconciliationResult,
} from "./reconcile-position";
import {
  formatValidationError,
  PlacePaperOrderSchema,
  type PaperAccount,
  type PaperExecutionReason,
  type PaperFill,
  type PaperOrder,
  type PaperPosition,
} from "./types";

const PAPER_LEVERAGE = 5;
/**
 * Paper orders carry no product (CNC/MIS) field, so every fill is charged as
 * DELIVERY: the conservative schedule (STT on both legs, 0.015% stamp duty on
 * buys). Brokerage is zero, matching discount-broker equity delivery.
 */
export const PAPER_CHARGE_PRODUCT = "DELIVERY" as const;

export function calculateSlippage(price: number, quantity: number): number {
  if (price <= 0 || quantity <= 0) return 0;
  const orderValue = price * quantity;

  let basePercentage = 0.0005;
  if (orderValue > 1_000_000) basePercentage = 0.003;
  else if (orderValue > 200_000) basePercentage = 0.0015;

  return Math.round(price * basePercentage * 100) / 100;
}

export type PaperExecutionRequest = {
  account: PaperAccount;
  order: PaperOrder;
  fillQuantity: number;
  quote: ExecutionQuote;
  reason: PaperExecutionReason;
  /** Exchange the order routes to; statutory charges depend on it. Defaults to the quote's exchange. */
  exchange?: EquityExchange;
  /** Freshest marks for the account's other positions (see `PositionMarks`). */
  marks?: PositionMarks;
  policy?: {
    allowDelayed?: boolean;
    maxAgeMs?: number;
    allowSynthetic?: boolean;
  };
};

export type PaperExecutionPlan = {
  referencePrice: number;
  fillPrice: number;
  slippage: number;
  fees: number;
  charges: EquityChargeBreakdown;
  fillQuantity: number;
};

export interface ExecuteFillResult {
  account: PaperAccount;
  /** The filled order after this fill (status, filled quantity, average price). */
  order: PaperOrder;
  fill: PaperFill;
  charges: EquityChargeBreakdown;
}

export type PaperExecutionErrorCode =
  | "INVALID_QUOTE"
  | "NON_EXECUTABLE_QUOTE"
  | "INVALID_ORDER"
  | "ORDER_NOT_MARKETABLE"
  | "INSUFFICIENT_MARGIN";

export class PaperExecutionError extends Error {
  readonly code: PaperExecutionErrorCode;

  constructor(code: PaperExecutionErrorCode, message: string) {
    super(message);
    this.name = "PaperExecutionError";
    this.code = code;
  }
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "Unknown paper execution error";
}

function sameSymbol(left: string, right: string): boolean {
  return left.trim().toUpperCase() === right.trim().toUpperCase();
}

function wasStopTriggered(order: PaperOrder): boolean {
  return (
    order.status === "TRIGGERED" ||
    (order.status === "PARTIALLY_FILLED" && order.triggeredAt !== undefined)
  );
}

function isWorkingOrder(order: PaperOrder): boolean {
  return (
    order.status === "PENDING" ||
    order.status === "TRIGGERED" ||
    order.status === "PARTIALLY_FILLED"
  );
}

/**
 * Shares a bracket exit may still fill: its unfilled quantity, capped at the position it
 * protects (a SELL exit closes a long, a BUY exit closes a short). 0 once that position is gone.
 */
export function closableExitQuantity(
  exit: Pick<PaperOrder, "side" | "quantity" | "filledQuantity">,
  positionQuantity: number
): number {
  const closable =
    exit.side === "SELL"
      ? Math.max(0, positionQuantity)
      : Math.max(0, -positionQuantity);
  return Math.min(exit.quantity - exit.filledQuantity, closable);
}

/**
 * Each entry fill grows the bracket exits by the filled quantity (creating them on the first
 * fill), so a partially filled entry is protected for exactly what was bought or sold.
 */
function applyEntryFillToBracket(
  orders: PaperOrder[],
  entry: PaperOrder,
  fillQuantity: number,
  fillTime: string
): PaperOrder[] {
  const hasWorkingExit = orders.some(
    (order) => order.parentOrderId === entry.id && isWorkingOrder(order)
  );
  if (hasWorkingExit) {
    return orders.map((order) =>
      order.parentOrderId === entry.id && isWorkingOrder(order)
        ? { ...order, quantity: order.quantity + fillQuantity, updatedAt: fillTime }
        : order
    );
  }

  const side = entry.side === "BUY" ? "SELL" : "BUY";
  const exits: PaperOrder[] = [];
  if (entry.takeProfitPrice) {
    exits.push({
      id: crypto.randomUUID(),
      symbol: entry.symbol,
      side,
      quantity: fillQuantity,
      type: "LIMIT",
      limitPrice: entry.takeProfitPrice,
      status: "PENDING",
      filledQuantity: 0,
      parentOrderId: entry.id,
      createdAt: fillTime,
      updatedAt: fillTime,
    });
  }
  if (entry.stopLossPrice) {
    exits.push({
      id: crypto.randomUUID(),
      symbol: entry.symbol,
      side,
      quantity: fillQuantity,
      type: "STOP_LOSS_MARKET",
      stopPrice: entry.stopLossPrice,
      status: "PENDING",
      filledQuantity: 0,
      parentOrderId: entry.id,
      createdAt: fillTime,
      updatedAt: fillTime,
    });
  }
  return [...exits, ...orders];
}

/**
 * One-cancels-other with quantity linkage: every exit fill shrinks the working siblings by
 * the filled quantity, and once the position is flat the remaining siblings are cancelled.
 */
function applyExitFillToSiblings(
  orders: PaperOrder[],
  exit: PaperOrder,
  fillQuantity: number,
  positionAfter: number,
  fillTime: string
): PaperOrder[] {
  return orders.map((order): PaperOrder => {
    if (
      order.id === exit.id ||
      order.parentOrderId !== exit.parentOrderId ||
      !isWorkingOrder(order)
    ) {
      return order;
    }
    const quantity = order.quantity - fillQuantity;
    if (positionAfter === 0 || quantity <= order.filledQuantity) {
      return {
        ...order,
        status: "CANCELLED",
        rejectionReason: "OCO bracket sibling filled",
        updatedAt: fillTime,
      };
    }
    return { ...order, quantity, updatedAt: fillTime };
  });
}

function assertExecutableQuote(
  rawQuote: unknown,
  expectedSymbol: string
): ExecutionQuote {
  const parsed = parseExecutionQuote(rawQuote, expectedSymbol);
  if (!parsed.ok) {
    throw new PaperExecutionError("INVALID_QUOTE", parsed.reason);
  }

  const policy = evaluateExecutionQuote(
    parsed.quote,
    expectedSymbol
  );
  if (!policy.executable) {
    throw new PaperExecutionError(
      "NON_EXECUTABLE_QUOTE",
      policy.reason ?? "Quote cannot be used for execution"
    );
  }

  return parsed.quote;
}

function createExecutionPlanFromValidatedQuote(
  request: PaperExecutionRequest,
  quote: ExecutionQuote
): PaperExecutionPlan {
  if (
    !Number.isInteger(request.fillQuantity) ||
    request.fillQuantity <= 0
  ) {
    throw new PaperExecutionError(
      "INVALID_ORDER",
      "Fill quantity must be a positive whole number"
    );
  }

  const remainingQuantity =
    request.order.quantity - request.order.filledQuantity;
  if (request.fillQuantity > remainingQuantity) {
    throw new PaperExecutionError(
      "INVALID_ORDER",
      "Fill quantity exceeds the remaining order quantity"
    );
  }

  const referencePrice = quote.price;
  const calculatedSlippage = calculateSlippage(
    referencePrice,
    request.fillQuantity
  );
  let fillPrice: number;

  if (request.order.type === "MARKET" || request.order.type === "STOP_LOSS_MARKET") {
    if (request.order.type === "STOP_LOSS_MARKET" && !wasStopTriggered(request.order)) {
      throw new PaperExecutionError(
        "INVALID_ORDER",
        "Stop-market order must be triggered before execution"
      );
    }
    fillPrice =
      request.order.side === "BUY"
        ? referencePrice + calculatedSlippage
        : Math.max(0.05, referencePrice - calculatedSlippage);
  } else {
    const limitPrice = request.order.limitPrice;
    if (
      limitPrice === undefined ||
      !Number.isFinite(limitPrice) ||
      limitPrice <= 0
    ) {
      throw new PaperExecutionError(
        "INVALID_ORDER",
        "A positive limit price is required"
      );
    }

    if (request.order.type === "STOP_LOSS_LIMIT") {
      if (!wasStopTriggered(request.order)) {
        throw new PaperExecutionError(
          "INVALID_ORDER",
          "Stop-limit order must be triggered before execution"
        );
      }
    }

    if (request.order.side === "BUY") {
      if (referencePrice > limitPrice) {
        throw new PaperExecutionError(
          "ORDER_NOT_MARKETABLE",
          "Buy limit order is not marketable"
        );
      }
      fillPrice = Math.min(
        limitPrice,
        referencePrice + calculatedSlippage
      );
      if (fillPrice > limitPrice) {
        throw new PaperExecutionError(
          "INVALID_ORDER",
          "Buy limit price protection was violated"
        );
      }
    } else {
      if (referencePrice < limitPrice) {
        throw new PaperExecutionError(
          "ORDER_NOT_MARKETABLE",
          "Sell limit order is not marketable"
        );
      }
      fillPrice = Math.max(
        limitPrice,
        Math.max(0.05, referencePrice - calculatedSlippage)
      );
      if (fillPrice < limitPrice) {
        throw new PaperExecutionError(
          "INVALID_ORDER",
          "Sell limit price protection was violated"
        );
      }
    }
  }

  const actualSlippage =
    request.order.side === "BUY"
      ? Math.max(0, fillPrice - referencePrice)
      : Math.max(0, referencePrice - fillPrice);
  const charges = computeIndianEquityCharges({
    exchange: request.exchange ?? quote.exchange,
    product: PAPER_CHARGE_PRODUCT,
    side: request.order.side,
    turnoverInr: fillPrice * request.fillQuantity,
  });

  return {
    referencePrice,
    fillPrice,
    slippage: actualSlippage,
    fees: charges.total,
    charges,
    fillQuantity: request.fillQuantity,
  };
}

export function createExecutionPlan(
  request: PaperExecutionRequest
): PaperExecutionPlan {
  const quote = assertExecutableQuote(
    request.quote,
    request.order.symbol
  );
  return createExecutionPlanFromValidatedQuote(request, quote);
}

function projectPositionsAfterFill(input: {
  positions: PaperPosition[];
  existingPosition: PaperPosition | undefined;
  order: PaperOrder;
  reconciliation: PositionReconciliationResult;
  quote: ExecutionQuote;
  fillTime: string;
}): PaperPosition[] {
  if (input.reconciliation.resultingQuantity === 0) {
    return input.positions.filter(
      (position) =>
        !sameSymbol(position.symbol, input.order.symbol)
    );
  }

  const resultingUnrealisedPnl =
    input.reconciliation.resultingQuantity > 0
      ? input.reconciliation.resultingQuantity *
        (input.quote.price -
          input.reconciliation.resultingAveragePrice)
      : Math.abs(input.reconciliation.resultingQuantity) *
        (input.reconciliation.resultingAveragePrice -
          input.quote.price);

  const projectedPosition: PaperPosition = {
    symbol: input.order.symbol,
    quantity: input.reconciliation.resultingQuantity,
    averagePrice:
      input.reconciliation.resultingAveragePrice,
    marginLocked:
      (Math.abs(input.reconciliation.resultingQuantity) *
        input.reconciliation.resultingAveragePrice) /
      PAPER_LEVERAGE,
    realisedPnl:
      (input.existingPosition?.realisedPnl ?? 0) +
      input.reconciliation.realisedPnl,
    unrealisedPnl: resultingUnrealisedPnl,
    updatedAt: input.fillTime,
  };

  if (!input.existingPosition) {
    return [...input.positions, projectedPosition];
  }

  return input.positions.map((position) =>
    sameSymbol(position.symbol, input.order.symbol)
      ? projectedPosition
      : position
  );
}

export function executePaperFill(
  request: PaperExecutionRequest
): ExecuteFillResult {
  const parsed = parseExecutionQuote(
    request.quote,
    request.order.symbol
  );
  if (!parsed.ok) {
    throw new PaperExecutionError(
      "INVALID_QUOTE",
      parsed.reason
    );
  }

  const quote = parsed.quote;
  const policy = evaluateExecutionQuote(
    quote,
    request.order.symbol,
    request.policy
  );
  if (!policy.executable) {
    throw new PaperExecutionError(
      "NON_EXECUTABLE_QUOTE",
      policy.reason ?? "Quote cannot be used for execution"
    );
  }

  const plan = createExecutionPlanFromValidatedQuote(
    request,
    quote
  );
  const existingPosition = request.account.positions.find(
    (position) =>
      sameSymbol(position.symbol, request.order.symbol)
  );
  const isBracketExit = request.order.parentOrderId !== undefined;
  if (
    isBracketExit &&
    plan.fillQuantity >
      closableExitQuantity(request.order, existingPosition?.quantity ?? 0)
  ) {
    throw new PaperExecutionError(
      "INVALID_ORDER",
      "Bracket exit fill exceeds the open position it protects"
    );
  }
  const reconciliation = reconcilePosition({
    existingQuantity: existingPosition?.quantity ?? 0,
    existingAveragePrice:
      existingPosition?.averagePrice ?? 0,
    side: request.order.side,
    fillQuantity: plan.fillQuantity,
    fillPrice: plan.fillPrice,
  });
  const fillTime = new Date().toISOString();
  const projectedPositions = projectPositionsAfterFill({
    positions: request.account.positions,
    existingPosition,
    order: request.order,
    reconciliation,
    quote,
    fillTime,
  });
  const projectedMargin = calculateProjectedMarginAfterFill({
    account: request.account,
    symbol: request.order.symbol,
    quote,
    reconciliation,
    fillPrice: plan.fillPrice,
    fees: plan.fees,
    projectedPositions,
    leverage: PAPER_LEVERAGE,
    marks: request.marks,
  });

  // A close or partial close is never refused on margin (a liquidation or a user exit alike):
  // it only releases margin, and refusing it would keep an underwater account more exposed.
  if (!projectedMargin.sufficient && !projectedMargin.reducesExposure) {
    throw new PaperExecutionError(
      "INSUFFICIENT_MARGIN",
      "Execution fill rejected: projected free margin is below zero"
    );
  }

  const fill: PaperFill = {
    id: crypto.randomUUID(),
    orderId: request.order.id,
    symbol: request.order.symbol,
    side: request.order.side,
    quantity: plan.fillQuantity,
    referencePrice: plan.referencePrice,
    fillPrice: plan.fillPrice,
    slippage: plan.slippage,
    fees: plan.fees,
    realisedPnl: reconciliation.realisedPnl,
    quoteSource: quote.source,
    quoteQuality: quote.quality,
    quoteTimestamp: quote.ts,
    exchange: request.exchange ?? quote.exchange,
    reason: request.reason,
    executedAt: fillTime,
  };

  const totalFilled =
    request.order.filledQuantity + plan.fillQuantity;
  const isFullyFilled =
    totalFilled >= request.order.quantity;
  const positionAfter = Math.abs(reconciliation.resultingQuantity);
  // An exit that flattens its position has nothing left to protect: drop its remainder.
  const nextOrderStatus = isFullyFilled
    ? "FILLED"
    : isBracketExit && positionAfter === 0
      ? "CANCELLED"
      : "PARTIALLY_FILLED";
  const existingValue =
    request.order.filledQuantity *
    (request.order.averageFillPrice ?? 0);
  const averageFillPrice =
    (existingValue + plan.fillQuantity * plan.fillPrice) /
    totalFilled;

  const updatedOrder: PaperOrder = {
    ...request.order,
    status: nextOrderStatus,
    filledQuantity: totalFilled,
    averageFillPrice,
    rejectionReason:
      nextOrderStatus === "CANCELLED"
        ? "Position closed"
        : request.order.rejectionReason,
    updatedAt: fillTime,
    quoteSource: quote.source,
    quoteQuality: quote.quality,
    quoteTimestamp: quote.ts,
    referencePrice: quote.price,
  };
  let updatedOrders: PaperOrder[] = request.account.orders.map(
    (order): PaperOrder =>
      order.id === request.order.id ? updatedOrder : order
  );

  if (
    !isBracketExit &&
    (request.order.takeProfitPrice || request.order.stopLossPrice)
  ) {
    updatedOrders = applyEntryFillToBracket(
      updatedOrders,
      request.order,
      plan.fillQuantity,
      fillTime
    );
  }
  if (isBracketExit) {
    updatedOrders = applyExitFillToSiblings(
      updatedOrders,
      request.order,
      plan.fillQuantity,
      positionAfter,
      fillTime
    );
  }

  const updatedAccount: PaperAccount = {
    ...request.account,
    version: 3,
    cash:
      request.account.cash +
      reconciliation.realisedPnl -
      plan.fees,
    realisedPnl:
      request.account.realisedPnl +
      reconciliation.realisedPnl,
    allocatedMargin:
      projectedMargin.allocatedMarginAfter,
    maintenanceMargin:
      projectedMargin.maintenanceMarginAfter,
    positions: projectedPositions,
    orders: updatedOrders,
    fills: [fill, ...request.account.fills].slice(0, 500),
  };

  return {
    account: updatedAccount,
    order: updatedOrder,
    fill,
    charges: plan.charges,
  };
}

export function placePaperOrderInAccount(
  account: PaperAccount,
  rawInput: unknown
): { ok: boolean; message: string; account: PaperAccount } {
  const parsed = PlacePaperOrderSchema.safeParse(rawInput);
  if (!parsed.success) {
    return {
      ok: false,
      message: `Order rejected: ${formatValidationError(parsed.error)}`,
      account,
    };
  }

  const input = parsed.data;
  if (account.status !== "ACTIVE") {
    const reason =
      account.status === "LIQUIDATION_PENDING"
        ? "Account is pending margin liquidation"
        : "Account is liquidated and locked";
    return {
      ok: false,
      message: reason,
      account,
    };
  }

  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();
  const newOrder: PaperOrder = {
    id: orderId,
    symbol: input.symbol,
    side: input.side,
    quantity: input.quantity,
    type: input.type,
    limitPrice:
      input.type === "MARKET"
        ? undefined
        : input.limitPrice,
    stopPrice:
      input.type === "STOP_LOSS_LIMIT"
        ? input.stopPrice
        : undefined,
    status: "PENDING",
    filledQuantity: 0,
    stopLossPrice:
      input.type !== "STOP_LOSS_LIMIT"
        ? input.stopLossPrice
        : undefined,
    takeProfitPrice:
      input.type !== "STOP_LOSS_LIMIT"
        ? input.takeProfitPrice
        : undefined,
    trailingDistance:
      input.type === "MARKET"
        ? input.trailingDistance
        : undefined,
    trailingIsPercent:
      input.type === "MARKET"
        ? input.trailingIsPercent
        : undefined,
    createdAt: now,
    updatedAt: now,
    quoteSource:
      input.type === "MARKET"
        ? input.quote.source
        : undefined,
    quoteQuality:
      input.type === "MARKET"
        ? input.quote.quality
        : undefined,
    quoteTimestamp:
      input.type === "MARKET"
        ? input.quote.ts
        : undefined,
    referencePrice:
      input.type === "MARKET"
        ? input.quote.price
        : undefined,
  };

  const nextAccount: PaperAccount = {
    ...account,
    orders: [newOrder, ...account.orders].slice(0, 200),
  };

  if (input.type !== "MARKET") {
    return {
      ok: true,
      message: `${input.type} paper order queued`,
      account: nextAccount,
    };
  }

  try {
    const fillResult = executePaperFill({
      account: nextAccount,
      order: newOrder,
      fillQuantity: input.quantity,
      quote: input.quote,
      reason: "USER_ORDER",
    });
    return {
      ok: true,
      message: `${input.side} filled at ₹${fillResult.fill.fillPrice.toFixed(2)}`,
      account: fillResult.account,
    };
  } catch (error: unknown) {
    const rejectionReason = getErrorMessage(error);
    const rejectedOrder: PaperOrder = {
      ...newOrder,
      status: "REJECTED",
      rejectionReason,
      updatedAt: now,
    };
    return {
      ok: false,
      message: rejectionReason,
      account: {
        ...nextAccount,
        orders: nextAccount.orders.map((order) =>
          order.id === newOrder.id
            ? rejectedOrder
            : order
        ),
      },
    };
  }
}

function updateOrder(
  account: PaperAccount,
  updatedOrder: PaperOrder
): PaperAccount {
  return {
    ...account,
    orders: account.orders.map((order) =>
      order.id === updatedOrder.id ? updatedOrder : order
    ),
  };
}

export function settlePaperAccount(
  account: PaperAccount,
  quotes: Map<string, ExecutionQuote>
): PaperAccount {
  if (account.status === "LIQUIDATED") return account;

  let next: PaperAccount = {
    ...account,
    positions: [...account.positions],
    orders: [...account.orders],
    fills: [...account.fills],
  };
  let updated = false;
  let totalUnrealised = 0;

  next.positions = next.positions.map(
    (position): PaperPosition => {
      const quote = quotes.get(position.symbol);
      const evaluation = quote
        ? evaluateExecutionQuote(quote, position.symbol)
        : { executable: false };

      if (!evaluation.executable || !quote) {
        totalUnrealised += position.unrealisedPnl;
        return position;
      }

      const unrealisedPnl =
        position.quantity > 0
          ? position.quantity *
            (quote.price - position.averagePrice)
          : Math.abs(position.quantity) *
            (position.averagePrice - quote.price);
      totalUnrealised += unrealisedPnl;
      if (unrealisedPnl !== position.unrealisedPnl) {
        updated = true;
      }
      return {
        ...position,
        unrealisedPnl,
      };
    }
  );

  const equity = next.cash + totalUnrealised;
  if (
    next.status === "ACTIVE" &&
    equity < next.maintenanceMargin &&
    next.positions.length > 0
  ) {
    next.status = "LIQUIDATION_PENDING";
    next.lockReason = "Margin call breach";
    next.lockedAt = new Date().toISOString();
    updated = true;
  }

  if (next.status === "LIQUIDATION_PENDING") {
    for (const positionSnapshot of [...next.positions]) {
      const position = next.positions.find((candidate) =>
        sameSymbol(candidate.symbol, positionSnapshot.symbol)
      );
      if (!position) continue;

      const quote = quotes.get(position.symbol);
      const evaluation = quote
        ? evaluateExecutionQuote(quote, position.symbol)
        : { executable: false };
      if (!evaluation.executable || !quote) continue;

      const now = new Date().toISOString();
      const liquidationOrder: PaperOrder = {
        id: crypto.randomUUID(),
        symbol: position.symbol,
        side: position.quantity > 0 ? "SELL" : "BUY",
        quantity: Math.abs(position.quantity),
        type: "MARKET",
        status: "PENDING",
        filledQuantity: 0,
        createdAt: now,
        updatedAt: now,
        quoteSource: quote.source,
        quoteQuality: quote.quality,
        quoteTimestamp: quote.ts,
        referencePrice: quote.price,
      };
      next.orders = [
        liquidationOrder,
        ...next.orders,
      ].slice(0, 200);

      try {
        next = executePaperFill({
          account: next,
          order: liquidationOrder,
          fillQuantity: liquidationOrder.quantity,
          quote,
          reason: "MARGIN_LIQUIDATION",
        }).account;
        updated = true;
      } catch (error: unknown) {
        console.error(
          "[settlePaperAccount] Liquidation fill rejected",
          {
            symbol: position.symbol,
            reason: getErrorMessage(error),
          }
        );
      }
    }

    if (next.positions.length === 0) {
      next.status = "LIQUIDATED";
      next.lockReason = "Margin call liquidation completed";
      next.liquidationCompletedAt =
        new Date().toISOString();
      updated = true;
    }

    return updated ? next : account;
  }

  if (next.status !== "ACTIVE") {
    return updated ? next : account;
  }

  for (const orderSnapshot of [...next.orders]) {
    let order =
      next.orders.find(
        (candidate) => candidate.id === orderSnapshot.id
      ) ?? orderSnapshot;
    if (
      order.status !== "PENDING" &&
      order.status !== "TRIGGERED" &&
      order.status !== "PARTIALLY_FILLED"
    ) {
      continue;
    }

    const quote = quotes.get(order.symbol);
    if (!quote) continue;
    const evaluation = evaluateExecutionQuote(
      quote,
      order.symbol
    );
    if (!evaluation.executable) continue;

    let isTriggered =
      order.status === "TRIGGERED" ||
      (order.status === "PARTIALLY_FILLED" &&
        order.triggeredAt !== undefined);
    let reason: PaperExecutionReason = "USER_ORDER";

    if (
      order.trailingDistance &&
      order.trailingDistance > 0 &&
      order.type === "MARKET"
    ) {
      const distance = order.trailingDistance;
      const isPercentage = order.trailingIsPercent === true;
      if (order.side === "SELL") {
        const highWatermark =
          order.trailingHighWatermark === undefined ||
          quote.price > order.trailingHighWatermark
            ? quote.price
            : order.trailingHighWatermark;
        const stopPrice = isPercentage
          ? highWatermark * (1 - distance / 100)
          : highWatermark - distance;
        if (
          highWatermark !== order.trailingHighWatermark ||
          stopPrice !== order.stopPrice
        ) {
          order = {
            ...order,
            trailingHighWatermark: highWatermark,
            stopPrice,
            updatedAt: new Date().toISOString(),
          };
          next = updateOrder(next, order);
          updated = true;
        }
        if (quote.price <= stopPrice) isTriggered = true;
      } else {
        const lowWatermark =
          order.trailingLowWatermark === undefined ||
          quote.price < order.trailingLowWatermark
            ? quote.price
            : order.trailingLowWatermark;
        const stopPrice = isPercentage
          ? lowWatermark * (1 + distance / 100)
          : lowWatermark + distance;
        if (
          lowWatermark !== order.trailingLowWatermark ||
          stopPrice !== order.stopPrice
        ) {
          order = {
            ...order,
            trailingLowWatermark: lowWatermark,
            stopPrice,
            updatedAt: new Date().toISOString(),
          };
          next = updateOrder(next, order);
          updated = true;
        }
        if (quote.price >= stopPrice) isTriggered = true;
      }
      if (isTriggered) reason = "TRAILING_STOP";
    }

    const isStopOrder =
      order.type === "STOP_LOSS_LIMIT" || order.type === "STOP_LOSS_MARKET";
    if (isStopOrder && order.status === "PENDING") {
      const stopPrice = order.stopPrice;
      if (
        stopPrice !== undefined &&
        ((order.side === "BUY" &&
          quote.price >= stopPrice) ||
          (order.side === "SELL" &&
            quote.price <= stopPrice))
      ) {
        isTriggered = true;
        order = {
          ...order,
          status: "TRIGGERED",
          triggeredAt: quote.ts,
          updatedAt: new Date().toISOString(),
        };
        next = updateOrder(next, order);
        updated = true;
      }
    }

    const isMarketable =
      order.type === "MARKET"
        ? !order.trailingDistance || isTriggered
        : order.type === "STOP_LOSS_MARKET"
          ? isTriggered
          : order.type === "LIMIT"
            ? order.limitPrice !== undefined &&
              (order.side === "BUY"
                ? quote.price <= order.limitPrice
                : quote.price >= order.limitPrice)
            : isTriggered &&
              order.limitPrice !== undefined &&
              (order.side === "BUY"
                ? quote.price <= order.limitPrice
                : quote.price >= order.limitPrice);

    if (!isMarketable) continue;

    let fillQuantity =
      order.quantity - order.filledQuantity;
    if (order.type !== "MARKET") {
      if (quote.volume === undefined || quote.volume <= 0) {
        continue;
      }
      const maximumLiquidityFill = Math.floor(
        quote.volume * 0.1
      );
      if (maximumLiquidityFill <= 0) continue;
      fillQuantity = Math.min(
        fillQuantity,
        maximumLiquidityFill
      );
    }
    if (order.parentOrderId !== undefined) {
      const position = next.positions.find((candidate) =>
        sameSymbol(candidate.symbol, order.symbol)
      );
      const closable = closableExitQuantity(order, position?.quantity ?? 0);
      if (closable === 0) {
        next = updateOrder(next, {
          ...order,
          status: "CANCELLED",
          rejectionReason: "Position closed",
          updatedAt: new Date().toISOString(),
        });
        updated = true;
        continue;
      }
      fillQuantity = Math.min(fillQuantity, closable);
    }

    if (fillQuantity <= 0) continue;
    if (isStopOrder) {
      reason = "STOP_TRIGGER";
    }

    try {
      next = executePaperFill({
        account: next,
        order,
        fillQuantity,
        quote,
        reason,
      }).account;
      updated = true;
    } catch (error: unknown) {
      console.error(
        "[settlePaperAccount] Order fill rejected",
        {
          orderId: order.id,
          symbol: order.symbol,
          reason: getErrorMessage(error),
        }
      );
    }
  }

  return updated ? next : account;
}
