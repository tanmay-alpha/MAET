import { evaluateExecutionQuote, ExecutionQuoteSchema, type ExecutionQuote } from "../../types/market";
import { calculateAccountMargins, calculateIncrementalMarginFromReconciliation } from "./margin";
import { reconcilePosition } from "./reconcile-position";
import type {
  PaperAccount,
  PaperExecutionReason,
  PaperFill,
  PaperOrder,
  PaperPosition,
  PlacePaperOrder,
} from "./types";

export function calculateSlippage(price: number, qty: number): number {
  if (price <= 0 || qty <= 0) return 0;
  const orderVal = price * qty;

  let basePct = 0.0005; // 0.05%
  if (orderVal > 1_000_000) basePct = 0.003; // 0.3%
  else if (orderVal > 200_000) basePct = 0.0015; // 0.15%

  const dollarSlippage = price * basePct;
  return Math.round(dollarSlippage * 100) / 100;
}

export interface ExecuteFillInput {
  account: PaperAccount;
  order: PaperOrder;
  fillQuantity: number;
  quote: ExecutionQuote;
  fillPrice: number;
  slippage: number;
  fees: number;
  reason: PaperExecutionReason;
}

export interface ExecuteFillResult {
  account: PaperAccount;
  fill: PaperFill;
}

