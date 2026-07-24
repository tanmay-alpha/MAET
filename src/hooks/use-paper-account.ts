import { useSyncExternalStore } from "react";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";
import type { MarketQuote } from "@/lib/market-api";

export type PaperOrderType = "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT";
export type PaperOrderStatus = "pending" | "partial" | "filled" | "cancelled" | "rejected";
export type PaperAccountStatus = "ACTIVE" | "LIQUIDATION_PENDING" | "LIQUIDATED";

export type PaperOrder = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  type: PaperOrderType;
  limitPrice?: number;
  stopPrice?: number;
  triggerPrice?: number; // legacy compatibility
  filledQty: number;
  averageFillPrice?: number;
  fillPrice?: number; // legacy compatibility
  slippageApplied: number;
  transactionFee: number;
  status: PaperOrderStatus;
  placedAt: string;
  filledAt?: string;
  rejectReason?: string;
  parentOrderId?: string;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  trailingHwm?: number;
  trailingLwm?: number;
  isTrailingPercent?: boolean;
  quoteSource?: string;
  quoteQuality?: string;
  quoteTimestamp?: string;
  referencePrice?: number;
};

export type PaperPosition = {
  symbol: string;
  qty: number; // positive for Long, negative for Short
  avgPrice: number;
  marginLocked: number;
  unrealizedPnl: number;
  realizedPnl: number;
  updatedAt: string;
};

export type PaperAccount = {
  initialCash: number;
  cash: number;
  realizedPnl: number; // legacy compatibility
  allocatedMargin: number;
  maintenanceMargin: number;
  status: PaperAccountStatus;
  isLocked: boolean; // legacy compatibility (status !== "ACTIVE")
  lockReason?: string;
  lockedAt?: string;
  positions: PaperPosition[];
  orders: PaperOrder[];
};

export type PlacePaperMarketOrder = {
  type: "MARKET";
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  quote: ExecutionQuote;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  isTrailingPercent?: boolean;
};

export type PlacePaperLimitOrder = {
  type: "LIMIT";
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  limitPrice: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  isTrailingPercent?: boolean;
};

export type PlacePaperStopOrder = {
  type: "STOP_LOSS_LIMIT";
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  stopPrice: number;
  limitPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  isTrailingPercent?: boolean;
};

export type PlacePaperOrder =
  | PlacePaperMarketOrder
  | PlacePaperLimitOrder
  | PlacePaperStopOrder;

const STORAGE_KEY = "maet.paper-account.v2";
const INITIAL_CASH = 1_000_000;
const LEVERAGE = 5;

const EMPTY_ACCOUNT: PaperAccount = {
  initialCash: INITIAL_CASH,
  cash: INITIAL_CASH,
  realizedPnl: 0,
  allocatedMargin: 0,
  maintenanceMargin: 0,
  status: "ACTIVE",
  isLocked: false,
  positions: [],
  orders: [],
};

let account: PaperAccount = EMPTY_ACCOUNT;
let loaded = false;
const listeners = new Set<() => void>();

export function calculateIncrementalMargin(
  positions: PaperPosition[],
  symbol: string,
  side: "BUY" | "SELL",
  qty: number,
  price: number,
  leverage: number = LEVERAGE
): number {
  const normSymbol = symbol.trim().toUpperCase();
  const position = positions.find((p) => p.symbol.trim().toUpperCase() === normSymbol);
  const oldQty = position ? position.qty : 0;
  const tradeSignedQty = side === "BUY" ? qty : -qty;
  const newQty = oldQty + tradeSignedQty;

  const oldAbs = Math.abs(oldQty);
  const newAbs = Math.abs(newQty);

  if (oldQty === 0) {
    return (newAbs * price) / leverage;
  } else if (Math.sign(newQty) === Math.sign(oldQty) || newQty === 0) {
    if (newAbs <= oldAbs) {
      return 0;
    } else {
      const addedQty = newAbs - oldAbs;
      return (addedQty * price) / leverage;
    }
  } else {
    return (newAbs * price) / leverage;
  }
}

