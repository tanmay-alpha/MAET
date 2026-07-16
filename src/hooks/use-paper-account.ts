import { useSyncExternalStore } from "react";
import type { MarketQuote } from "@/lib/market-api";

export type PaperOrderType = "MARKET" | "LIMIT" | "STOP_LOSS_LIMIT";
export type PaperOrderStatus = "pending" | "partial" | "filled" | "cancelled" | "rejected";

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
  isLocked: boolean;
  positions: PaperPosition[];
  orders: PaperOrder[];
};

export type PlacePaperOrder = {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  type: PaperOrderType;
  limitPrice?: number;
  stopPrice?: number;
  stopLossPrice?: number;
  takeProfitPrice?: number;
  trailingDistance?: number;
  isTrailingPercent?: boolean;
};

const STORAGE_KEY = "maet.paper-account.v2";
const INITIAL_CASH = 1_000_000;
const LEVERAGE = 5;

const EMPTY_ACCOUNT: PaperAccount = {
  initialCash: INITIAL_CASH,
  cash: INITIAL_CASH,
  realizedPnl: 0,
  allocatedMargin: 0,
  maintenanceMargin: 0,
  isLocked: false,
  positions: [],
  orders: [],
};

let account: PaperAccount = EMPTY_ACCOUNT;
let loaded = false;
const listeners = new Set<() => void>();

function loadAccount(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      // Migrate v1 data if exists
      const oldRaw = window.localStorage.getItem("maet.paper-account.v1");
      if (oldRaw) {
        const oldParsed = JSON.parse(oldRaw);
        account = {
          initialCash: INITIAL_CASH,
          cash: Number(oldParsed.cash) || INITIAL_CASH,
          realizedPnl: 0,
          allocatedMargin: 0,
          maintenanceMargin: 0,
          isLocked: false,
          positions: (oldParsed.positions || []).map((p: any) => ({
            symbol: p.symbol,
            qty: p.qty,
            avgPrice: p.avgPrice,
            marginLocked: (Math.abs(p.qty) * p.avgPrice) / LEVERAGE,
            unrealizedPnl: 0,
            realizedPnl: 0,
            updatedAt: new Date().toISOString(),
          })),
          orders: (oldParsed.orders || []).map((o: any) => ({
            id: o.id,
            symbol: o.symbol,
            side: o.side,
            qty: o.qty,
            type: o.type === "STOP" ? "STOP_LOSS_LIMIT" : o.type,
            limitPrice: o.triggerPrice,
            stopPrice: o.triggerPrice,
            triggerPrice: o.triggerPrice,
            filledQty: o.status === "filled" ? o.qty : 0,
            averageFillPrice: o.fillPrice,
            fillPrice: o.fillPrice,
            slippageApplied: 0,
            transactionFee: 0,
            status: o.status === "filled" ? "filled" : o.status === "rejected" ? "rejected" : "pending",
            placedAt: o.placedAt,
            filledAt: o.filledAt,
            rejectReason: o.rejectReason,
            stopLossPrice: o.stopLossPrice,
            takeProfitPrice: o.takeProfitPrice,
            trailingDistance: o.trailingDistance,
            isTrailingPercent: o.isTrailingPercent,
          })),
        };
        recalculateMargins();
        commit(account);
        return;
      }
      return;
    }
    const parsed = JSON.parse(raw) as Partial<PaperAccount>;
    if (
      typeof parsed.cash === "number" &&
      Array.isArray(parsed.positions) &&
      Array.isArray(parsed.orders)
    ) {
      account = parsed as PaperAccount;
    }
  } catch {
    account = EMPTY_ACCOUNT;
  }
}

function getSnapshot(): PaperAccount {
  loadAccount();
  return account;
}

function subscribe(listener: () => void): () => void {
  loadAccount();
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function commit(next: PaperAccount): void {
  account = next;
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  }
  listeners.forEach((listener) => listener());
}