export function executePaperFill(input: ExecuteFillInput): ExecuteFillResult {
  const parseResult = ExecutionQuoteSchema.safeParse(input.quote);
  if (!parseResult.success) {
    const issue = parseResult.error.issues[0];
    throw new Error(`Execution fill rejected: invalid quote provenance (${issue?.message || "parse error"})`);
  }
  const quote = parseResult.data;

  if (quote.symbol.trim().toUpperCase() !== input.order.symbol.trim().toUpperCase()) {
    throw new Error(`Execution fill rejected: quote symbol ${quote.symbol} does not match order symbol ${input.order.symbol}`);
  }

  // Limit price protection invariants
  let protectedFillPrice = input.fillPrice;
  if (input.order.type === "LIMIT" || input.order.type === "STOP_LOSS_LIMIT") {
    const limitPrice = input.order.limitPrice;
    if (limitPrice !== undefined && limitPrice > 0) {
      if (input.order.side === "BUY") {
        protectedFillPrice = Math.min(limitPrice, input.fillPrice);
        if (protectedFillPrice > limitPrice) {
          throw new Error(`Limit price protection violated: BUY fill price ${protectedFillPrice} > limitPrice ${limitPrice}`);
        }
      } else {
        protectedFillPrice = Math.max(limitPrice, input.fillPrice);
        if (protectedFillPrice < limitPrice) {
          throw new Error(`Limit price protection violated: SELL fill price ${protectedFillPrice} < limitPrice ${limitPrice}`);
        }
      }
    }
  }

  const existingPosition = input.account.positions.find(
    (p) => p.symbol.trim().toUpperCase() === input.order.symbol.trim().toUpperCase()
  );

  const reconcileRes = reconcilePosition({
    existingQuantity: existingPosition ? existingPosition.quantity : 0,
    existingAveragePrice: existingPosition ? existingPosition.averagePrice : 0,
    side: input.order.side,
    fillQuantity: input.fillQuantity,
    fillPrice: protectedFillPrice,
  });

  const incMarginRequired = calculateIncrementalMarginFromReconciliation(reconcileRes, protectedFillPrice, 5);

  let totalUnrealised = 0;
  input.account.positions.forEach((p) => {
    if (p.symbol !== input.order.symbol) totalUnrealised += p.unrealisedPnl;
  });
  const currentEquity = input.account.cash + totalUnrealised;
  const freeMargin = currentEquity - input.account.allocatedMargin;

  if (incMarginRequired > 0 && freeMargin < incMarginRequired) {
    throw new Error(`Execution fill rejected: insufficient free margin for position increase`);
  }

  const fillId = crypto.randomUUID();
  const fillTime = new Date().toISOString();

  const fill: PaperFill = {
    id: fillId,
    orderId: input.order.id,
    symbol: input.order.symbol,
    side: input.order.side,
    quantity: input.fillQuantity,
    referencePrice: quote.price,
    fillPrice: protectedFillPrice,
    slippage: input.slippage,
    fees: input.fees,
    realisedPnl: reconcileRes.realisedPnl,
    quoteSource: quote.source,
    quoteQuality: quote.quality,
    quoteTimestamp: quote.ts,
    exchange: quote.exchange,
    reason: input.reason,
    executedAt: fillTime,
  };

  // Update positions
  let updatedPositions = [...input.account.positions];
  if (reconcileRes.resultingQuantity === 0) {
    updatedPositions = updatedPositions.filter(
      (p) => p.symbol.trim().toUpperCase() !== input.order.symbol.trim().toUpperCase()
    );
  } else {
    const marginLocked = (Math.abs(reconcileRes.resultingQuantity) * reconcileRes.resultingAveragePrice) / 5;
    const newPosObj: PaperPosition = {
      symbol: input.order.symbol,
      quantity: reconcileRes.resultingQuantity,
      averagePrice: reconcileRes.resultingAveragePrice,
      marginLocked,
      unrealisedPnl: 0,
      realisedPnl: (existingPosition?.realisedPnl ?? 0) + reconcileRes.realisedPnl,
      updatedAt: fillTime,
    };

    if (existingPosition) {
      updatedPositions = updatedPositions.map((p) =>
        p.symbol.trim().toUpperCase() === input.order.symbol.trim().toUpperCase() ? newPosObj : p
      );
    } else {
      updatedPositions.push(newPosObj);
    }
  }

  // Update order status and aggregate
  const totalFilled = input.order.filledQuantity + input.fillQuantity;
  const isFullyFilled = totalFilled >= input.order.quantity;
  const nextOrderStatus = isFullyFilled ? ("FILLED" as const) : ("PARTIALLY_FILLED" as const);

  const existingVal = input.order.filledQuantity * (input.order.averageFillPrice ?? 0);
  const newAvgFillPrice = (existingVal + input.fillQuantity * protectedFillPrice) / totalFilled;

  let updatedOrders = input.account.orders.map((o) =>
    o.id === input.order.id
      ? ({
          ...o,
          status: nextOrderStatus,
          filledQuantity: totalFilled,
          averageFillPrice: newAvgFillPrice,
          updatedAt: fillTime,
          quoteSource: quote.source,
          quoteQuality: quote.quality,
          quoteTimestamp: quote.ts,
          referencePrice: quote.price,
        } as PaperOrder)
      : o
  );

  // If child take-profit or stop-loss exists and order just fully filled
  if (isFullyFilled && (input.order.takeProfitPrice || input.order.stopLossPrice)) {
    const childSide = input.order.side === "BUY" ? "SELL" : "BUY";
    if (input.order.takeProfitPrice) {
      updatedOrders.unshift({
        id: crypto.randomUUID(),
        symbol: input.order.symbol,
        side: childSide,
        quantity: input.order.quantity,
        type: "LIMIT",
        limitPrice: input.order.takeProfitPrice,
        status: "PENDING",
        filledQuantity: 0,
        parentOrderId: input.order.id,
        createdAt: fillTime,
        updatedAt: fillTime,
      });
    }
    if (input.order.stopLossPrice) {
      updatedOrders.unshift({
        id: crypto.randomUUID(),
        symbol: input.order.symbol,
        side: childSide,
        quantity: input.order.quantity,
        type: "STOP_LOSS_LIMIT",
        stopPrice: input.order.stopLossPrice,
        limitPrice: input.order.stopLossPrice,
        status: "PENDING",
        filledQuantity: 0,
        parentOrderId: input.order.id,
        createdAt: fillTime,
        updatedAt: fillTime,
      });
    }
  }

  // OCO bracket cancellation if parent filled
  if (isFullyFilled && input.order.parentOrderId) {
    updatedOrders = updatedOrders.map((o) =>
      o.parentOrderId === input.order.parentOrderId &&
      o.id !== input.order.id &&
      (o.status === "PENDING" || o.status === "TRIGGERED" || o.status === "PARTIALLY_FILLED")
        ? ({ ...o, status: "CANCELLED" as const, rejectionReason: "OCO bracket filled", updatedAt: fillTime } as PaperOrder)
        : o
    );
  }

  const nextCash = input.account.cash + reconcileRes.realisedPnl - input.fees;
  const nextRealisedPnl = input.account.realisedPnl + reconcileRes.realisedPnl;
  const { allocatedMargin, maintenanceMargin } = calculateAccountMargins(updatedPositions, 5);

  const updatedAccount: PaperAccount = {
    ...input.account,
    version: 3,
    cash: nextCash,
    realisedPnl: nextRealisedPnl,
    allocatedMargin,
    maintenanceMargin,
    positions: updatedPositions,
    orders: updatedOrders,
    fills: [fill, ...input.account.fills].slice(0, 500),
  };

  return { account: updatedAccount, fill };
}