function loadAccount(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return;
    }
    const parsed = JSON.parse(raw) as Partial<PaperAccount>;
    if (typeof parsed.cash === "number" && Array.isArray(parsed.positions)) {
      account = {
        initialCash: parsed.initialCash ?? INITIAL_CASH,
        cash: parsed.cash,
        realizedPnl: parsed.realizedPnl ?? 0,
        allocatedMargin: parsed.allocatedMargin ?? 0,
        maintenanceMargin: parsed.maintenanceMargin ?? 0,
        status: parsed.status ?? (parsed.isLocked ? "LIQUIDATED" : "ACTIVE"),
        isLocked: parsed.status ? parsed.status !== "ACTIVE" : !!parsed.isLocked,
        lockReason: parsed.lockReason,
        lockedAt: parsed.lockedAt,
        positions: parsed.positions.map((p: any) => ({
          symbol: p.symbol,
          qty: p.qty,
          avgPrice: p.avgPrice,
          marginLocked: p.marginLocked ?? (Math.abs(p.qty) * p.avgPrice) / LEVERAGE,
          unrealizedPnl: p.unrealizedPnl ?? 0,
          realizedPnl: p.realizedPnl ?? 0,
          updatedAt: p.updatedAt ?? new Date().toISOString(),
        })),
        orders: Array.isArray(parsed.orders) ? parsed.orders : [],
      };
      recalculateMargins();
    }
  } catch (err) {
    console.error("[usePaperAccount] Failed to load account state", err);
  }
}

function commit(next: PaperAccount): void {
  const normStatus = next.status ?? "ACTIVE";
  account = {
    ...next,
    status: normStatus,
    isLocked: normStatus !== "ACTIVE",
  };
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    } catch (err) {
      console.error("[usePaperAccount] Failed to persist account state", err);
    }
  }
  listeners.forEach((fn) => fn());
}

function recalculateMargins(): void {
  let totalMargin = 0;
  account.positions.forEach((pos) => {
    totalMargin += (Math.abs(pos.qty) * pos.avgPrice) / LEVERAGE;
  });
  account.allocatedMargin = totalMargin;
  account.maintenanceMargin = totalMargin * 0.8;
}

export function placePaperOrder(input: PlacePaperOrder): { ok: boolean; message: string } {
  loadAccount();
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { ok: false, message: "Select a symbol" };

  if (account.status !== "ACTIVE") {
    const reason = account.status === "LIQUIDATION_PENDING"
      ? "Account is pending margin liquidation"
      : "Account is liquidated and locked";
    return { ok: false, message: reason };
  }

  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, message: "Quantity must be a positive whole number" };
  }

  let executionPrice = 0;
  let quoteSource = "unknown";
  let quoteQuality = "unknown";
  let quoteTimestamp = new Date().toISOString();
  let referencePrice = 0;

  if (input.type === "MARKET") {
    if (!input.quote) {
      return { ok: false, message: "Trusted quote object is required for execution" };
    }

    const quoteEval = evaluateExecutionQuote(input.quote, symbol);
    if (!quoteEval.executable) {
      return { ok: false, message: `Market order rejected: ${quoteEval.reason}` };
    }

    executionPrice = input.quote.price;
    referencePrice = input.quote.price;
    quoteSource = input.quote.source;
    quoteQuality = input.quote.quality;
    quoteTimestamp = input.quote.ts;
  } else if (input.type === "LIMIT") {
    if (input.limitPrice <= 0) {
      return { ok: false, message: "Enter a valid order price" };
    }
    executionPrice = input.limitPrice;
    referencePrice = input.limitPrice;
  } else if (input.type === "STOP_LOSS_LIMIT") {
    if (input.stopPrice <= 0) {
      return { ok: false, message: "Enter a valid order price" };
    }
    executionPrice = input.stopPrice;
    referencePrice = input.stopPrice;
  }

  // Incremental margin check
  let totalUnrealized = 0;
  account.positions.forEach((p) => (totalUnrealized += p.unrealizedPnl));
  const equity = account.cash + totalUnrealized;
  const freeMargin = equity - account.allocatedMargin;

  const incMarginRequired = calculateIncrementalMargin(
    account.positions,
    symbol,
    input.side,
    input.qty,
    executionPrice
  );

  if (incMarginRequired > 0 && freeMargin < incMarginRequired) {
    return { ok: false, message: "Insufficient free margin for 5x leverage" };
  }

  const orderId = crypto.randomUUID();
  const limitPriceVal = input.type === "LIMIT" ? input.limitPrice : undefined;
  const stopPriceVal = input.type === "STOP_LOSS_LIMIT" ? input.stopPrice : undefined;

  const newOrder: PaperOrder = {
    id: orderId,
    symbol,
    side: input.side,
    qty: input.qty,
    type: input.type,
    limitPrice: limitPriceVal,
    stopPrice: stopPriceVal,
    triggerPrice: stopPriceVal,
    filledQty: 0,
    slippageApplied: 0,
    transactionFee: 0,
    status: "pending",
    placedAt: new Date().toISOString(),
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    trailingDistance: input.trailingDistance,
    isTrailingPercent: input.isTrailingPercent,
    quoteSource,
    quoteQuality,
    quoteTimestamp,
    referencePrice,
  };

  const updatedOrders = [newOrder, ...account.orders].slice(0, 200);
  const nextAccount = { ...account, orders: updatedOrders };

  if (input.type === "MARKET") {
    const currentPrice = executionPrice;
    const slippage = calculateSlippage(currentPrice, input.qty);
    const fillPrice = input.side === "BUY" ? currentPrice + slippage : Math.max(0.05, currentPrice - slippage);

    const filled = simulateFill(nextAccount, newOrder, fillPrice, slippage, input.qty);
    if (filled.orders[0]?.status === "rejected") {
      return { ok: false, message: filled.orders[0].rejectReason || "Order rejected" };
    }
    commit(filled);
    return { ok: true, message: `${input.side} filled at ₹${fillPrice.toFixed(2)}` };
  }

  commit(nextAccount);
  return { ok: true, message: `${input.type} paper order queued` };
}

