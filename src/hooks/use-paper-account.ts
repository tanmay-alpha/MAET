import { useSyncExternalStore } from "react";
import type { MarketQuote } from "@/lib/market-api";
import { executePaperFill, placePaperOrderInAccount, settlePaperAccount } from "@shared/domain/paper-trading/execution";
import { calculateAccountMargins } from "@shared/domain/paper-trading/margin";
import type {
  PaperAccount,
  PaperFill,
  PaperOrder,
  PaperPosition,
  PlacePaperOrder,
} from "@shared/domain/paper-trading/types";
import { evaluateExecutionQuote, type ExecutionQuote } from "@shared/types";

export type {
  PaperAccount,
  PaperAccountStatus,
  PaperExecutionReason,
  PaperFill,
  PaperOrder,
  PaperOrderStatus,
  PaperOrderType,
  PaperPosition,
  PlacePaperLimitOrder,
  PlacePaperMarketOrder,
  PlacePaperOrder,
  PlacePaperStopLimitOrder,
} from "@shared/domain/paper-trading/types";

const STORAGE_KEY = "maet.paper-account.v3";
const OLD_STORAGE_KEY = "maet.paper-account.v2";
const INITIAL_CASH = 1_000_000;

const EMPTY_ACCOUNT: PaperAccount = {
  version: 3,
  initialCash: INITIAL_CASH,
  cash: INITIAL_CASH,
  allocatedMargin: 0,
  maintenanceMargin: 0,
  realisedPnl: 0,
  status: "ACTIVE",
  positions: [],
  orders: [],
  fills: [],
};

let account: PaperAccount = EMPTY_ACCOUNT;
let loaded = false;
const listeners = new Set<() => void>();

function mapLegacyStatus(status?: string, isLocked?: boolean, positionsCount: number = 0): "ACTIVE" | "LIQUIDATION_PENDING" | "LIQUIDATED" {
  if (status === "ACTIVE" || status === "LIQUIDATION_PENDING" || status === "LIQUIDATED") {
    return status;
  }
  if (isLocked) {
    return positionsCount > 0 ? "LIQUIDATION_PENDING" : "LIQUIDATED";
  }
  return "ACTIVE";
}

function mapLegacyOrderStatus(status?: string): PaperOrder["status"] {
  if (!status) return "PENDING";
  const s = status.toLowerCase();
  if (s === "pending") return "PENDING";
  if (s === "triggered") return "TRIGGERED";
  if (s === "partial" || s === "partially_filled") return "PARTIALLY_FILLED";
  if (s === "filled") return "FILLED";
  if (s === "cancelled") return "CANCELLED";
  if (s === "rejected") return "REJECTED";
  return "PENDING";
}

