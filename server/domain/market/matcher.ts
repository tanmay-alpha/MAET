/**
 * FIXED Paper Order Matcher — with correct position reconciliation,
 * idempotency-aware order dedup, pre-validation, and per-symbol locking.
 */

import { eq, and, or, sql } from "drizzle-orm";
import { db } from "../../data/drizzle/client";
import {
  paperAccounts,
  paperOrders,
  paperPositions,
} from "../../db/schema";
import { quoteStore } from "./quote-store";
import {
  evaluateExecutionQuote,
  parseExecutionQuote,
  type ExecutionQuote,
  type Tick,
} from "@shared/types";
import {
  executePaperFill,
  getErrorMessage,
  type PaperExecutionRequest,
} from "@shared/domain/paper-trading/execution";
import type {
  PaperAccount,
  PaperOrder,
  PaperOrderStatus,
  PaperPosition,
} from "@shared/domain/paper-trading/types";

// ---------------------------------------------------------------------------
// Concurrency control
// ---------------------------------------------------------------------------

const symbolLocks = new Map<string, Promise<void>>();

async function runLocked<T>(symbol: string, fn: () => Promise<T>): Promise<T> {
  const previous = symbolLocks.get(symbol) || Promise.resolve();
  let resolveLock: () => void;
  const next = new Promise<void>((resolve) => { resolveLock = resolve; });
  symbolLocks.set(symbol, next);
  await previous;
  try {
    return await fn();
  } finally {
    resolveLock!();
    if (symbolLocks.get(symbol) === next) {
      symbolLocks.delete(symbol);
    }
  }
}

// ---------------------------------------------------------------------------
// Matching
// ---------------------------------------------------------------------------

export interface MatchingReceipt {
  orderId: string;
  symbol: string;
  side: "BUY" | "SELL";
  qty: number;
  price: number;
  slippageApplied: number;
  transactionFee: number;
  executionTimestamp: string;
  status: "FILLED" | "PARTIALLY_FILLED" | "REJECTED";
  rejectReason?: string;
  updatedMarginLocked: number;
  cashBalance: number;
}

type DatabasePaperAccount = typeof paperAccounts.$inferSelect;
type DatabasePaperOrder = typeof paperOrders.$inferSelect;
type DatabasePaperPosition = typeof paperPositions.$inferSelect;