function simulateFill(
  curr: PaperAccount,
  order: PaperOrder,
  fillPrice: number,
  slippage: number,
  fillQty: number
): PaperAccount {
  const position = curr.positions.find((item) => item.symbol === order.symbol);
  const fee = fillPrice * fillQty * 0.0000345;

  let totalUnrealized = 0;
  curr.positions.forEach((p) => {
    if (p.symbol !== order.symbol) totalUnrealized += p.unrealizedPnl;
  });

  const equity = curr.cash + totalUnrealized;
  const freeMargin = equity - curr.allocatedMargin;
  const incMarginRequired = calculateIncrementalMargin(
    curr.positions,
    order.symbol,
    order.side,
    fillQty,
    fillPrice
  );

  if (incMarginRequired > 0 && freeMargin < incMarginRequired) {
    const rejectedOrder = {
      ...order,
      status: "rejected" as const,
      rejectReason: "Insufficient margin at fill trigger",
    };
    return {
      ...curr,
      orders: curr.orders.map((o) => (o.id === order.id ? rejectedOrder : o)),
    };
  }

  let positions = [...curr.positions];
  let realizedPnl = 0;
  let newShares = 0;
  let newAvgPrice = 0;

  const oldShares = position?.qty ?? 0;
  const oldAvgPrice = position?.avgPrice ?? 0;

  if (order.side === "BUY") {
    newShares = oldShares + fillQty;
  } else {
    newShares = oldShares - fillQty;
  }

  if (oldShares === 0) {
    newAvgPrice = fillPrice;
  } else if (Math.sign(oldShares) === Math.sign(newShares)) {
    newAvgPrice = (Math.abs(oldShares) * oldAvgPrice + fillQty * fillPrice) / Math.abs(newShares);
  } else {
    const closedQty = Math.min(fillQty, Math.abs(oldShares));
    const direction = Math.sign(oldShares);
    realizedPnl = direction > 0 ? closedQty * (fillPrice - oldAvgPrice) : closedQty * (oldAvgPrice - fillPrice);

    const remainder = fillQty - closedQty;
    if (remainder > 0) {
      newShares = direction > 0 ? -remainder : remainder;
      newAvgPrice = fillPrice;
    } else {
      newAvgPrice = oldAvgPrice;
    }
  }

  if (newShares === 0) {
    positions = positions.filter((item) => item.symbol !== order.symbol);
  } else {
    const marginLocked = (Math.abs(newShares) * newAvgPrice) / LEVERAGE;
    const posObj: PaperPosition = {
      symbol: order.symbol,
      qty: newShares,
      avgPrice: newAvgPrice,
      marginLocked,
      unrealizedPnl: 0,
      realizedPnl: (position?.realizedPnl ?? 0) + realizedPnl,
      updatedAt: new Date().toISOString(),
    };

    if (position) {
      positions = positions.map((item) => (item.symbol === order.symbol ? posObj : item));
    } else {
      positions.push(posObj);
    }
  }

  const totalFilled = order.filledQty + fillQty;
  const isFullyFilled = totalFilled === order.qty;
  const nextStatus = isFullyFilled ? "filled" : "partial";
  const accumulatedFee = order.transactionFee + fee;

  const existingFillVal = order.filledQty * (order.averageFillPrice ?? 0);
  const newAvgFillPrice = (existingFillVal + fillQty * fillPrice) / totalFilled;

  let orders = curr.orders.map((item) =>
    item.id === order.id
      ? ({
          ...item,
          status: nextStatus,
          filledQty: totalFilled,
          averageFillPrice: newAvgFillPrice,
          fillPrice: newAvgFillPrice,
          slippageApplied: slippage,
          transactionFee: accumulatedFee,
          filledAt: isFullyFilled ? new Date().toISOString() : undefined,
        } as PaperOrder)
      : item
  );

  if (isFullyFilled && (order.takeProfitPrice || order.stopLossPrice)) {
    const childSide = order.side === "BUY" ? "SELL" : "BUY";
    if (order.takeProfitPrice) {
      orders.unshift({
        id: crypto.randomUUID(),
        symbol: order.symbol,
        side: childSide,
        qty: order.qty,
        type: "LIMIT",
        limitPrice: order.takeProfitPrice,
        filledQty: 0,
        slippageApplied: 0,
        transactionFee: 0,
        status: "pending",
        parentOrderId: order.id,
        placedAt: new Date().toISOString(),
      });
    }
    if (order.stopLossPrice) {
      orders.unshift({
        id: crypto.randomUUID(),
        symbol: order.symbol,
        side: childSide,
        qty: order.qty,
        type: "STOP_LOSS_LIMIT",
        stopPrice: order.stopLossPrice,
        limitPrice: order.stopLossPrice,
        triggerPrice: order.stopLossPrice,
        filledQty: 0,
        slippageApplied: 0,
        transactionFee: 0,
        status: "pending",
        parentOrderId: order.id,
        placedAt: new Date().toISOString(),
      });
    }
  }

  if (isFullyFilled && order.parentOrderId) {
    orders = orders.map((o) =>
      o.parentOrderId === order.parentOrderId && o.id !== order.id && (o.status === "pending" || o.status === "partial")
        ? ({ ...o, status: "cancelled", rejectReason: "OCO bracket filled" } as PaperOrder)
        : o
    );
  }

  const nextCash = curr.cash + realizedPnl - fee;
  const resultAcc = {
    ...curr,
    cash: nextCash,
    realizedPnl: curr.realizedPnl + realizedPnl,
    positions,
    orders,
  };

  let totalMargin = 0;
  positions.forEach((pos) => {
    totalMargin += pos.marginLocked;
  });
  resultAcc.allocatedMargin = totalMargin;
  resultAcc.maintenanceMargin = totalMargin * 0.8;

  return resultAcc;
}