export function placePaperOrderInAccount(
  account: PaperAccount,
  input: PlacePaperOrder
): { ok: boolean; message: string; account: PaperAccount } {
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { ok: false, message: "Select a symbol", account };

  if (account.status !== "ACTIVE") {
    const reason =
      account.status === "LIQUIDATION_PENDING"
        ? "Account is pending margin liquidation"
        : "Account is liquidated and locked";
    return { ok: false, message: reason, account };
  }

  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    return { ok: false, message: "Quantity must be a positive whole number", account };
  }

  let executionPrice = 0;
  let quoteSource: any = undefined;
  let quoteQuality: any = undefined;
  let quoteTimestamp: any = undefined;
  let referencePrice: any = undefined;

  if (input.type === "MARKET") {
    const evalQuote = evaluateExecutionQuote(input.quote, symbol);
    if (!evalQuote.executable) {
      return { ok: false, message: `Market order rejected: ${evalQuote.reason}`, account };
    }

    executionPrice = input.quote.price;
    referencePrice = input.quote.price;
    quoteSource = input.quote.source;
    quoteQuality = input.quote.quality;
    quoteTimestamp = input.quote.ts;
  } else if (input.type === "LIMIT") {
    if (input.limitPrice <= 0) {
      return { ok: false, message: "Enter a valid limit price", account };
    }
    executionPrice = input.limitPrice;
    referencePrice = input.limitPrice;
  } else if (input.type === "STOP_LOSS_LIMIT") {
    if (input.stopPrice <= 0 || input.limitPrice <= 0) {
      return { ok: false, message: "Enter valid stop and limit prices", account };
    }
    executionPrice = input.limitPrice;
    referencePrice = input.limitPrice;
  }

  // Margin validation for initial placement
  const existingPosition = account.positions.find((p) => p.symbol.trim().toUpperCase() === symbol);
  const reconPre = reconcilePosition({
    existingQuantity: existingPosition ? existingPosition.quantity : 0,
    existingAveragePrice: existingPosition ? existingPosition.averagePrice : 0,
    side: input.side,
    fillQuantity: input.quantity,
    fillPrice: executionPrice,
  });

  const incMargin = calculateIncrementalMarginFromReconciliation(reconPre, executionPrice, 5);

  let totalUnrealised = 0;
  account.positions.forEach((p) => (totalUnrealised += p.unrealisedPnl));
  const equity = account.cash + totalUnrealised;
  const freeMargin = equity - account.allocatedMargin;

  if (incMargin > 0 && freeMargin < incMargin) {
    return { ok: false, message: "Insufficient free margin for 5x leverage", account };
  }

  const orderId = crypto.randomUUID();
  const now = new Date().toISOString();

  const newOrder: PaperOrder = {
    id: orderId,
    symbol,
    side: input.side,
    quantity: input.quantity,
    type: input.type,
    limitPrice: input.type === "MARKET" ? undefined : input.limitPrice,
    stopPrice: input.type === "STOP_LOSS_LIMIT" ? input.stopPrice : undefined,
    status: "PENDING",
    filledQuantity: 0,
    stopLossPrice: input.type !== "STOP_LOSS_LIMIT" ? (input as { stopLossPrice?: number }).stopLossPrice : undefined,
    takeProfitPrice: input.type !== "STOP_LOSS_LIMIT" ? (input as { takeProfitPrice?: number }).takeProfitPrice : undefined,
    trailingDistance: input.type === "MARKET" ? input.trailingDistance : undefined,
    trailingIsPercent: input.type === "MARKET" ? input.trailingIsPercent : undefined,
    createdAt: now,
    updatedAt: now,
    quoteSource,
    quoteQuality,
    quoteTimestamp,
    referencePrice,
  };

  const updatedOrders = [newOrder, ...account.orders].slice(0, 200);
  let nextAccount: PaperAccount = { ...account, orders: updatedOrders };

  if (input.type === "MARKET") {
    const slippage = calculateSlippage(executionPrice, input.quantity);
    const fillPrice = input.side === "BUY" ? executionPrice + slippage : Math.max(0.05, executionPrice - slippage);
    const fees = fillPrice * input.quantity * 0.0000345;

    try {
      const fillRes = executePaperFill({
        account: nextAccount,
        order: newOrder,
        fillQuantity: input.quantity,
        quote: input.quote,
        fillPrice,
        slippage,
        fees,
        reason: "USER_ORDER",
      });
      return { ok: true, message: `${input.side} filled at ₹${fillPrice.toFixed(2)}`, account: fillRes.account };
    } catch (err: any) {
      const rejectedOrder: PaperOrder = {
        ...newOrder,
        status: "REJECTED",
        rejectionReason: err?.message || "Order rejected",
        updatedAt: now,
      };
      const rejectedOrders = nextAccount.orders.map((o) => (o.id === newOrder.id ? rejectedOrder : o));
      return { ok: false, message: err?.message || "Order rejected", account: { ...nextAccount, orders: rejectedOrders } };
    }
  }

  return { ok: true, message: `${input.type} paper order queued`, account: nextAccount };
}

