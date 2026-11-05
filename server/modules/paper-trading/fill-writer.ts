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
    // TRIGGER_PENDING is filtered out by the caller; the remaining statuses map 1:1.
    status: order.status as PaperOrder["status"],
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
 * the account's cash and margins, the TRADE_REALIZED_PNL / EXECUTION_FEE ledger pair, bracket
 * children, OCO sibling cancellation and the outbox events. Must run inside the caller's
 * serializable transaction; throws PaperExecutionError before any write if the fill is rejected.
 */
export async function applyFill(input: ApplyFillInput): Promise<AppliedFill> {
  const { write, account, order, now } = input;
  if (!FILLABLE_ORDER_STATUSES[order.status] || order.generation !== account.generation) {
    throw new Error(`Order ${order.id} is not fillable (status ${order.status}, generation ${order.generation})`);
  }

  const exchange = ExchangeSchema.parse(order.exchange);
  const execution = executePaperFill({
    account: toDomainAccount(account, input.positions, order),
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

  const filledQty = order.filledQty + fillPlan.quantity;
  const isFullyFilled = filledQty >= order.qty;
  const previousAverage = order.averageFillPrice === null ? 0 : Number(order.averageFillPrice);
  const updatedOrder = await write.updateOrder(order.id, {
    status: isFullyFilled ? "FILLED" : "PARTIALLY_FILLED",
    filledQty,
    averageFillPrice: String((previousAverage * order.filledQty + fillPlan.fillPrice * fillPlan.quantity) / filledQty),
    lastFillAt: now,
    filledAt: isFullyFilled ? now : null,
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

  // Bracket exits are plain LIMIT / STOP_LOSS_LIMIT orders: they carry no SL/TP of their own.
  const children = execution.account.orders.filter((child) => child.parentOrderId === order.id && child.status === "PENDING");
  for (const child of children) {
    const childRow: NewPaperOrderRow = {
      id: child.id,
      userId: account.userId,
      parentOrderId: order.id,
      generation: account.generation,
      symbol: order.symbol,
      exchange,
      side: child.side,
      type: child.type,
      status: child.type === "STOP_LOSS_LIMIT" ? "TRIGGER_PENDING" : "PENDING",
      qty: child.quantity,
      filledQty: 0,
      limitPrice: child.limitPrice === undefined ? null : String(child.limitPrice),
      stopPrice: child.stopPrice === undefined ? null : String(child.stopPrice),
      version: 1,
      placedAt: now,
      updatedAt: now,
    };
    await write.insertOrder(childRow);
  }

  if (isFullyFilled && order.parentOrderId) {
    await write.cancelSiblingOrders({
      userId: account.userId,
      generation: account.generation,
      parentOrderId: order.parentOrderId,
      excludeOrderId: order.id,
      reason: "OCO bracket sibling filled",
    });
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