function loadAccount(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const rawV3 = window.localStorage.getItem(STORAGE_KEY);
    const rawData = rawV3 || window.localStorage.getItem(OLD_STORAGE_KEY);
    if (!rawData) return;

    const parsed = JSON.parse(rawData) as any;
    if (typeof parsed.cash === "number" && Array.isArray(parsed.positions)) {
      const positions: PaperPosition[] = parsed.positions.map((p: any) => {
        const qty = p.quantity ?? p.qty ?? 0;
        const avgPrice = p.averagePrice ?? p.avgPrice ?? 0;
        return {
          symbol: p.symbol,
          quantity: qty,
          averagePrice: avgPrice,
          marginLocked: p.marginLocked ?? (Math.abs(qty) * avgPrice) / 5,
          unrealisedPnl: p.unrealisedPnl ?? p.unrealizedPnl ?? 0,
          realisedPnl: p.realisedPnl ?? p.realizedPnl ?? 0,
          updatedAt: p.updatedAt ?? new Date().toISOString(),
        };
      });

      const orders: PaperOrder[] = Array.isArray(parsed.orders)
        ? parsed.orders.map((o: any) => ({
            id: o.id,
            symbol: o.symbol,
            side: o.side,
            quantity: o.quantity ?? o.qty ?? 0,
            type: o.type,
            status: mapLegacyOrderStatus(o.status),
            limitPrice: o.limitPrice,
            stopPrice: o.stopPrice,
            triggeredAt: o.triggeredAt,
            filledQuantity: o.filledQuantity ?? o.filledQty ?? 0,
            averageFillPrice: o.averageFillPrice ?? o.averagePrice,
            stopLossPrice: o.stopLossPrice,
            takeProfitPrice: o.takeProfitPrice,
            trailingDistance: o.trailingDistance,
            trailingHighWatermark: o.trailingHighWatermark ?? o.trailingHwm,
            trailingLowWatermark: o.trailingLowWatermark ?? o.trailingLwm,
            trailingIsPercent: o.trailingIsPercent ?? o.isTrailingPercent,
            createdAt: o.createdAt ?? o.placedAt ?? new Date().toISOString(),
            updatedAt: o.updatedAt ?? new Date().toISOString(),
            rejectionReason: o.rejectionReason ?? o.rejectReason,
            parentOrderId: o.parentOrderId,
            quoteSource: o.quoteSource,
            quoteQuality: o.quoteQuality,
            quoteTimestamp: o.quoteTimestamp,
            referencePrice: o.referencePrice,
          }))
        : [];

      const fills: PaperFill[] = Array.isArray(parsed.fills) ? parsed.fills : [];
      const status = mapLegacyStatus(parsed.status, parsed.isLocked, positions.length);
      const { allocatedMargin, maintenanceMargin } = calculateAccountMargins(positions, 5);

      account = {
        version: 3,
        initialCash: parsed.initialCash ?? INITIAL_CASH,
        cash: parsed.cash,
        allocatedMargin,
        maintenanceMargin,
        realisedPnl: parsed.realisedPnl ?? parsed.realizedPnl ?? 0,
        status,
        lockReason: parsed.lockReason,
        lockedAt: parsed.lockedAt,
        liquidationCompletedAt: parsed.liquidationCompletedAt,
        positions,
        orders,
        fills,
      };
    }
  } catch (err) {
    console.error("[usePaperAccount] Failed to load or migrate account state", err);
  }
}

function commit(next: PaperAccount): void {
  account = next;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(account));
    } catch (err) {
      console.error("[usePaperAccount] Failed to persist account state", err);
    }
  }
  listeners.forEach((fn) => fn());
}

export function placePaperOrder(input: PlacePaperOrder): { ok: boolean; message: string } {
  loadAccount();
  const res = placePaperOrderInAccount(account, input);
  if (res.ok) {
    commit(res.account);
  }
  return { ok: res.ok, message: res.message };
}

export function cancelPaperOrder(orderId: string): void {
  loadAccount();
  const now = new Date().toISOString();
  const nextOrders = account.orders.map((o) =>
    o.id === orderId && (o.status === "PENDING" || o.status === "TRIGGERED" || o.status === "PARTIALLY_FILLED")
      ? { ...o, status: "CANCELLED" as const, updatedAt: now }
      : o
  );
  commit({ ...account, orders: nextOrders });
}

export function settlePaperOrders(quotes: Map<string, MarketQuote | ExecutionQuote>): void {
  loadAccount();
  if (account.status === "LIQUIDATED") return;

  // Convert raw MarketQuote map entries to strict ExecutionQuote objects where required
  const execQuotes = new Map<string, ExecutionQuote>();
  quotes.forEach((q, sym) => {
    const raw = q as any;
    const execQ: ExecutionQuote = {
      exchange: raw.exchange ?? "NSE",
      symbol: raw.symbol ?? sym,
      price: raw.price,
      volume: raw.volume,
      ts: raw.ts ?? raw.timestamp ?? new Date().toISOString(),
      source: raw.source,
      quality: raw.quality,
    };
    execQuotes.set(sym.trim().toUpperCase(), execQ);
  });

  const nextAccount = settlePaperAccount(account, execQuotes);
  if (nextAccount !== account) {
    commit(nextAccount);
  }
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
    version: 3,
    initialCash: INITIAL_CASH,
    cash: INITIAL_CASH,
    allocatedMargin: 0,
    maintenanceMargin: 0,
    realisedPnl: 0,
    status: "ACTIVE",
    positions: [],
    orders: [],
    fills: [],
  });
}
