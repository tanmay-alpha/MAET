import { getConfig } from "../../config";
import {
  ExchangeSchema,
  type ExecutionQuote,
  type ExecutionQuotePolicyConfig,
} from "@shared/types/market";
import type { EquityChargeBreakdown } from "@shared/domain/costs/indian-equity-charges";
import { PAPER_CHARGE_PRODUCT, executePaperFill } from "@shared/domain/paper-trading/execution";
import type {
  PaperAccount,
  PaperExecutionReason,
  PaperOrder,
  PaperPosition,
} from "@shared/domain/paper-trading/types";
import type {
  NewPaperOrderRow,
  PaperAccountRow,
  PaperFillRow,
  PaperOrderRow,
  PaperPositionRow,
} from "./contracts";
import type { PaperTradingWriteRepository } from "./repository";
import { signedPositionQuantity } from "./mapper";
import {
  buildAccountUpdatedEvent,
  buildOrderFilledEvent,
  buildOrderPartiallyFilledEvent,
  buildPositionUpdatedEvent,
} from "./outbox";

/** Quote freshness policy shared by every paper execution path (MARKET, matcher, liquidation). */
export function paperExecutionPolicy(): ExecutionQuotePolicyConfig {
  const config = getConfig();
  return {
    allowDelayed: config.paperExecutionAllowDelayed,
    maxAgeMs: config.paperExecutionMaxQuoteAgeMs,
  };
}

const FILLABLE_ORDER_STATUSES: Partial<Record<PaperOrderRow["status"], true>> = {
  PENDING: true,
  TRIGGERED: true,
  PARTIALLY_FILLED: true,
};

function toDomainPosition(row: PaperPositionRow, symbolKey: string): PaperPosition {
  return {
    symbol: symbolKey,
    quantity: signedPositionQuantity(row),
    averagePrice: Number(row.averageEntryPrice),
    marginLocked: Number(row.marginLocked),
    realisedPnl: Number(row.realizedPnl),
    unrealisedPnl: Number(row.unrealizedPnl || 0),
    updatedAt: row.updatedAt.toISOString(),
  };
}

/**
 * The domain engine identifies positions by symbol only. A holding of the same symbol on the
 * other exchange is a different position, so it gets a distinct key: it still counts towards
 * margin but can never be reconciled against this order's fill.
 */
function toDomainAccount(account: PaperAccountRow, positions: PaperPositionRow[], order: PaperOrderRow): PaperAccount {
  return {
    version: 3,
    initialCash: Number(account.initialCash),
    cash: Number(account.cashBalance),
    allocatedMargin: Number(account.allocatedMargin),
    maintenanceMargin: Number(account.maintenanceMargin),
    realisedPnl: Number(account.realisedPnl),
    status: account.status,
    positions: positions.map((row) =>
      toDomainPosition(row, row.symbol === order.symbol && row.exchange !== order.exchange ? `${row.symbol}@${row.exchange}` : row.symbol)
    ),
    orders: [],
    fills: [],
  };
}

function toDomainOrder(order: PaperOrderRow): PaperOrder {
  const optionalNumber = (value: string | null) => (value === null ? undefined : Number(value));
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    type: order.type,
    // Untriggered stops are TRIGGER_PENDING in the database and PENDING in the domain.
    status: order.status === "TRIGGER_PENDING" ? "PENDING" : order.status,
    quantity: order.qty,
    filledQuantity: order.filledQty,
    limitPrice: optionalNumber(order.limitPrice),
    stopPrice: optionalNumber(order.stopPrice),
    triggeredAt: order.triggeredAt?.toISOString(),
    averageFillPrice: optionalNumber(order.averageFillPrice),
    stopLossPrice: optionalNumber(order.stopLossPrice),
    takeProfitPrice: optionalNumber(order.takeProfitPrice),
    parentOrderId: order.parentOrderId ?? undefined,
    createdAt: order.placedAt.toISOString(),
    updatedAt: order.updatedAt.toISOString(),
  };
}

export interface ApplyFillInput {
  write: PaperTradingWriteRepository;
  /** Locked account row. */
  account: PaperAccountRow;
  /** Locked order row of the account's current generation, in a fillable status. */
  order: PaperOrderRow;
  /** Locked positions of the account's current generation. */
  positions: PaperPositionRow[];
  quote: ExecutionQuote;
  quoteFingerprint: string;
  fillQuantity: number;
  reason: PaperExecutionReason;
  ledgerSourceType: "FILL" | "LIQUIDATION_FILL";
  now: Date;
  createId: () => string;
}