function calculateSlippage(price: number, qty: number): number {
  // Simple slippage formulation (0.05% basis + size scaling)
  const baseSlippage = price * 0.0005;
  const sizeMultiplier = Math.min(2.0, 1.0 + qty / 5000);
  return baseSlippage * sizeMultiplier;
}

function recalculateMargins() {
  let totalMargin = 0;
  account.positions.forEach((pos) => {
    totalMargin += (Math.abs(pos.qty) * pos.avgPrice) / LEVERAGE;
  });
  account.allocatedMargin = totalMargin;
  account.maintenanceMargin = totalMargin * 0.8;
}

function liquidateAll(reason: string) {
  let totalPnL = 0;
  let totalFees = 0;
  const closedOrders: PaperOrder[] = [];

  account.positions.forEach((pos) => {
    const side = pos.qty > 0 ? "SELL" : "BUY";
    const qty = Math.abs(pos.qty);
    const slippage = calculateSlippage(pos.avgPrice, qty);
    const fillPrice = side === "BUY" ? pos.avgPrice + slippage : Math.max(0.05, pos.avgPrice - slippage);
    const fee = fillPrice * qty * 0.0000345;
    const realized = pos.qty > 0 ? qty * (fillPrice - pos.avgPrice) : qty * (pos.avgPrice - fillPrice);

    totalPnL += realized;
    totalFees += fee;

    closedOrders.push({
      id: crypto.randomUUID(),
      symbol: pos.symbol,
      side,
      qty,
      type: "MARKET",
      filledQty: qty,
      averageFillPrice: fillPrice,
      fillPrice: fillPrice,
      slippageApplied: slippage,
      transactionFee: fee,
      status: "filled",
      placedAt: new Date().toISOString(),
      filledAt: new Date().toISOString(),
    });
  });

  // Cancel all pending orders
  const cancelledOrders = account.orders.map((o) =>
    o.status === "pending" || o.status === "partial"
      ? ({ ...o, status: "cancelled", rejectReason: "Account liquidated due to margin call" } as PaperOrder)
      : o
  );

  let newCash = account.cash + totalPnL - totalFees;
  if (newCash < 0) newCash = 0; // Cap realized balance at zero

  commit({
    ...account,
    cash: newCash,
    realizedPnl: account.realizedPnl + totalPnL,
    allocatedMargin: 0,
    maintenanceMargin: 0,
    isLocked: true,
    positions: [],
    orders: [...closedOrders, ...cancelledOrders],
  });
}