export function settlePaperAccount(
  account: PaperAccount,
  quotes: Map<string, ExecutionQuote>
): PaperAccount {
  if (account.status === "LIQUIDATED") return account;

  let next = { ...account };
  let updated = false;

  // 1. Update Unrealised PnL on positions using validated quotes
  let totalUnrealised = 0;
  next.positions = next.positions.map((pos) => {
    const quote = quotes.get(pos.symbol);
    const evalResult = quote ? evaluateExecutionQuote(quote, pos.symbol) : { executable: false };

    if (!evalResult.executable || !quote) {
      totalUnrealised += pos.unrealisedPnl;
      return pos;
    }

    const ltp = quote.price;
    const unrealised =
      pos.quantity > 0
        ? pos.quantity * (ltp - pos.averagePrice)
        : Math.abs(pos.quantity) * (pos.averagePrice - ltp);

    totalUnrealised += unrealised;
    if (unrealised !== pos.unrealisedPnl) updated = true;
    return { ...pos, unrealisedPnl: unrealised };
  });

  const equity = next.cash + totalUnrealised;

  // 2. Liquidation State Machine Check
  if (next.status === "ACTIVE") {
    if (equity < next.maintenanceMargin && next.positions.length > 0) {
      next.status = "LIQUIDATION_PENDING";
      next.lockReason = "Margin call breach";
      next.lockedAt = new Date().toISOString();
      updated = true;
    }
  }

  if (next.status === "LIQUIDATION_PENDING") {
    for (const pos of next.positions) {
      const posQuote = quotes.get(pos.symbol);
      const evalPosQ = posQuote ? evaluateExecutionQuote(posQuote, pos.symbol) : { executable: false };

      if (evalPosQ.executable && posQuote) {
        const fillPrice = posQuote.price;
        const qty = Math.abs(pos.quantity);
        const slippage = calculateSlippage(fillPrice, qty);
        const effectiveFill = pos.quantity > 0 ? Math.max(0.05, fillPrice - slippage) : fillPrice + slippage;
        const fees = effectiveFill * qty * 0.0000345;
        const now = new Date().toISOString();

        const liquidationOrder: PaperOrder = {
          id: crypto.randomUUID(),
          symbol: pos.symbol,
          side: pos.quantity > 0 ? "SELL" : "BUY",
          quantity: qty,
          type: "MARKET",
          status: "PENDING",
          filledQuantity: 0,
          createdAt: now,
          updatedAt: now,
          quoteSource: posQuote.source,
          quoteQuality: posQuote.quality,
          quoteTimestamp: posQuote.ts,
          referencePrice: posQuote.price,
        };

        next.orders = [liquidationOrder, ...next.orders].slice(0, 200);

        try {
          const fillRes = executePaperFill({
            account: next,
            order: liquidationOrder,
            fillQuantity: qty,
            quote: posQuote,
            fillPrice: effectiveFill,
            slippage,
            fees,
            reason: "MARGIN_LIQUIDATION",
          });
          next = fillRes.account;
          updated = true;
        } catch (err) {
          console.error(`[settlePaperAccount] Liquidation fill failed for ${pos.symbol}:`, err);
        }
      }
    }

    if (next.positions.length === 0) {
      next.status = "LIQUIDATED";
      next.lockReason = "Margin call liquidation completed";
      next.liquidationCompletedAt = new Date().toISOString();
      updated = true;
    }

    return next;
  }

  // 3. Match pending/triggered orders (ACTIVE accounts only)
  if (next.status !== "ACTIVE") return updated ? next : account;

  for (let i = 0; i < next.orders.length; i++) {
    const order = next.orders[i];
    if (order.status !== "PENDING" && order.status !== "TRIGGERED" && order.status !== "PARTIALLY_FILLED") continue;

    const quote = quotes.get(order.symbol);
    if (!quote) continue;

    const evalQuote = evaluateExecutionQuote(quote, order.symbol);
    if (!evalQuote.executable) continue;

    const ltp = quote.price;
    const ask = quote.price;
    const bid = quote.price;
    const volume = quote.volume;

    let isTriggered = order.status === "TRIGGERED";
    let isMatched = false;
    let fillPrice = 0;
    let slippage = 0;

    // Trailing stop high/low watermark updates
    if (order.trailingDistance && order.trailingDistance > 0 && order.type === "MARKET") {
      const dist = order.trailingDistance;
      const isPercent = !!order.trailingIsPercent;

      if (order.side === "SELL") {
        let hwm = order.trailingHighWatermark ?? null;
        if (hwm === null || hwm === 0 || ltp > hwm) {
          hwm = ltp;
          const stopPrice = isPercent ? hwm * (1 - dist / 100) : hwm - dist;
          order.trailingHighWatermark = hwm;
          order.stopPrice = stopPrice;
          updated = true;
        }
        if (ltp <= (order.stopPrice ?? 0)) isTriggered = true;
      } else {
        let lwm = order.trailingLowWatermark ?? null;
        if (lwm === null || lwm === 0 || ltp < lwm) {
          lwm = ltp;
          const stopPrice = isPercent ? lwm * (1 + dist / 100) : lwm + dist;
          order.trailingLowWatermark = lwm;
          order.stopPrice = stopPrice;
          updated = true;
        }
        if (ltp >= (order.stopPrice ?? 0)) isTriggered = true;
      }
    }

    // STOP_LOSS_LIMIT trigger evaluation (Never converts to MARKET!)
    if (order.type === "STOP_LOSS_LIMIT" && order.status === "PENDING") {
      if (order.stopPrice && order.stopPrice > 0) {
        if (order.side === "BUY" && ltp >= order.stopPrice) {
          isTriggered = true;
        } else if (order.side === "SELL" && ltp <= order.stopPrice) {
          isTriggered = true;
        }
      }

      if (isTriggered) {
        order.status = "TRIGGERED";
        order.triggeredAt = quote.ts;
        updated = true;
      }
    }

    // Order matching evaluation
    if (order.type === "LIMIT" || (order.type === "STOP_LOSS_LIMIT" && order.status === "TRIGGERED")) {
      const limit = order.limitPrice ?? 0;
      if (limit > 0) {
        if (order.side === "BUY" && ask <= limit) {
          isMatched = true;
          slippage = calculateSlippage(ask, order.quantity);
          const rawPrice = ask + slippage;
          fillPrice = Math.min(limit, rawPrice); // Limit protection invariant: fillPrice <= limitPrice
        } else if (order.side === "SELL" && bid >= limit) {
          isMatched = true;
          slippage = calculateSlippage(bid, order.quantity);
          const rawPrice = Math.max(0.05, bid - slippage);
          fillPrice = Math.max(limit, rawPrice); // Limit protection invariant: fillPrice >= limitPrice
        }
      }
    }

    // Conservative Liquidity Handling for LIMIT & STOP_LOSS_LIMIT
    if (isMatched && (order.type === "LIMIT" || order.type === "STOP_LOSS_LIMIT")) {
      if (!volume || volume <= 0) {
        // Missing or non-positive volume: DEFER fill per conservative liquidity policy
        isMatched = false;
      } else {
        const availableQty = Math.floor(volume * 0.10); // 10% max liquidity fill
        if (availableQty <= 0) {
          isMatched = false;
        }
      }
    }

    if (isMatched) {
      let fillQty = order.quantity - order.filledQuantity;
      if (volume && volume > 0 && (order.type === "LIMIT" || order.type === "STOP_LOSS_LIMIT")) {
        const maxLiquidityFill = Math.floor(volume * 0.10);
        if (maxLiquidityFill > 0 && fillQty > maxLiquidityFill) {
          fillQty = maxLiquidityFill;
        }
      }

      if (fillQty > 0) {
        const fees = fillPrice * fillQty * 0.0000345;
        const reason: PaperExecutionReason =
          order.type === "STOP_LOSS_LIMIT"
            ? "STOP_TRIGGER"
            : order.trailingDistance
            ? "TRAILING_STOP"
            : "USER_ORDER";

        try {
          const fillRes = executePaperFill({
            account: next,
            order,
            fillQuantity: fillQty,
            quote,
            fillPrice,
            slippage,
            fees,
            reason,
          });
          next = fillRes.account;
          updated = true;
        } catch (err) {
          console.error(`[settlePaperAccount] Order fill failed for ${order.id}:`, err);
        }
      }
    }
  }

  return updated ? next : account;
}