export interface AppliedFill {
  order: PaperOrderRow;
  fill: PaperFillRow;
  account: PaperAccountRow;
  position: PaperPositionRow | null;
  isFullyFilled: boolean;
  charges: EquityChargeBreakdown;
}

/**
 * Executes one fill of a locked order and persists every consequence of it: the fill row
 * (with the next execution sequence), the order's progress, the position (side included),
 * the account's cash and margins, the TRADE_REALIZED_PNL / EXECUTION_FEE ledger pair, the
 * bracket linkage (exits grown by entry fills; siblings shrunk or cancelled by exit fills)
 * and the outbox events. Must run inside the caller's serializable transaction; throws
 * PaperExecutionError before any write if the fill is rejected.
 */
export async function applyFill(input: ApplyFillInput): Promise<AppliedFill> {
  const { write, account, order, now } = input;
  if (!FILLABLE_ORDER_STATUSES[order.status] || order.generation !== account.generation) {
    throw new Error(`Order ${order.id} is not fillable (status ${order.status}, generation ${order.generation})`);
  }

  // The bracket this order belongs to: its own exits when it is an entry, its siblings when it is an exit.
  const relatives = (
    await write.findWorkingChildOrdersForUpdate({
      userId: account.userId,
      parentOrderId: order.parentOrderId ?? order.id,
    })
  ).filter((relative) => relative.id !== order.id);

  const exchange = ExchangeSchema.parse(order.exchange);
  const domainAccount = toDomainAccount(account, input.positions, order);
  const execution = executePaperFill({
    account: { ...domainAccount, orders: relatives.map(toDomainOrder) },
    order: toDomainOrder(order),
    fillQuantity: input.fillQuantity,
    quote: input.quote,
    reason: input.reason,
    exchange,
    policy: paperExecutionPolicy(),
  });
  const { fill: fillPlan, charges } = execution;

  const fill = await write.insertFill({
    id: input.createId(),
    orderId: order.id,
    userId: account.userId,
    generation: account.generation,
    symbol: order.symbol,
    exchange,
    side: order.side,
    quantity: fillPlan.quantity,
    referencePrice: String(fillPlan.referencePrice),
    fillPrice: String(fillPlan.fillPrice),
    slippage: String(fillPlan.slippage),
    fees: String(fillPlan.fees),
    realizedPnl: String(fillPlan.realisedPnl),
    quoteSource: input.quote.source,
    quoteQuality: input.quote.quality,
    quoteTimestamp: new Date(input.quote.ts),
    quoteFingerprint: input.quoteFingerprint,
    executionReason: input.reason,
    executionSequence: await write.nextExecutionSequence(order.id),
    executedAt: now,
    createdAt: now,
  });

  const isFullyFilled = execution.order.status === "FILLED";
  const remainderCancelled = execution.order.status === "CANCELLED";
  const updatedOrder = await write.updateOrder(order.id, {
    status: execution.order.status,
    filledQty: execution.order.filledQuantity,
    averageFillPrice: String(execution.order.averageFillPrice),
    lastFillAt: now,
    filledAt: isFullyFilled ? now : null,
    cancelledAt: remainderCancelled ? now : null,
    rejectReason: remainderCancelled ? (execution.order.rejectionReason ?? null) : order.rejectReason,
    lastQuoteFingerprint: input.quoteFingerprint,
    updatedAt: now,
  });

  const existing = input.positions.find((row) => row.symbol === order.symbol && row.exchange === exchange);
  const projected = execution.account.positions.find((position) => position.symbol === order.symbol);
  let position: PaperPositionRow | null = null;
  if (projected) {
    position = await write.upsertPosition({
      id: existing?.id ?? input.createId(),
      userId: account.userId,
      generation: account.generation,
      symbol: order.symbol,
      exchange,
      side: projected.quantity < 0 ? "SHORT" : "LONG",
      totalShares: Math.abs(projected.quantity),
      averageEntryPrice: String(projected.averagePrice),
      realizedPnl: String(projected.realisedPnl),
      unrealizedPnl: String(projected.unrealisedPnl),
      marginLocked: String(projected.marginLocked),
      lastQuotePrice: String(input.quote.price),
      lastQuoteSource: input.quote.source,
      lastQuoteQuality: input.quote.quality,
      lastQuoteTimestamp: new Date(input.quote.ts),
      version: (existing?.version ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
  } else if (existing) {
    await write.deletePosition({
      userId: account.userId,
      generation: account.generation,
      symbol: order.symbol,
      exchange,
    });
  }

  // Exits protect one direction of one position. Once a fill closes or flips it (a manual
  // close, an opposite entry), the remaining exits of other brackets on it are void.
  const quantityBefore = existing ? signedPositionQuantity(existing) : 0;
  const quantityAfter = projected?.quantity ?? 0;
  if (quantityBefore !== 0 && Math.sign(quantityAfter) !== Math.sign(quantityBefore)) {
    await write.cancelWorkingExits({
      userId: account.userId,
      generation: account.generation,
      symbol: order.symbol,
      exchange,
      keepParentOrderId: order.parentOrderId ?? order.id,
      reason: "Position closed",
    });
  }

  const updatedAccount = await write.updateAccount(account.userId, {
    cashBalance: String(execution.account.cash),
    realisedPnl: String(execution.account.realisedPnl),
    allocatedMargin: String(execution.account.allocatedMargin),
    maintenanceMargin: String(execution.account.maintenanceMargin),
    version: account.version + 1,
    updatedAt: now,
  });

  const ledgerBase = {
    userId: account.userId,
    generation: account.generation,
    fillId: fill.id,
    balanceAfter: String(execution.account.cash),
    currency: "INR",
    sourceType: input.ledgerSourceType,
    sourceId: fill.id,
    createdAt: now,
  };
  await write.insertLedgerEntries([
    {
      ...ledgerBase,
      id: input.createId(),
      entryType: "TRADE_REALIZED_PNL",
      amount: String(fillPlan.realisedPnl),
      metadata: { orderId: order.id, side: order.side, fillPrice: fillPlan.fillPrice, qty: fillPlan.quantity },
    },
    {
      ...ledgerBase,
      id: input.createId(),
      entryType: "EXECUTION_FEE",
      amount: String(-fillPlan.fees),
      metadata: { orderId: order.id, exchange, product: PAPER_CHARGE_PRODUCT, charges },
    },
  ]);

  const loadedRelatives = new Map(relatives.map((relative) => [relative.id, relative]));
  for (const relative of execution.account.orders) {
    const loaded = loadedRelatives.get(relative.id);
    if (!loaded) {
      // A new bracket exit: a plain LIMIT take-profit or STOP_LOSS_MARKET stop with no SL/TP of its own.
      await write.insertOrder({
        id: relative.id,
        userId: account.userId,
        parentOrderId: order.id,
        generation: account.generation,
        symbol: order.symbol,
        exchange,
        side: relative.side,
        type: relative.type,
        status: relative.type === "STOP_LOSS_MARKET" ? "TRIGGER_PENDING" : "PENDING",
        qty: relative.quantity,
        filledQty: 0,
        limitPrice: relative.limitPrice === undefined ? null : String(relative.limitPrice),
        stopPrice: relative.stopPrice === undefined ? null : String(relative.stopPrice),
        version: 1,
        placedAt: now,
        updatedAt: now,
      } satisfies NewPaperOrderRow);
    } else if (relative.status === "CANCELLED") {
      await write.updateOrder(relative.id, {
        status: "CANCELLED",
        rejectReason: relative.rejectionReason ?? null,
        cancelledAt: now,
        updatedAt: now,
      });
    } else if (relative.quantity !== loaded.qty) {
      await write.updateOrder(relative.id, { qty: relative.quantity, updatedAt: now });
    }
  }

  const eventBase = { userId: account.userId, generation: account.generation };
  const fillPayload = { orderId: order.id, fillId: fill.id, fillPrice: fillPlan.fillPrice, quantity: fillPlan.quantity };
  await write.insertOutboxEvents([
    isFullyFilled
      ? buildOrderFilledEvent({ ...eventBase, aggregateType: "PaperOrder", aggregateId: order.id, payload: fillPayload })
      : buildOrderPartiallyFilledEvent({ ...eventBase, aggregateType: "PaperOrder", aggregateId: order.id, payload: fillPayload }),
    buildPositionUpdatedEvent({
      ...eventBase,
      aggregateType: "PaperPosition",
      aggregateId: `${account.userId}:${exchange}:${order.symbol}`,
      payload: { symbol: order.symbol, exchange },
    }),
    buildAccountUpdatedEvent({
      ...eventBase,
      aggregateType: "PaperAccount",
      aggregateId: account.userId,
      payload: { version: updatedAccount.version },
    }),
  ]);

  return { order: updatedOrder, fill, account: updatedAccount, position, isFullyFilled, charges };
}