export function placePaperOrder(input: PlacePaperOrder): { ok: boolean; message: string } {
  loadAccount();
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { ok: false, message: "Select a symbol" };
  if (account.isLocked) return { ok: false, message: "Account is locked due to margin call liquidation" };
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, message: "Quantity must be a positive whole number" };
  }

  const price = input.limitPrice || input.stopPrice || 0;
  if (input.type !== "MARKET" && price <= 0) {
    return { ok: false, message: "Enter a valid price" };
  }

  const orderId = crypto.randomUUID();
  const newOrder: PaperOrder = {
    id: orderId,
    symbol,
    side: input.side,
    qty: input.qty,
    type: input.type,
    limitPrice: input.limitPrice,
    stopPrice: input.stopPrice,
    triggerPrice: input.stopPrice,
    filledQty: 0,
    slippageApplied: 0,
    transactionFee: 0,
    status: "pending",
    placedAt: new Date().toISOString(),
    stopLossPrice: input.stopLossPrice,
    takeProfitPrice: input.takeProfitPrice,
    trailingDistance: input.trailingDistance,
    isTrailingPercent: input.isTrailingPercent,
  };

  // Pre-execution margin checks
  const leveragePrice = input.limitPrice || input.stopPrice || price || 1;
  const marginNeeded = (input.qty * leveragePrice) / LEVERAGE;
  
  // Calculate total positions value for free margin checks
  let totalUnrealized = 0;
  account.positions.forEach(p => totalUnrealized += p.unrealizedPnl);
  const equity = account.cash + totalUnrealized;
  const freeMargin = equity - account.allocatedMargin;

  if (freeMargin < marginNeeded && input.type !== "MARKET") {
    return { ok: false, message: "Insufficient free margin for 5x leverage" };
  }

  const updatedOrders = [newOrder, ...account.orders].slice(0, 200);
  const nextAccount = { ...account, orders: updatedOrders };

  if (input.type === "MARKET") {
    // Immediate execution
    const currentPrice = price || 1;
    const slippage = calculateSlippage(currentPrice, input.qty);
    const fillPrice = input.side === "BUY" ? currentPrice + slippage : Math.max(0.05, currentPrice - slippage);
    
    // Execute fill in transaction simulation
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
  const marginNeeded = (fillQty * fillPrice) / LEVERAGE;

  // Final margin check
  let totalUnrealized = 0;
  curr.positions.forEach((p) => {
    if (p.symbol !== order.symbol) totalUnrealized += p.unrealizedPnl;
  });
  
  const equity = curr.cash + totalUnrealized;
  if (equity - curr.allocatedMargin < marginNeeded && !position) {
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

  // Calculate entry and realized P&L
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

  // Update positions array
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

  // Update order status
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

  // Bracket Orders Insertion (TP / SL brackets) on full fill
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

  // OCO Cancellation
  if (isFullyFilled && order.parentOrderId) {
    orders = orders.map((o) =>
      o.parentOrderId === order.parentOrderId && o.id !== order.id && (o.status === "pending" || o.status === "partial")
        ? { ...o, status: "cancelled", rejectReason: "OCO bracket filled" } as PaperOrder
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

  // Recalculate account margins
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
  if (account.isLocked) return;

  let next = { ...account };
  let updated = false;

  // 1. Recalculate Unrealized PnL on positions & Check margin breaches
  let totalUnrealized = 0;
  next.positions = next.positions.map((pos) => {
    const quote = quotes.get(pos.symbol);
    if (!quote) {
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
  if (equity < next.maintenanceMargin) {
    liquidateAll("Margin call breach");
    return;
  }

  // 2. Iterate and match pending/trigger pending orders
  for (let i = 0; i < next.orders.length; i++) {
    const order = next.orders[i];
    if (order.status !== "pending" && order.status !== "partial") continue;

    const quote = quotes.get(order.symbol);
    if (!quote) continue;

    const ltp = quote.price;
    const bid = quote.price; // fallback to LTP
    const ask = quote.price; // fallback to LTP
    const volume = quote.volume || 1000;

    let isTriggered = false;
    let isMatched = false;
    let fillPrice = 0;
    let slippage = 0;

    // Trailing stop trigger check
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
          fillPrice = limit;
        } else if (order.side === "SELL" && bid >= limit) {
          isMatched = true;
          fillPrice = limit;
        }
      }
    }

    if (isMatched) {
      const remainingQty = order.qty - order.filledQty;
      const fillQty = order.type === "LIMIT" ? Math.min(remainingQty, volume) : remainingQty;
      if (fillQty > 0) {
        next = simulateFill(next, order, fillPrice, slippage, fillQty);
        updated = true;
      }
    }
  }

  if (updated) {
    commit(next);
  }
}

export function resetPaperAccount(): void {
  commit({
    initialCash: INITIAL_CASH,
    cash: INITIAL_CASH,
    realizedPnl: 0,
    allocatedMargin: 0,
    maintenanceMargin: 0,
    isLocked: false,
    positions: [],
    orders: [],
  });
}

export function usePaperAccount() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ACCOUNT);
  return {
    account: snapshot,
    placeOrder: placePaperOrder,
    cancelOrder: cancelPaperOrder,
    reset: resetPaperAccount,
  };
}
