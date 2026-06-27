import { useSyncExternalStore } from "react";
import type { MarketQuote } from "@/lib/market-api";

export type PaperOrderType = "MARKET" | "LIMIT" | "STOP";
export type PaperOrderStatus = "pending" | "filled" | "rejected";

export type PaperOrder = {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  type: PaperOrderType;
  triggerPrice?: number;
  fillPrice?: number;
  status: PaperOrderStatus;
  placedAt: string;
  filledAt?: string;
  rejectReason?: string;
};

export type PaperPosition = {
  symbol: string;
  qty: number;
  avgPrice: number;
};

export type PaperAccount = {
  initialCash: number;
  cash: number;
  realizedPnl: number;
  positions: PaperPosition[];
  orders: PaperOrder[];
};

export type PlacePaperOrder = {
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  type: PaperOrderType;
  triggerPrice?: number;
  marketPrice?: number;
};

const STORAGE_KEY = "maet.paper-account.v1";
const INITIAL_CASH = 1_000_000;
const EMPTY_ACCOUNT: PaperAccount = {
  initialCash: INITIAL_CASH,
  cash: INITIAL_CASH,
  realizedPnl: 0,
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
    if (!raw) return;
    const parsed = JSON.parse(raw) as Partial<PaperAccount>;
    if (
      typeof parsed.initialCash === "number" &&
      typeof parsed.cash === "number" &&
      typeof parsed.realizedPnl === "number" &&
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

function rejectOrder(current: PaperAccount, order: PaperOrder, reason: string): PaperAccount {
  return {
    ...current,
    orders: current.orders.map((item) =>
      item.id === order.id ? { ...item, status: "rejected", rejectReason: reason } : item
    ),
  };
}

function fillOrder(current: PaperAccount, order: PaperOrder, price: number): PaperAccount {
  const position = current.positions.find((item) => item.symbol === order.symbol);
  const notional = price * order.qty;

  if (order.side === "BUY" && notional > current.cash) {
    return rejectOrder(current, order, "Insufficient paper cash");
  }
  if (order.side === "SELL" && (!position || position.qty < order.qty)) {
    return rejectOrder(current, order, "Insufficient paper holdings");
  }

  let positions: PaperPosition[];
  let realizedPnl = current.realizedPnl;
  if (order.side === "BUY") {
    const existingQty = position?.qty ?? 0;
    const nextQty = existingQty + order.qty;
    const avgPrice = ((position?.avgPrice ?? 0) * existingQty + notional) / nextQty;
    positions = position
      ? current.positions.map((item) =>
          item.symbol === order.symbol ? { ...item, qty: nextQty, avgPrice } : item
        )
      : [...current.positions, { symbol: order.symbol, qty: nextQty, avgPrice }];
  } else {
    const nextQty = position!.qty - order.qty;
    realizedPnl += (price - position!.avgPrice) * order.qty;
    positions = nextQty === 0
      ? current.positions.filter((item) => item.symbol !== order.symbol)
      : current.positions.map((item) =>
          item.symbol === order.symbol ? { ...item, qty: nextQty } : item
        );
  }

  const filledAt = new Date().toISOString();
  return {
    ...current,
    cash: current.cash + (order.side === "BUY" ? -notional : notional),
    realizedPnl,
    positions,
    orders: current.orders.map((item) =>
      item.id === order.id ? { ...item, status: "filled", fillPrice: price, filledAt } : item
    ),
  };
}

export function placePaperOrder(input: PlacePaperOrder): { ok: boolean; message: string } {
  loadAccount();
  const symbol = input.symbol.trim().toUpperCase();
  if (!symbol) return { ok: false, message: "Select a symbol" };
  if (!Number.isInteger(input.qty) || input.qty <= 0) {
    return { ok: false, message: "Quantity must be a positive whole number" };
  }
  if (input.type !== "MARKET" && (!input.triggerPrice || input.triggerPrice <= 0)) {
    return { ok: false, message: "Enter a valid trigger price" };
  }
  if (!input.marketPrice || input.marketPrice <= 0) {
    return { ok: false, message: "Wait for a real market quote" };
  }

  const order: PaperOrder = {
    id: crypto.randomUUID(),
    symbol,
    side: input.side,
    qty: input.qty,
    type: input.type,
    triggerPrice: input.type === "MARKET" ? undefined : input.triggerPrice,
    status: "pending",
    placedAt: new Date().toISOString(),
  };
  const withOrder = { ...account, orders: [order, ...account.orders].slice(0, 200) };

  if (input.type === "MARKET") {
    const filled = fillOrder(withOrder, order, input.marketPrice);
    commit(filled);
    const result = filled.orders.find((item) => item.id === order.id)!;
    return result.status === "filled"
      ? { ok: true, message: `${input.side} filled at ₹${input.marketPrice.toFixed(2)}` }
      : { ok: false, message: result.rejectReason ?? "Order rejected" };
  }

  commit(withOrder);
  return { ok: true, message: `${input.type} paper order queued` };
}

export function settlePaperOrders(quotes: Map<string, MarketQuote>): void {
  loadAccount();
  let next = account;
  for (const order of account.orders) {
    if (order.status !== "pending" || order.type === "MARKET") continue;
    const price = quotes.get(order.symbol)?.price;
    if (!price || !order.triggerPrice) continue;
    const shouldFill = order.type === "LIMIT"
      ? order.side === "BUY" ? price <= order.triggerPrice : price >= order.triggerPrice
      : order.side === "BUY" ? price >= order.triggerPrice : price <= order.triggerPrice;
    if (shouldFill) next = fillOrder(next, order, price);
  }
  if (next !== account) commit(next);
}

export function resetPaperAccount(): void {
  commit({ ...EMPTY_ACCOUNT, positions: [], orders: [] });
}

export function usePaperAccount() {
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, () => EMPTY_ACCOUNT);
  return {
    account: snapshot,
    placeOrder: placePaperOrder,
    reset: resetPaperAccount,
  };
}