function optionalNumber(
  value: string | null | undefined
): number | undefined {
  if (value === null || value === undefined) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function databaseDateToIso(
  value: Date | undefined
): string {
  return value instanceof Date
    ? value.toISOString()
    : new Date().toISOString();
}

function mapDatabaseOrderStatus(
  order: DatabasePaperOrder
): PaperOrderStatus {
  if (order.status === "FILLED") return "FILLED";
  if (order.status === "PARTIALLY_FILLED") {
    return "PARTIALLY_FILLED";
  }
  if (order.status === "CANCELLED") return "CANCELLED";
  if (order.status === "REJECTED") return "REJECTED";
  if (
    order.type === "STOP_LOSS_LIMIT" &&
    order.status === "PENDING"
  ) {
    return "TRIGGERED";
  }
  return "PENDING";
}

function toDomainOrder(
  order: DatabasePaperOrder
): PaperOrder {
  const status = mapDatabaseOrderStatus(order);
  return {
    id: order.id,
    symbol: order.symbol,
    side: order.side,
    quantity: order.qty,
    type: order.type,
    status,
    limitPrice: optionalNumber(order.limitPrice),
    stopPrice: optionalNumber(order.stopPrice),
    triggeredAt:
      order.type === "STOP_LOSS_LIMIT" &&
      (status === "TRIGGERED" ||
        status === "PARTIALLY_FILLED")
        ? databaseDateToIso(order.updatedAt)
        : undefined,
    filledQuantity: order.filledQty ?? 0,
    averageFillPrice: optionalNumber(
      order.averageFillPrice
    ),
    stopLossPrice: optionalNumber(order.stopLossPrice),
    takeProfitPrice: optionalNumber(
      order.takeProfitPrice
    ),
    trailingDistance: optionalNumber(
      order.trailingDistance
    ),
    trailingHighWatermark: optionalNumber(
      order.trailingHwm
    ),
    trailingLowWatermark: optionalNumber(
      order.trailingLwm
    ),
    trailingIsPercent:
      order.isTrailingPercent ?? undefined,
    createdAt: databaseDateToIso(order.placedAt),
    updatedAt: databaseDateToIso(order.updatedAt),
    rejectionReason: order.rejectReason ?? undefined,
    parentOrderId: order.parentOrderId ?? undefined,
  };
}

function toDomainPosition(
  position: DatabasePaperPosition
): PaperPosition {
  return {
    symbol: position.symbol,
    quantity: position.totalShares,
    averagePrice: Number(position.averageEntryPrice),
    marginLocked: Number(position.marginLocked),
    realisedPnl: Number(position.realizedPnl),
    unrealisedPnl: Number(position.unrealizedPnl),
    updatedAt: databaseDateToIso(position.updatedAt),
  };
}

function toDomainAccount(
  account: DatabasePaperAccount,
  positions: DatabasePaperPosition[],
  order?: PaperOrder
): PaperAccount {
  const cash = Number(account.cashBalance);
  return {
    version: 3,
    initialCash: cash > 0 ? cash : 1,
    cash,
    allocatedMargin: Number(account.allocatedMargin),
    maintenanceMargin: Number(account.maintenanceMargin),
    realisedPnl: 0,
    status: account.isLocked ? "LIQUIDATED" : "ACTIVE",
    positions: positions.map(toDomainPosition),
    orders: order ? [order] : [],
    fills: [],
  };
}

export async function onTick(
  rawTick: Tick
): Promise<MatchingReceipt[]> {
  const parsed = parseExecutionQuote(rawTick);
  if (!parsed.ok) return [];
  const quote = parsed.quote;
  const policy = evaluateExecutionQuote(
    quote,
    quote.symbol
  );
  if (!policy.executable) return [];

  const symbol = quote.symbol;
  const ltp = quote.price;
  const volume = quote.volume;
  return runLocked(symbol, async () => {
    const receipts: MatchingReceipt[] = [];

    const executionBid = ltp;
    const executionAsk = ltp;

    // 1. Margin call / liquidation checks for all positions in this symbol
    const activePositions = await db
      .select()
      .from(paperPositions)
      .where(eq(paperPositions.symbol, symbol));

    for (const pos of activePositions) {
      try {
        await db.transaction(async (tx) => {
          const [account] = await tx
            .select()
            .from(paperAccounts)
            .where(eq(paperAccounts.userId, pos.userId))
            .for("update");

          if (!account) return;

          const userPositions = await tx
            .select()
            .from(paperPositions)
            .where(eq(paperPositions.userId, pos.userId))
            .for("update");

          let totalUnrealizedPnl = 0;
          for (const p of userPositions) {
            if (p.symbol === symbol) {
              const shares = p.totalShares;
              const avg = Number(p.averageEntryPrice);
              totalUnrealizedPnl += shares > 0
                ? shares * (ltp - avg)
                : Math.abs(shares) * (avg - ltp);
            } else {
              totalUnrealizedPnl += Number(p.unrealizedPnl);
            }
          }

          const equity = Number(account.cashBalance) + totalUnrealizedPnl;
          if (equity < Number(account.maintenanceMargin)) {
            await liquidateAccount(tx, pos.userId, quote);
            return;
          }

          // Update unrealized P&L for the position that triggered this check
          const currentPosition = userPositions.find((p) => p.symbol === symbol);
          if (currentPosition) {
            const shares = currentPosition.totalShares;
            const avg = Number(currentPosition.averageEntryPrice);
            const currentPnl = shares > 0
              ? shares * (ltp - avg)
              : Math.abs(shares) * (avg - ltp);

            await tx
              .update(paperPositions)
              .set({ unrealizedPnl: currentPnl.toString(), updatedAt: new Date() })
              .where(eq(paperPositions.id, currentPosition.id));
          }
        });
      } catch (err) {
        console.error(`[matcher] liquidation check error for user ${pos.userId}:`, err);
      }
    }

    // 2. Fetch pending orders for this symbol
    const pendingOrders = await db
      .select()
      .from(paperOrders)
      .where(
        and(
          eq(paperOrders.symbol, symbol),
          or(
            eq(paperOrders.status, "PENDING"),
            eq(paperOrders.status, "TRIGGER_PENDING"),
            eq(paperOrders.status, "PARTIALLY_FILLED"),
          ),
        ),
      );

    // Deduplicate by (symbol, side, type, limit/stop price) — prevent double-fire
    const seen = new Set<string>();
    const uniqueOrders = pendingOrders.filter((order) => {
      const key = `${order.symbol}:${order.side}:${order.type}:${order.limitPrice ?? "null"}:${order.stopPrice ?? "null"}:${order.userId}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });

    for (const order of uniqueOrders) {
      let isTriggered = false;
      let isMatched = false;

      // --- Trailing stop logic ---
      if (order.trailingDistance && Number(order.trailingDistance) > 0) {
        const dist = Number(order.trailingDistance);
        const isPercent = !!order.isTrailingPercent;

        if (order.side === "SELL") {
          let hwm = order.trailingHwm ? Number(order.trailingHwm) : null;
          if (hwm === null || hwm === 0 || ltp > hwm) {
            hwm = ltp;
            const stopPrice = isPercent ? hwm * (1 - dist / 100) : hwm - dist;
            await db
              .update(paperOrders)
              .set({ trailingHwm: hwm.toString(), stopPrice: stopPrice.toString(), updatedAt: new Date() })
              .where(eq(paperOrders.id, order.id));
            order.trailingHwm = hwm.toString();
            order.stopPrice = stopPrice.toString();
          }
          if (ltp <= Number(order.stopPrice || 0)) isTriggered = true;
        } else {
          let lwm = order.trailingLwm ? Number(order.trailingLwm) : null;
          if (lwm === null || lwm === 0 || ltp < lwm) {
            lwm = ltp;
            const stopPrice = isPercent ? lwm * (1 + dist / 100) : lwm + dist;
            await db
              .update(paperOrders)
              .set({ trailingLwm: lwm.toString(), stopPrice: stopPrice.toString(), updatedAt: new Date() })
              .where(eq(paperOrders.id, order.id));
            order.trailingLwm = lwm.toString();
            order.stopPrice = stopPrice.toString();
          }
          if (ltp >= Number(order.stopPrice || 0)) isTriggered = true;
        }
      }

      if (isTriggered && order.type === "MARKET") {
        await db
          .update(paperOrders)
          .set({ status: "PENDING", type: "MARKET", updatedAt: new Date() })
          .where(eq(paperOrders.id, order.id));
        order.status = "PENDING";
        order.type = "MARKET";
      }

      // --- Trigger pending stop-loss logic ---
      if (order.status === "TRIGGER_PENDING" && !isTriggered) {
        if (order.type === "STOP_LOSS_LIMIT" && order.stopPrice) {
          const stopPriceNum = Number(order.stopPrice);
          if ((order.side === "BUY" && ltp >= stopPriceNum) ||
              (order.side === "SELL" && ltp <= stopPriceNum)) {
            isTriggered = true;
          }
        }
        if (isTriggered) {
          await db
            .update(paperOrders)
            .set({
              status: "PENDING",
              type: "STOP_LOSS_LIMIT",
              rejectReason: null,
              updatedAt: new Date(),
            })
            .where(eq(paperOrders.id, order.id));
          order.status = "PENDING";
          order.type = "STOP_LOSS_LIMIT";
        }
      }

      // --- Match pending orders ---
      if (order.status === "PENDING" || order.status === "PARTIALLY_FILLED") {
        if (order.type === "MARKET") {
          isMatched =
            !order.trailingDistance || isTriggered;
        } else if (order.type === "LIMIT") {
          const limitPriceNum = Number(order.limitPrice);
          if (order.side === "BUY" && executionAsk <= limitPriceNum) {
            isMatched = true;
          } else if (order.side === "SELL" && executionBid >= limitPriceNum) {
            isMatched = true;
          }
        } else if (
          order.type === "STOP_LOSS_LIMIT" &&
          (isTriggered || order.status === "PENDING")
        ) {
          const limitPriceNum = Number(order.limitPrice);
          if (order.side === "BUY" && executionAsk <= limitPriceNum) {
            isMatched = true;
          } else if (order.side === "SELL" && executionBid >= limitPriceNum) {
            isMatched = true;
          }
        }
      }

      if (!isMatched) continue;

      const remainingQty = order.qty - (order.filledQty || 0);
      if (remainingQty <= 0) continue;

      let fillQty = remainingQty;
      if (
        order.type === "LIMIT" ||
        order.type === "STOP_LOSS_LIMIT"
      ) {
        if (volume === undefined || volume <= 0) continue;
        const availableVolume = Math.floor(volume * 0.1);
        if (availableVolume <= 0) continue;
        fillQty = Math.min(remainingQty, availableVolume);
      }

      if (fillQty <= 0) continue;

      // 3. Execute in transaction
      try {
        const receipt = await db.transaction(
          async (tx): Promise<MatchingReceipt> => {
          const [account] = await tx
            .select()
            .from(paperAccounts)
            .where(eq(paperAccounts.userId, order.userId))
            .for("update");

          if (!account) {
            return await rejection(tx, order, symbol, fillQty, "Paper account not found");
          }

          if (account.isLocked) {
            return await rejection(tx, order, symbol, fillQty, "Account locked due to margin call");
          }

          // Lock the current position
          const [position] = await tx
            .select()
            .from(paperPositions)
            .where(
              and(
                eq(paperPositions.userId, order.userId),
                eq(paperPositions.symbol, symbol),
                eq(paperPositions.exchange, order.exchange),
              ),
            )
            .for("update");

          // Fetch all other positions for unrealized P&L
          const allPositions = await tx
            .select()
            .from(paperPositions)
            .where(eq(paperPositions.userId, order.userId));

          const domainOrder = toDomainOrder(order);
          const domainAccount = toDomainAccount(
            account,
            allPositions,
            domainOrder
          );
          const executionReason =
            order.type === "STOP_LOSS_LIMIT"
              ? "STOP_TRIGGER"
              : order.trailingDistance
                ? "TRAILING_STOP"
                : "USER_ORDER";
          const executionRequest: PaperExecutionRequest = {
            account: domainAccount,
            order: domainOrder,
            fillQuantity: fillQty,
            quote,
            reason: executionReason,
          };

          let executionResult;
          try {
            executionResult =
              executePaperFill(executionRequest);
          } catch (error: unknown) {
            return await rejection(
              tx,
              order,
              symbol,
              fillQty,
              getErrorMessage(error)
            );
          }

          const fill = executionResult.fill;
          const executedOrder =
            executionResult.account.orders.find(
              (candidate) => candidate.id === order.id
            );
          const executedPosition =
            executionResult.account.positions.find(
              (candidate) => candidate.symbol === symbol
            );
          const newShares =
            executedPosition?.quantity ?? 0;
          const newCashBalance =
            executionResult.account.cash;
          const updatedAllocatedMargin =
            executionResult.account.allocatedMargin;
          const updatedMaintenanceMargin =
            executionResult.account.maintenanceMargin;

          // Update or delete position
          if (newShares === 0) {
            await tx
              .delete(paperPositions)
              .where(
                and(
                  eq(paperPositions.userId, order.userId),
                  eq(paperPositions.symbol, symbol),
                  eq(paperPositions.exchange, order.exchange),
                ),
              );
          } else {
            await tx
              .insert(paperPositions)
              .values({
                id: position?.id || crypto.randomUUID(),
                userId: order.userId,
                symbol,
                exchange: order.exchange,
                averageEntryPrice:
                  executedPosition!.averagePrice.toString(),
                totalShares: newShares,
                realizedPnl:
                  executedPosition!.realisedPnl.toString(),
                unrealizedPnl:
                  executedPosition!.unrealisedPnl.toString(),
                marginLocked:
                  executedPosition!.marginLocked.toString(),
                updatedAt: new Date(),
              })
              .onConflictDoUpdate({
                target: [paperPositions.userId, paperPositions.symbol, paperPositions.exchange],
                set: {
                  averageEntryPrice:
                    executedPosition!.averagePrice.toString(),
                  totalShares: newShares,
                  realizedPnl:
                    executedPosition!.realisedPnl.toString(),
                  unrealizedPnl:
                    executedPosition!.unrealisedPnl.toString(),
                  marginLocked:
                    executedPosition!.marginLocked.toString(),
                  updatedAt: new Date(),
                },
              });
          }

          await tx
            .update(paperAccounts)
            .set({
              cashBalance: newCashBalance.toString(),
              allocatedMargin: updatedAllocatedMargin.toString(),
              maintenanceMargin: updatedMaintenanceMargin.toString(),
              updatedAt: new Date(),
            })
            .where(eq(paperAccounts.userId, order.userId));

          // Order status update
          const totalFilledQty =
            executedOrder?.filledQuantity ??
            order.filledQty + fillQty;
          const isFullyFilled =
            totalFilledQty === order.qty;
          const newStatus = isFullyFilled
            ? "FILLED"
            : "PARTIALLY_FILLED";
          const newAvgFillPrice =
            executedOrder?.averageFillPrice ??
            fill.fillPrice;
          const accumulatedFee =
            Number(order.transactionFee || 0) +
            fill.fees;

          await tx
            .update(paperOrders)
            .set({
              status: newStatus,
              filledQty: totalFilledQty,
              averageFillPrice: newAvgFillPrice.toString(),
              slippageApplied: fill.slippage.toString(),
              transactionFee: accumulatedFee.toString(),
              filledAt: isFullyFilled ? new Date() : null,
              updatedAt: new Date(),
            })
            .where(eq(paperOrders.id, order.id));

          // 4. Bracket order children
          if (isFullyFilled &&
              ((order.takeProfitPrice && Number(order.takeProfitPrice) > 0) ||
               (order.stopLossPrice && Number(order.stopLossPrice) > 0))) {
            const childSide = order.side === "BUY" ? "SELL" : "BUY";

            if (order.takeProfitPrice && Number(order.takeProfitPrice) > 0) {
              await tx.insert(paperOrders).values({
                id: crypto.randomUUID(),
                userId: order.userId,
                parentOrderId: order.id,
                symbol,
                exchange: order.exchange,
                side: childSide,
                type: "LIMIT",
                status: "PENDING",
                executionType: "GOOD_TILL_CANCELLED",
                qty: order.qty,
                limitPrice: order.takeProfitPrice,
              });
            }

            if (order.stopLossPrice && Number(order.stopLossPrice) > 0) {
              await tx.insert(paperOrders).values({
                id: crypto.randomUUID(),
                userId: order.userId,
                parentOrderId: order.id,
                symbol,
                exchange: order.exchange,
                side: childSide,
                type: "STOP_LOSS_LIMIT",
                status: "TRIGGER_PENDING",
                executionType: "GOOD_TILL_CANCELLED",
                qty: order.qty,
                stopPrice: order.stopLossPrice,
                limitPrice: order.stopLossPrice,
              });
            }
          }

          // 5. OCO sibling management
          if (order.parentOrderId) {
            const siblings = await tx
              .select()
              .from(paperOrders)
              .where(
                and(
                  eq(paperOrders.parentOrderId, order.parentOrderId),
                  sql`${paperOrders.id} != ${order.id}`,
                ),
              )
              .for("update");

            for (const sibling of siblings) {
              if (
                sibling.status === "PENDING" ||
                sibling.status === "TRIGGER_PENDING"
              ) {
                if (isFullyFilled) {
                  await tx
                    .update(paperOrders)
                    .set({ status: "CANCELLED", updatedAt: new Date() })
                    .where(eq(paperOrders.id, sibling.id));
                } else {
                  const newSiblingQty = Math.max(1, sibling.qty - fillQty);
                  await tx
                    .update(paperOrders)
                    .set({ qty: newSiblingQty, updatedAt: new Date() })
                    .where(eq(paperOrders.id, sibling.id));
                }
              }
            }
          }

          return {
            orderId: order.id,
            symbol,
            side: order.side as "BUY" | "SELL",
            qty: fillQty,
            price: fill.fillPrice,
            slippageApplied: fill.slippage,
            transactionFee: fill.fees,
            executionTimestamp: new Date().toISOString(),
            status: newStatus,
            updatedMarginLocked:
              executedPosition?.marginLocked ?? 0,
            cashBalance: newCashBalance,
          };
          }
        );

        if (receipt) receipts.push(receipt);
      } catch (err) {
        console.error(`[matcher] transaction error for order ${order.id}:`, err);
      }
    }

    return receipts;
  });
}

async function rejection(
  tx: any,
  order: any,
  symbol: string,
  qty: number,
  reason: string
): Promise<MatchingReceipt> {
  order.status = "REJECTED";
  order.rejectReason = reason;

  await tx
    .update(paperOrders)
    .set({ status: "REJECTED", rejectReason: reason, updatedAt: new Date() })
    .where(eq(paperOrders.id, order.id));

  return {
    orderId: order.id,
    symbol,
    side: order.side as "BUY" | "SELL",
    qty,
    price: 0,
    slippageApplied: 0,
    transactionFee: 0,
    executionTimestamp: new Date().toISOString(),
    status: "REJECTED",
    rejectReason: reason,
    updatedMarginLocked: 0,
    cashBalance: 0,
  };
}

// ---------------------------------------------------------------------------
// Liquidation
// ---------------------------------------------------------------------------

export async function liquidateAccount(
  tx: any,
  userId: string,
  triggeringQuote?: ExecutionQuote
): Promise<void> {
  console.warn(`[matcher] [MARGIN CALL] Auto-liquidating account for user ${userId}`);

  await tx
    .update(paperOrders)
    .set({ status: "CANCELLED", updatedAt: new Date() })
    .where(
      and(
        eq(paperOrders.userId, userId),
        or(
          eq(paperOrders.status, "PENDING"),
          eq(paperOrders.status, "TRIGGER_PENDING"),
          eq(paperOrders.status, "PARTIALLY_FILLED"),
        ),
      ),
    );

  const openPositions = await tx
    .select()
    .from(paperPositions)
    .where(eq(paperPositions.userId, userId))
    .for("update");

  const [databaseAccount] = await tx
    .select()
    .from(paperAccounts)
    .where(eq(paperAccounts.userId, userId))
    .for("update");
  if (!databaseAccount) return;

  let domainAccount = toDomainAccount(
    databaseAccount,
    openPositions
  );

  for (const pos of openPositions) {
    const qty = pos.totalShares;
    if (qty === 0) continue;

    const side = qty > 0 ? "SELL" : "BUY";
    const absQty = Math.abs(qty);
    const rawQuote =
      triggeringQuote &&
      triggeringQuote.symbol === pos.symbol
        ? triggeringQuote
        : quoteStore.get(pos.symbol);
    const parsed = parseExecutionQuote(
      rawQuote,
      pos.symbol
    );
    if (!parsed.ok) continue;
    const policy = evaluateExecutionQuote(
      parsed.quote,
      pos.symbol
    );
    if (!policy.executable) continue;

    const now = new Date().toISOString();
    const liquidationOrder: PaperOrder = {
      id: crypto.randomUUID(),
      symbol: pos.symbol,
      side,
      quantity: absQty,
      type: "MARKET",
      status: "PENDING",
      filledQuantity: 0,
      createdAt: now,
      updatedAt: now,
      quoteSource: parsed.quote.source,
      quoteQuality: parsed.quote.quality,
      quoteTimestamp: parsed.quote.ts,
      referencePrice: parsed.quote.price,
    };
    const executionAccount: PaperAccount = {
      ...domainAccount,
      status: "LIQUIDATION_PENDING",
      orders: [liquidationOrder],
      fills: [],
    };

    let executionResult;
    try {
      executionResult = executePaperFill({
        account: executionAccount,
        order: liquidationOrder,
        fillQuantity: absQty,
        quote: parsed.quote,
        reason: "MARGIN_LIQUIDATION",
      });
    } catch (error: unknown) {
      console.error(
        "[matcher] Liquidation fill rejected",
        {
          symbol: pos.symbol,
          reason: getErrorMessage(error),
        }
      );
      continue;
    }
    domainAccount = executionResult.account;
    const fill = executionResult.fill;

    await tx.insert(paperOrders).values({
      id: liquidationOrder.id,
      userId,
      symbol: pos.symbol,
      exchange: pos.exchange,
      side,
      type: "MARKET",
      status: "FILLED",
      executionType: "GOOD_TILL_CANCELLED",
      qty: absQty,
      filledQty: absQty,
      averageFillPrice: fill.fillPrice.toString(),
      slippageApplied: fill.slippage.toString(),
      transactionFee: fill.fees.toString(),
      placedAt: new Date(),
      filledAt: new Date(),
      updatedAt: new Date(),
    });

    await tx.delete(paperPositions).where(eq(paperPositions.id, pos.id));
  }

  await tx
    .update(paperAccounts)
    .set({
      cashBalance: domainAccount.cash.toString(),
      allocatedMargin:
        domainAccount.allocatedMargin.toString(),
      maintenanceMargin:
        domainAccount.maintenanceMargin.toString(),
      isLocked: true,
      updatedAt: new Date(),
    })
    .where(eq(paperAccounts.userId, userId));
}
