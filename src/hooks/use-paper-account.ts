import { useSyncExternalStore } from "react";
import type { MarketQuote } from "@/lib/market-api";
import {
  placePaperOrderInAccount,
  settlePaperAccount,
} from "@shared/domain/paper-trading/execution";
import { calculateAccountMargins } from "@shared/domain/paper-trading/margin";
import {
  LegacyPaperAccountSchema,
  PaperAccountV3Schema,
  type LegacyPaperAccount,
  type PaperAccount,
  type PaperOrder,
  type PaperPosition,
  type PlacePaperOrder,
} from "@shared/domain/paper-trading/types";
import {
  parseExecutionQuote,
  type ExecutionQuote,
} from "@shared/types";

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

export const EMPTY_ACCOUNT: PaperAccount = {
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

type StoredAccountSource =
  | "empty"
  | "v3"
  | "legacy-v3-key"
  | "legacy-v2-key"
  | "invalid";

export type StoredPaperAccountResult = {
  account: PaperAccount;
  source: StoredAccountSource;
  warning?: string;
};

let account: PaperAccount = EMPTY_ACCOUNT;
let loaded = false;
const listeners = new Set<() => void>();

function mapLegacyStatus(
  status: string | undefined,
  isLocked: boolean | undefined,
  positionsCount: number
): "ACTIVE" | "LIQUIDATION_PENDING" | "LIQUIDATED" {
  if (
    status === "ACTIVE" ||
    status === "LIQUIDATION_PENDING" ||
    status === "LIQUIDATED"
  ) {
    return status;
  }
  if (isLocked) {
    return positionsCount > 0
      ? "LIQUIDATION_PENDING"
      : "LIQUIDATED";
  }
  return "ACTIVE";
}

function mapLegacyOrderStatus(
  status: string | undefined
): PaperOrder["status"] {
  const normalized = status?.toLowerCase();
  if (normalized === "triggered") return "TRIGGERED";
  if (
    normalized === "partial" ||
    normalized === "partially_filled"
  ) {
    return "PARTIALLY_FILLED";
  }
  if (normalized === "filled") return "FILLED";
  if (normalized === "cancelled") return "CANCELLED";
  if (normalized === "rejected") return "REJECTED";
  return "PENDING";
}

function migrateLegacyAccount(
  legacy: LegacyPaperAccount
): PaperAccount | undefined {
  const migrationTime = new Date().toISOString();
  const positions: PaperPosition[] = [];
  for (const legacyPosition of legacy.positions) {
    const quantity =
      legacyPosition.quantity ?? legacyPosition.qty;
    const averagePrice =
      legacyPosition.averagePrice ?? legacyPosition.avgPrice;
    if (
      quantity === undefined ||
      averagePrice === undefined
    ) {
      return undefined;
    }

    positions.push({
      symbol: legacyPosition.symbol,
      quantity,
      averagePrice,
      marginLocked:
        legacyPosition.marginLocked ??
        (Math.abs(quantity) * averagePrice) / 5,
      unrealisedPnl:
        legacyPosition.unrealisedPnl ??
        legacyPosition.unrealizedPnl ??
        0,
      realisedPnl:
        legacyPosition.realisedPnl ??
        legacyPosition.realizedPnl ??
        0,
      updatedAt:
        legacyPosition.updatedAt ?? migrationTime,
    });
  }

  const orders: PaperOrder[] = [];
  for (const legacyOrder of legacy.orders ?? []) {
    const quantity =
      legacyOrder.quantity ?? legacyOrder.qty;
    if (quantity === undefined) return undefined;

    orders.push({
      id: legacyOrder.id,
      symbol: legacyOrder.symbol,
      side: legacyOrder.side,
      quantity,
      type: legacyOrder.type,
      status: mapLegacyOrderStatus(legacyOrder.status),
      limitPrice: legacyOrder.limitPrice,
      stopPrice: legacyOrder.stopPrice,
      triggeredAt: legacyOrder.triggeredAt,
      filledQuantity:
        legacyOrder.filledQuantity ??
        legacyOrder.filledQty ??
        0,
      averageFillPrice:
        legacyOrder.averageFillPrice ??
        legacyOrder.averagePrice,
      stopLossPrice: legacyOrder.stopLossPrice,
      takeProfitPrice: legacyOrder.takeProfitPrice,
      trailingDistance: legacyOrder.trailingDistance,
      trailingHighWatermark:
        legacyOrder.trailingHighWatermark ??
        legacyOrder.trailingHwm,
      trailingLowWatermark:
        legacyOrder.trailingLowWatermark ??
        legacyOrder.trailingLwm,
      trailingIsPercent:
        legacyOrder.trailingIsPercent ??
        legacyOrder.isTrailingPercent,
      createdAt:
        legacyOrder.createdAt ??
        legacyOrder.placedAt ??
        migrationTime,
      updatedAt: legacyOrder.updatedAt ?? migrationTime,
      rejectionReason:
        legacyOrder.rejectionReason ??
        legacyOrder.rejectReason,
      parentOrderId: legacyOrder.parentOrderId,
      quoteSource: legacyOrder.quoteSource,
      quoteQuality: legacyOrder.quoteQuality,
      quoteTimestamp: legacyOrder.quoteTimestamp,
      referencePrice: legacyOrder.referencePrice,
    });
  }

  const {
    allocatedMargin,
    maintenanceMargin,
  } = calculateAccountMargins(positions, 5);
  const migrated: PaperAccount = {
    version: 3,
    initialCash: legacy.initialCash ?? INITIAL_CASH,
    cash: legacy.cash,
    allocatedMargin,
    maintenanceMargin,
    realisedPnl:
      legacy.realisedPnl ?? legacy.realizedPnl ?? 0,
    status: mapLegacyStatus(
      legacy.status,
      legacy.isLocked,
      positions.length
    ),
    lockReason: legacy.lockReason,
    lockedAt: legacy.lockedAt,
    liquidationCompletedAt:
      legacy.liquidationCompletedAt,
    positions,
    orders,
    fills: [],
  };
  const validated = PaperAccountV3Schema.safeParse(migrated);
  return validated.success ? validated.data : undefined;
}

function parseStoredCandidate(
  raw: string
):
  | { kind: "v3"; account: PaperAccount }
  | { kind: "legacy"; account: PaperAccount }
  | { kind: "invalid"; reason: string } {
  let decoded: unknown;
  try {
    decoded = JSON.parse(raw) as unknown;
  } catch {
    return {
      kind: "invalid",
      reason: "Stored account JSON is corrupted",
    };
  }

  const current = PaperAccountV3Schema.safeParse(decoded);
  if (current.success) {
    return {
      kind: "v3",
      account: current.data,
    };
  }

  const legacy = LegacyPaperAccountSchema.safeParse(decoded);
  if (!legacy.success) {
    return {
      kind: "invalid",
      reason: "Stored account does not match V3 or legacy schema",
    };
  }

  const migrated = migrateLegacyAccount(legacy.data);
  if (!migrated) {
    return {
      kind: "invalid",
      reason: "Legacy account migration failed V3 validation",
    };
  }

  return {
    kind: "legacy",
    account: migrated,
  };
}

export function parseStoredPaperAccount(
  rawV3: string | null,
  rawV2: string | null
): StoredPaperAccountResult {
  const warnings: string[] = [];

  if (rawV3) {
    const parsedV3 = parseStoredCandidate(rawV3);
    if (parsedV3.kind === "v3") {
      return {
        account: parsedV3.account,
        source: "v3",
      };
    }
    if (parsedV3.kind === "legacy") {
      return {
        account: parsedV3.account,
        source: "legacy-v3-key",
      };
    }
    warnings.push(parsedV3.reason);
  }

  if (rawV2) {
    const parsedV2 = parseStoredCandidate(rawV2);
    if (parsedV2.kind === "v3") {
      return {
        account: parsedV2.account,
        source: "v3",
      };
    }
    if (parsedV2.kind === "legacy") {
      return {
        account: parsedV2.account,
        source: "legacy-v2-key",
      };
    }
    warnings.push(parsedV2.reason);
  }

  if (!rawV3 && !rawV2) {
    return {
      account: EMPTY_ACCOUNT,
      source: "empty",
    };
  }

  return {
    account: EMPTY_ACCOUNT,
    source: "invalid",
    warning:
      warnings[0] ??
      "Stored account could not be validated",
  };
}

function loadAccount(): void {
  if (loaded || typeof window === "undefined") return;
  loaded = true;

  const rawV3 = window.localStorage.getItem(STORAGE_KEY);
  const rawV2 = window.localStorage.getItem(OLD_STORAGE_KEY);
  const result = parseStoredPaperAccount(rawV3, rawV2);
  account = result.account;

  if (result.source === "invalid") {
    console.warn("[usePaperAccount] Account state rejected", {
      reason:
        result.warning ?? "Account state validation failed",
    });
    return;
  }

  if (
    result.source === "legacy-v2-key" ||
    result.source === "legacy-v3-key"
  ) {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(account)
      );
      if (result.source === "legacy-v2-key") {
        window.localStorage.removeItem(OLD_STORAGE_KEY);
      }
    } catch (error: unknown) {
      console.warn(
        "[usePaperAccount] Migrated account could not be persisted",
        {
          reason:
            error instanceof Error
              ? error.message
              : "Unknown persistence error",
        }
      );
    }
  }
}