export function cancelPaperOrder(orderId: string): void {
  loadAccount();
  const nextOrders = account.orders.map((o) =>
    o.id === orderId && (o.status === "pending" || o.status === "partial")
      ? { ...o, status: "cancelled" as const, updatedAt: new Date().toISOString() }
      : o
  );
  commit({ ...account, orders: nextOrders });
}

export function settlePaperOrders(quotes: Map<string, MarketQuote>): void {
  loadAccount();
  if (account.status === "LIQUIDATED") return;

  let next = { ...account };
  let updated = false;

  // 1. Recalculate Unrealized PnL on positions
  let totalUnrealized = 0;
  next.positions = next.positions.map((pos) => {
    const quote = quotes.get(pos.symbol);
    const evalResult = quote ? evaluateExecutionQuote(quote, pos.symbol) : { executable: false };
    if (!evalResult.executable || !quote) {
      totalUnrealized += pos.unrealizedPnl;
      return pos;
    }
    const ltp = quote.price;
    const unrealized = pos.qty > 0 ? pos.qty * (ltp - pos.avgPrice) : Math.abs(pos.qty) * (pos.avgPrice - ltp);
    totalUnrealized += unrealized;
    if (unrealized !== pos.unrealizedPnl) updated = true;
    return { ...pos, unrealizedPnl: unrealized };
  });

  const equity = next.cash + totalUnrealized;

  // 2. Liquidation State Machine Check
  if (next.status === "ACTIVE") {
    if (equity < next.maintenanceMargin && next.positions.length > 0) {
      next.status = "LIQUIDATION_PENDING";
      next.isLocked = true;
      next.lockReason = "Margin call breach";
      next.lockedAt = new Date().toISOString();
      updated = true;
    }
  }

  if (next.status === "LIQUIDATION_PENDING") {
    let remainingPositions: PaperPosition[] = [];

    for (const pos of next.positions) {
      const posQuote = quotes.get(pos.symbol);
      const evalPosQ = posQuote ? evaluateExecutionQuote(posQuote, pos.symbol) : { executable: false };

      if (evalPosQ.executable && posQuote) {
        const fillPrice = posQuote.price;
        const qty = Math.abs(pos.qty);
        const slippage = calculateSlippage(fillPrice, qty);
        const effectiveFill = pos.qty > 0 ? Math.max(0.05, fillPrice - slippage) : fillPrice + slippage;

        const dummyOrder: PaperOrder = {
          id: crypto.randomUUID(),
          symbol: pos.symbol,
          side: pos.qty > 0 ? "SELL" : "BUY",
          qty,
          type: "MARKET",
          filledQty: 0,
          slippageApplied: 0,
          transactionFee: 0,
          status: "pending",
          placedAt: new Date().toISOString(),
          quoteSource: (posQuote as any).source ?? "angelone",
          quoteQuality: (posQuote as any).quality ?? "live",
          quoteTimestamp: posQuote.timestamp ?? new Date().toISOString(),
          referencePrice: posQuote.price,
        };

        next = simulateFill(next, dummyOrder, effectiveFill, slippage, qty);
        updated = true;
      } else {
        remainingPositions.push(pos);
      }
    }

    if (next.positions.length === 0) {
      next.status = "LIQUIDATED";
      next.isLocked = true;
      next.lockReason = "Margin call liquidation completed";
      updated = true;
    }

    commit(next);
    return;
  }

  // 3. Match pending/trigger orders (Only ACTIVE accounts)
  if (next.status !== "ACTIVE") return;

  for (let i = 0; i < next.orders.length; i++) {
    const order = next.orders[i];
    if (order.status !== "pending" && order.status !== "partial") continue;

    const quote = quotes.get(order.symbol);
    if (!quote) continue;

    const evalQuote = evaluateExecutionQuote(quote, order.symbol);
    if (!evalQuote.executable) continue;

    const ltp = quote.price;
    const bid = quote.price;
    const ask = quote.price;
    const volume = quote.volume;

    let isTriggered = false;
    let isMatched = false;
    let fillPrice = 0;
    let slippage = 0;

    let trailingStopTriggered = false;
    if (order.trailingDistance && order.trailingDistance > 0) {
      const dist = order.trailingDistance;
      const isPercent = !!order.isTrailingPercent;

      if (order.side === "SELL") {
        let hwm = order.trailingHwm ?? null;
        if (hwm === null || hwm === 0 || ltp > hwm) {
          hwm = ltp;
          const stopPrice = isPercent ? hwm * (1 - dist / 100) : hwm - dist;
          order.trailingHwm = hwm;
          order.stopPrice = stopPrice;
          order.triggerPrice = stopPrice;
          updated = true;
        }
        if (ltp <= (order.stopPrice ?? 0)) trailingStopTriggered = true;
      } else {
        let lwm = order.trailingLwm ?? null;
        if (lwm === null || lwm === 0 || ltp < lwm) {
          lwm = ltp;
          const stopPrice = isPercent ? lwm * (1 + dist / 100) : lwm + dist;
          order.trailingLwm = lwm;
          order.stopPrice = stopPrice;
          order.triggerPrice = stopPrice;
          updated = true;
        }
        if (ltp >= (order.stopPrice ?? 0)) trailingStopTriggered = true;
      }
    }

    if (trailingStopTriggered) {
      order.status = "pending";
      order.type = "MARKET";
      isTriggered = true;
      updated = true;
    }

    if (order.status === "pending" && order.type === "STOP_LOSS_LIMIT" && !trailingStopTriggered) {
      if (order.stopPrice) {
        if (order.side === "BUY" && ltp >= order.stopPrice) isTriggered = true;
        else if (order.side === "SELL" && ltp <= order.stopPrice) isTriggered = true;
      }

      if (isTriggered) {
        const isGap = order.side === "BUY" ? ltp > (order.stopPrice ?? 0) : ltp < (order.stopPrice ?? 0);
        order.type = isGap ? "MARKET" : "LIMIT";
        updated = true;
      }
    }

    if (order.status === "pending" || order.status === "partial") {
      if (order.type === "MARKET") {
        isMatched = true;
        slippage = calculateSlippage(ltp, order.qty);
        fillPrice = order.side === "BUY" ? ask + slippage : Math.max(0.05, bid - slippage);
      } else if (order.type === "LIMIT") {
        const limit = order.limitPrice ?? 0;
        if (order.side === "BUY" && ask <= limit) {
          isMatched = true;
          slippage = calculateSlippage(ask, order.qty);
          fillPrice = ask + slippage;
        } else if (order.side === "SELL" && bid >= limit) {
          isMatched = true;
          slippage = calculateSlippage(bid, order.qty);
          fillPrice = Math.max(0.05, bid - slippage);
        }
      }
    }

    if (isMatched) {
      let fillQty = order.qty - order.filledQty;
      if (volume && volume > 0) {
        const maxLiquidityFill = Math.floor(volume * 0.1);
        if (maxLiquidityFill > 0 && fillQty > maxLiquidityFill) {
          fillQty = maxLiquidityFill;
        }
      }

      if (fillQty > 0) {
        order.quoteSource = (quote as any).source ?? "angelone";
        order.quoteQuality = (quote as any).quality ?? "live";
        order.quoteTimestamp = quote.timestamp;
        order.referencePrice = quote.price;

        next = simulateFill(next, order, fillPrice, slippage, fillQty);
        updated = true;
      }
    }
  }

  if (updated) {
    commit(next);
  }
}

export function calculateSlippage(price: number, qty: number): number {
  if (price <= 0 || qty <= 0) return 0;
  const orderVal = price * qty;

  let basePct = 0.0005; // 0.05%
  if (orderVal > 1_000_000) basePct = 0.003; // 0.3%
  else if (orderVal > 200_000) basePct = 0.0015; // 0.15%

  const dollarSlippage = price * basePct;
  return Math.round(dollarSlippage * 100) / 100;
}

export function usePaperAccount() {
  const acc = useSyncExternalStore(
    (callback) => {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    () => {
      loadAccount();
      return account;
    },
    () => EMPTY_ACCOUNT
  );

  return {
    account: acc,
    placeOrder: placePaperOrder,
    cancelOrder: cancelPaperOrder,
    reset: resetPaperAccount,
  };
}

export function getPaperAccount(): PaperAccount {
  loadAccount();
  return { ...account };
}

export function resetPaperAccount(): void {
  commit({
    initialCash: INITIAL_CASH,
    cash: INITIAL_CASH,
    realizedPnl: 0,
    allocatedMargin: 0,
    maintenanceMargin: 0,
    status: "ACTIVE",
    isLocked: false,
    positions: [],
    orders: [],
  });
}