function commit(next: PaperAccount): void {
  const validated = PaperAccountV3Schema.safeParse(next);
  if (!validated.success) {
    console.error(
      "[usePaperAccount] Refused to persist invalid V3 account",
      {
        reason: validated.error.issues[0]?.message,
      }
    );
    return;
  }

  account = validated.data;
  if (typeof window !== "undefined") {
    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify(account)
      );
    } catch (error: unknown) {
      console.error(
        "[usePaperAccount] Failed to persist account state",
        {
          reason:
            error instanceof Error
              ? error.message
              : "Unknown persistence error",
        }
      );
    }
  }
  listeners.forEach((listener) => listener());
}

export function placePaperOrder(
  input: PlacePaperOrder
): { ok: boolean; message: string } {
  loadAccount();
  const result = placePaperOrderInAccount(account, input);
  if (result.ok) {
    commit(result.account);
  }
  return {
    ok: result.ok,
    message: result.message,
  };
}

export function cancelPaperOrder(orderId: string): void {
  loadAccount();
  const now = new Date().toISOString();
  const nextOrders = account.orders.map(
    (order): PaperOrder =>
      order.id === orderId &&
      (order.status === "PENDING" ||
        order.status === "TRIGGERED" ||
        order.status === "PARTIALLY_FILLED")
        ? {
            ...order,
            status: "CANCELLED",
            updatedAt: now,
          }
        : order
  );
  commit({
    ...account,
    orders: nextOrders,
  });
}

export function settlePaperOrders(
  quotes: Map<string, MarketQuote | ExecutionQuote>
): void {
  loadAccount();
  if (account.status === "LIQUIDATED") return;

  const executionQuotes = new Map<string, ExecutionQuote>();
  quotes.forEach((rawQuote, mapSymbol) => {
    const result = parseExecutionQuote(
      rawQuote,
      mapSymbol
    );
    if (!result.ok) {
      console.warn(
        "[settlePaperOrders] Quote rejected",
        {
          symbol: mapSymbol,
          reason: result.reason,
        }
      );
      return;
    }

    executionQuotes.set(
      result.quote.symbol,
      result.quote
    );
  });

  const nextAccount = settlePaperAccount(
    account,
    executionQuotes
  );
  if (nextAccount !== account) {
    commit(nextAccount);
  }
}

export function usePaperAccount() {
  const currentAccount = useSyncExternalStore(
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
    account: currentAccount,
    placeOrder: placePaperOrder,
    cancelOrder: cancelPaperOrder,
    reset: resetPaperAccount,
  };
}

export function getPaperAccount(): PaperAccount {
  loadAccount();
  return {
    ...account,
  };
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
